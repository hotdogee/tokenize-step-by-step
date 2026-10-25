/**
 * Engine B — SentencePiece BPE with byte fallback (04 §3), implementing the FROZEN `Tokenizer` (03 §B.6) over a decoded
 * TSBV1 asset and the shared, frozen agenda loop (AD-5, AD-33). `encode(text, options)`:
 *
 * 1. `analyzeText` (original byte space);
 * 2. `normalizeSpm` → working buffer + `normToOrig` (escaped spaces, zero-width dummy prefix);
 * 3. `symbolize` → initial parts (longest-first pre-match, one part per code point, HF before-merge byte fallback);
 * 4. one agenda over the whole text (SentencePiece's whole text is one "word") with `ScorePriority` or
 *    `MergeRankPriority`; `encodeIncremental` runs it in `mergeStep` time slices and yields between the phases (04 §1.3);
 * 5. `readTokens` → SentencePiece after-merge byte fallback (recorded as split steps) and kinds;
 * 6. `alignSpans` → original spans through `normToOrig` (or `AlignmentError`);
 * 7. `addBos` → zero-width Bos token at `[0, 0)` first;
 * 8. `buildResult` → flags, maps, stats. Matched specials are `SpecialString` chunks, the rest `SpmText` chunks.
 *
 * The timeline maps working offsets through `normToOrig`; code-point and USER_DEFINED symbols' inner boundaries are born
 * NEVER (born later by a split, or never), boundaries of special chunks are permanent, and the dummy prefix is the
 * zero-width leading part (`leadingZeroWidthPart`, 04 §1.4). `stepChunk` is 0 for every step (03 §B.2, "spm: 0").
 */
import { createMergeState, mergeAll, mergeStep } from '../../agenda/merge-loop.ts';
import { partListFromStarts } from '../../agenda/part-list.ts';
import type { PairPriority, PartList } from '../../agenda/types.ts';
import { PieceType } from '../../format/tsbv1.ts';
import type { Tsbv1 } from '../../format/types.ts';
import { buildResult } from '../../model/build-result.ts';
import type { Tokenizer, TokenizerInfo } from '../../model/engine.ts';
import {
  ALIVE,
  ChunkKind,
  DEFAULT_OPTIONS,
  NEVER,
  TokenKind,
  type EncodeOptions,
  type TokenizationResult,
} from '../../model/result.ts';
import { analyzeText, type TextAnalysis } from '../../text/analyze.ts';
import { encodeUtf8 } from '../../text/utf8.ts';
import { recorderFor, type TimelineRecorder } from '../../timeline/trace-recorder.ts';
import { alignSpans } from './align.ts';
import type { SpmEngineConfig } from './config.ts';
import { readTokens } from './fallback.ts';
import { META_SYMBOL, normalizeSpm, type NormalizedText } from './normalize.ts';
import { MergeRankPriority, ScorePriority } from './priority.ts';
import { buildPrefixMatcher, MatchKind, SymbolKind, symbolize, type PrefixMatcher, type Symbols } from './symbolize.ts';

/** Progress yielded by `encodeIncremental`. */
export interface EncodeProgress {
  readonly bytesDone: number;
  readonly bytesTotal: number;
}

/** `performance` is not in lib ES2023; read it structurally (as the agenda does). */
const clock: { readonly Date: DateConstructor; readonly performance?: { now(): number } } = globalThis;
const now = (): number => (clock.performance ? clock.performance.now() : clock.Date.now());

/** The tables an engine holds while resident (dropped by `dispose`). */
interface Tables {
  readonly tsbv: Tsbv1;
  readonly types: Uint8Array;
  readonly matcher: PrefixMatcher | null;
}

/** One encode between its phases. */
interface Job {
  readonly t0: number;
  readonly analyzeMs: number;
  readonly options: EncodeOptions;
  readonly analysis: TextAnalysis;
  readonly normalized: NormalizedText;
  readonly symbols: Symbols;
  readonly parts: PartList;
  readonly prio: PairPriority;
  readonly recorder: TimelineRecorder | null;
  readonly tables: Tables;
}

/** Symbol end in the working buffer. */
const symbolEnd = (symbols: Symbols, i: number, n: number): number =>
  i + 1 < symbols.count ? (symbols.start[i + 1] ?? n) : n;

class SpmTokenizer implements Tokenizer {
  readonly info: TokenizerInfo;
  readonly #config: SpmEngineConfig;
  #tables: Tables | null;

  constructor(tsbv: Tsbv1, config: SpmEngineConfig) {
    const types = tsbv.types;
    if (types === null) throw new Error(`spm engine ${config.id}: the asset has no TYPS section`);
    this.#config = config;
    this.#tables = { tsbv, types, matcher: buildPrefixMatcher(tsbv) };
    this.info = {
      id: config.id,
      family: 'spm-bpe',
      vocabSize: config.vocabSize,
      rankCount: config.rankCount,
      specials: tsbv.specials.map(({ id, text }) => ({ id, text })),
      bosId: config.bosId,
      unicodeVersion: '16.0.0',
      sourceSha256: tsbv.meta.upstream.sha256,
      supports: { nfkc: false, bos: config.bosId !== null, specialsToggle: tsbv.specials.length > 0 },
    };
  }

  #live(): Tables {
    if (this.#tables === null) throw new Error(`spm engine ${this.#config.id} has been disposed`);
    return this.#tables;
  }

  /** Effective options: defaults ← entry defaults ← call options. NFKC is not an spm option, so it is never applied. */
  #options(options: Partial<EncodeOptions>): EncodeOptions {
    return { ...DEFAULT_OPTIONS, ...this.#config.defaults, ...options, normalize: 'none' };
  }

  #symbolize(tables: Tables, normalized: NormalizedText, specialTokens: EncodeOptions['specialTokens']): Symbols {
    return symbolize(normalized.norm, {
      vocab: tables.tsbv.vocab,
      types: tables.types,
      matcher: tables.matcher,
      mask: specialTokens === 'match' ? MatchKind.UserDefined | MatchKind.Special : MatchKind.UserDefined,
      beforeMerge: this.#config.fallbackOrder === 'before-merge',
    });
  }

  /** Steps 1–3 and the timeline's step-0 boundaries. */
  #begin(text: string, partial: Partial<EncodeOptions>): Job {
    const t0 = now();
    const tables = this.#live();
    const options = this.#options(partial);
    const analysis = analyzeText(text);
    const analyzeMs = now() - t0;
    const config = this.#config;
    const normalized = normalizeSpm(analysis.utf8, config.escapeWhitespace, config.addDummyPrefix);
    const { norm, normToOrig, dummyBytes } = normalized;
    const symbols = this.#symbolize(tables, normalized, options.specialTokens);
    const count = symbols.count;
    const parts = partListFromStarts(symbols.start.subarray(0, count), norm.length, symbols.frozen.subarray(0, count));
    const recorder = recorderFor(analysis.utf8.length, options.trace, {
      offsetMap: normToOrig,
      leadingZeroWidthPart: dummyBytes > 0,
    });
    if (recorder !== null) {
      for (let i = 0; i < count; i++) {
        const kind = symbols.kind[i];
        if (kind !== SymbolKind.CodePoint && kind !== SymbolKind.UserDefined) continue;
        const e = symbolEnd(symbols, i, norm.length);
        recorder.neverBorn(normToOrig[symbols.start[i] ?? 0] ?? 0, normToOrig[e] ?? 0);
        // A first symbol that swallows the dummy prefix leaves no virtual boundary after it (04 §1.4).
        if (i === 0 && dummyBytes > 0 && e > dummyBytes) recorder.setBoundary(0, NEVER, ALIVE);
      }
    }
    const { vocab, scores, merges, meta } = tables.tsbv;
    const priorityTables = { vocab, types: tables.types, maxPieceBytes: meta.maxPieceBytes };
    let prio: PairPriority;
    if (config.priority === 'score' && scores !== null) prio = new ScorePriority({ ...priorityTables, scores }, norm);
    else if (config.priority === 'merge-rank' && merges !== null)
      prio = new MergeRankPriority({ ...priorityTables, merges }, norm);
    else throw new Error(`spm engine ${config.id}: no tables for priority ${config.priority}`);
    return { t0, analyzeMs, options, analysis, normalized, symbols, parts, prio, recorder, tables };
  }

  /** Steps 5–8. */
  #finish(job: Job): TokenizationResult {
    const { analysis, normalized, symbols, parts, recorder, options, tables } = job;
    const initialParts = symbols.count;
    const mergeCount = initialParts - parts.count;
    const tokens = readTokens({
      norm: normalized.norm,
      parts,
      symbols,
      vocab: tables.tsbv.vocab,
      types: tables.types,
      byteFirstId: this.#config.byteFirstId,
      dummyBytes: normalized.dummyBytes,
      trace: recorder,
    });
    const n = analysis.utf8.length;
    const spans = alignSpans(tokens.normStart, tokens.normEnd, tokens.count, normalized.normToOrig, n);
    const bosId = options.addBos ? this.#config.bosId : null;
    const lead = bosId === null ? 0 : 1;
    const total = tokens.count + lead;
    const ids = new Uint32Array(total);
    const kinds = new Uint8Array(total);
    const starts = new Uint32Array(total + 1);
    if (bosId !== null) {
      ids[0] = bosId;
      kinds[0] = TokenKind.Bos;
    }
    ids.set(tokens.id.subarray(0, tokens.count), lead);
    kinds.set(tokens.kind.subarray(0, tokens.count), lead);
    starts.set(spans, lead);
    // Chunks: each matched special is a SpecialString chunk, the runs between them SpmText chunks (03 §B.3).
    const chunkStart = [0];
    const chunkKind: number[] = [];
    let textOpen = false;
    for (let t = 0; t < tokens.count; t++) {
      const s = spans[t] ?? 0;
      const e = spans[t + 1] ?? 0;
      if (s === e) continue;
      if (tokens.kind[t] === TokenKind.Special) {
        if (textOpen) chunkStart.push(s);
        textOpen = false;
        chunkKind.push(ChunkKind.SpecialString);
        chunkStart.push(e);
      } else if (!textOpen) {
        chunkKind.push(ChunkKind.SpmText);
        textOpen = true;
      }
    }
    if (textOpen) chunkStart.push(n);
    return buildResult({
      tokenizer: this.#config.id,
      family: 'spm-bpe',
      options,
      analysis,
      chunks: { byteStart: chunkStart, kind: chunkKind },
      tokens: { id: ids, byteStart: starts, kind: kinds },
      timeline: recorder?.finish() ?? null,
      mergeSteps: mergeCount + tokens.splits,
      timings: { analyzeMs: job.analyzeMs, encodeMs: now() - job.t0 - job.analyzeMs },
    });
  }

  encode(text: string, options: Partial<EncodeOptions> = {}): TokenizationResult {
    const job = this.#begin(text, options);
    mergeAll(job.parts, job.prio, 0, job.recorder);
    return this.#finish(job);
  }

  *encodeIncremental(
    text: string,
    options: Partial<EncodeOptions> = {},
    budgetMs = 4,
  ): Generator<EncodeProgress, TokenizationResult, unknown> {
    const job = this.#begin(text, options);
    const bytesTotal = job.analysis.utf8.length;
    yield { bytesDone: 0, bytesTotal }; // after symbolize
    const state = createMergeState(job.parts, job.prio, 0, job.recorder);
    const initial = Math.max(1, job.symbols.count - 1);
    while (!mergeStep(state, budgetMs)) {
      const merged = job.symbols.count - job.parts.count;
      yield { bytesDone: Math.floor((bytesTotal * merged) / initial), bytesTotal };
    }
    yield { bytesDone: bytesTotal, bytesTotal }; // before the fallback phase
    return this.#finish(job);
  }

  tokenBytes(id: number): Uint8Array | null {
    const { tsbv, types } = this.#live();
    if (!Number.isInteger(id) || id < 0 || id >= tsbv.vocab.count) return null;
    const byte = id - this.#config.byteFirstId;
    if (types[id] === PieceType.Byte && byte >= 0 && byte < 256) return Uint8Array.of(byte);
    // The text a piece stands for: each ▁ is a space (SentencePiece decoding, without dummy-prefix stripping).
    const piece = tsbv.vocab.bytesOf(id);
    const out: number[] = [];
    for (let i = 0; i < piece.length; i++) {
      if (piece[i] === META_SYMBOL[0] && piece[i + 1] === META_SYMBOL[1] && piece[i + 2] === META_SYMBOL[2]) {
        out.push(0x20);
        i += 2;
      } else out.push(piece[i] ?? 0);
    }
    return Uint8Array.from(out);
  }

  pieceString(id: number): string | null {
    const { tsbv } = this.#live();
    return Number.isInteger(id) && id >= 0 && id < tsbv.vocab.count ? tsbv.vocab.pieceOf(id) : null;
  }

  idOf(bytes: Uint8Array): number | null {
    const { tsbv, types } = this.#live();
    const { norm } = normalizeSpm(bytes, this.#config.escapeWhitespace, false);
    const index = norm.length <= tsbv.meta.maxPieceBytes ? tsbv.vocab.indexOf(norm, 0, norm.length) : -1;
    if (index >= 0 && types[index] !== PieceType.Byte) return index;
    return bytes.length === 1 ? this.#config.byteFirstId + (bytes[0] ?? 0) : null;
  }

  pretokenize(text: string): ReadonlyArray<readonly [number, number]> {
    const tables = this.#live();
    const normalized = normalizeSpm(encodeUtf8(text), this.#config.escapeWhitespace, this.#config.addDummyPrefix);
    const symbols = this.#symbolize(tables, normalized, this.#options({}).specialTokens);
    const { norm, normToOrig } = normalized;
    const spans: Array<readonly [number, number]> = [];
    for (let i = 0; i < symbols.count; i++) {
      const s = normToOrig[symbols.start[i] ?? 0] ?? 0;
      spans.push([s, normToOrig[symbolEnd(symbols, i, norm.length)] ?? s]);
    }
    return spans;
  }

  dispose(): void {
    this.#tables = null;
  }
}

/** An spm `Tokenizer` over `tsbv` with an already resolved configuration (tests override `fallbackOrder` through it). */
export function createSpmEngine(tsbv: Tsbv1, config: SpmEngineConfig): Tokenizer {
  return new SpmTokenizer(tsbv, config);
}
