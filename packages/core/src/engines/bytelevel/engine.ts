/**
 * Engine A — byte-level BPE with tiktoken semantics (04 §2.1): one `Tokenizer` over a TSBV1 asset for o200k, cl100k,
 * Llama 3, Llama 4 / Muse, Grok-2 and legacy Claude.
 *
 * encode(text, options):
 *  1. `normalize: 'NFKC'` → `nfkcWithSourceMap` (per normalization-stable segment, 03 §B.4), so every code point of the
 *     encoded text maps back to its input run; then `analyzeText` (UTF-8, code points, graphemes, UTF-16 → byte map).
 *  2. `specialTokens: 'match'` → `SPCL` strings (source order, leftmost-first) become `SpecialString` chunks.
 *  3. The pattern chunks every ordinary segment; the matches must tile it (`PretokenizeError`); traced runs record the
 *     in-context rule per chunk.
 *  4. Per chunk: 1 byte → its single-byte rank (direct hit); the whole chunk a vocabulary entry → one token (direct hit,
 *     tiktoken's shortcut; inner boundaries are born NEVER); a cached result (≤ 256 B) → replayed; else one part per byte
 *     merged by the shared agenda with `RankPriority` and, when ≤ 256 B, cached.
 *  5–7. `addBos` prepends a zero-width `Bos` token; `buildResult` derives the flags (Partial, StartsMidChar, …), the maps,
 *     `chars.tokenFirst/tokenLast` over non-zero-width tokens, `stepFormed` and the stats.
 *
 * `encode` and `encodeIncremental` are one generator: `encode` runs it with an infinite budget and it never yields, while
 * `encodeIncremental` runs every merge as `mergeStep` time slices (default 4 ms) and yields `{ bytesDone, bytesTotal }`
 * at the phase boundaries (after the analysis, after pre-tokenization, before the result is built), after every
 * unfinished merge slice, and between chunks once the slice's time is used up (sampled every 16 chunks) — so the Worker
 * observes a cancel within one budget inside the merge phase whatever the input's shape (a CJK paragraph is a single
 * chunk, AD-21). Both paths run the same code on the same frozen loop, so their results are identical by construction;
 * `timings.encodeMs` excludes the time spent suspended at a yield.
 */
import { createMergeState, mergeStep } from '../../agenda/merge-loop.ts';
import { bytePartList } from '../../agenda/part-list.ts';
import type { TraceRecorder } from '../../agenda/types.ts';
import type { ByteVocab, Tsbv1 } from '../../format/types.ts';
import { buildResult } from '../../model/build-result.ts';
import type { Tokenizer, TokenizerInfo } from '../../model/engine.ts';
import {
  ChunkKind,
  StepKind,
  TokenFlag,
  TokenKind,
  type EncodeOptions,
  type TokenizationResult,
} from '../../model/result.ts';
import { analyzeText, type TextAnalysis } from '../../text/analyze.ts';
import { nfkcWithSourceMap } from '../../text/nfkc.ts';
import { recorderFor } from '../../timeline/trace-recorder.ts';
import { compilePattern, NO_RULE, type CompiledPattern, type UnicodeMode } from '../../unicode/expand.ts';
import { isNfkcSegmentStart } from '../../unicode/normalization.ts';
import { CHUNK_CACHE_MAX_CHUNK, ChunkCache } from './chunk-cache.ts';
import { parseByteLevelEntry, resolveOptions, type ByteLevelConfig, type ByteLevelEntryLike } from './config.ts';
import { emptyPlan, pretokenizeSegment, type ChunkPlan } from './pretokenize.ts';
import { RankPriority } from './priority.ts';
import { SpecialsMatcher } from './specials.ts';

/** What `encodeIncremental` yields. */
export interface EncodeProgress {
  readonly bytesDone: number;
  readonly bytesTotal: number;
}

/** Test and parity seams; production passes none. */
export interface ByteLevelEngineOptions {
  /** `native` substitutes the runtime's `\p{…}` classes (the `TSBS_NATIVE_UNICODE=1` parity run, AD-4). Default `pinned16`. */
  readonly unicodeMode?: UnicodeMode;
  /** A pattern to use instead of the entry's (tests of the `PretokenizeError` path). */
  readonly pattern?: CompiledPattern;
  /** Chunk-cache payload bound in bytes (default 2 MiB, 04 §2.5). */
  readonly cacheBytes?: number;
}

/** Default `encodeIncremental` slice (04 §1.3). */
export const DEFAULT_BUDGET_MS = 4;

/** `performance` is not in lib ES2023; read it structurally, as the agenda loop does. */
const clock: { readonly Date: DateConstructor; readonly performance?: { now(): number } } = globalThis;
function now(): number {
  return clock.performance ? clock.performance.now() : clock.Date.now();
}

/** Forwards merge steps to the timeline recorder and keeps them, relative to the chunk start, for the chunk cache. */
class StepCapture implements TraceRecorder {
  private readonly buf = new Int32Array(3 * CHUNK_CACHE_MAX_CHUNK);
  private count = 0;
  private base = 0;
  private target: TraceRecorder | null = null;

  begin(base: number, target: TraceRecorder | null): void {
    this.count = 0;
    this.base = base;
    this.target = target;
  }

  record(kind: 0 | 1, left: number, mid: number, end: number, rank: number, resultId: number, chunk: number): void {
    const i = 3 * this.count++;
    this.buf[i] = left - this.base;
    this.buf[i + 1] = mid - this.base;
    this.buf[i + 2] = resultId;
    this.target?.record(kind, left, mid, end, rank, resultId, chunk);
  }

  steps(): Int32Array {
    return this.buf.slice(0, 3 * this.count);
  }
}

/** Growable-by-construction token columns (capacity = bytes + 1, the most a text can have with a BOS). */
class TokenColumns {
  readonly id: Uint32Array;
  readonly start: Uint32Array;
  readonly kind: Uint8Array;
  readonly flags: Uint8Array;
  count = 0;

  constructor(byteCount: number) {
    this.id = new Uint32Array(byteCount + 1);
    this.start = new Uint32Array(byteCount + 2);
    this.kind = new Uint8Array(byteCount + 1);
    this.flags = new Uint8Array(byteCount + 1);
  }

  push(id: number, start: number, kind: number, flags: number): void {
    const t = this.count++;
    this.id[t] = id;
    this.start[t] = start;
    this.kind[t] = kind;
    this.flags[t] = flags;
  }
}

export class ByteLevelTokenizer implements Tokenizer {
  readonly info: TokenizerInfo;
  private readonly config: ByteLevelConfig;
  private readonly tsbv: Tsbv1;
  private readonly vocab: ByteVocab;
  private readonly pattern: CompiledPattern;
  private readonly specials: SpecialsMatcher;
  private readonly cache: ChunkCache;
  /** Rank of each single byte (the reader asserts all 256 are pieces). */
  private readonly byteRank = new Int32Array(256);
  private disposed = false;

  constructor(tsbv: Tsbv1, entry: ByteLevelEntryLike, options: ByteLevelEngineOptions = {}) {
    const config = parseByteLevelEntry(tsbv, entry);
    this.config = config;
    this.tsbv = tsbv;
    this.vocab = tsbv.vocab;
    this.pattern = options.pattern ?? compilePattern(config.pattern, options.unicodeMode ?? 'pinned16');
    this.specials = new SpecialsMatcher(tsbv.specials);
    this.cache = new ChunkCache(options.cacheBytes);
    for (let b = 0; b < 256; b++) {
      const rank = this.vocab.indexOf(Uint8Array.of(b), 0, 1);
      if (rank < 0) throw new TypeError(`createByteLevelTokenizer(${config.id}): byte ${String(b)} is not a piece`);
      this.byteRank[b] = rank;
    }
    const specialsToggle =
      tsbv.specials.length > 0 && (config.toggles.size === 0 || config.toggles.has('specialTokens'));
    this.info = {
      id: config.id,
      family: 'bytelevel-bpe',
      vocabSize: config.vocabSize,
      rankCount: config.rankCount,
      specials: tsbv.specials.map((s) => ({ id: s.id, text: s.text })),
      bosId: config.bosId,
      unicodeVersion: '16.0.0',
      sourceSha256: tsbv.meta.upstream.sha256,
      supports: { nfkc: config.toggles.has('normalize'), bos: config.bosId !== null, specialsToggle },
    };
  }

  /** Accounted bytes held by the chunk cache (≤ 2 MiB, 04 §2.5). */
  get cacheBytes(): number {
    return this.cache.bytes;
  }

  encode(text: string, options?: Partial<EncodeOptions>): TokenizationResult {
    const run = this.run(text, resolveOptions(this.config.defaults, options), Number.POSITIVE_INFINITY, false);
    const step = run.next();
    if (step.done !== true) throw new Error('bytelevel encode yielded without a budget');
    return step.value;
  }

  encodeIncremental(
    text: string,
    options?: Partial<EncodeOptions>,
    budgetMs: number = DEFAULT_BUDGET_MS,
  ): Generator<EncodeProgress, TokenizationResult> {
    if (!(budgetMs >= 0)) throw new RangeError(`budgetMs must be a non-negative number, got ${String(budgetMs)}`);
    return this.run(text, resolveOptions(this.config.defaults, options), budgetMs, true);
  }

  tokenBytes(id: number): Uint8Array | null {
    const index = id - this.config.idOffset;
    if (Number.isInteger(index) && index >= 0 && index < this.vocab.count) return this.vocab.bytesOf(index).slice();
    const special = this.tsbv.specials.find((s) => s.id === id);
    return special === undefined ? null : special.bytes.slice();
  }

  pieceString(_id: number): string | null {
    return null;
  }

  idOf(bytes: Uint8Array): number | null {
    if (bytes.length === 0) return null;
    if (bytes.length <= this.config.maxPieceBytes) {
      const index = this.vocab.indexOf(bytes, 0, bytes.length);
      if (index >= 0) return index + this.config.idOffset;
    }
    const special = this.tsbv.specials.find(
      (s) => s.bytes.length === bytes.length && s.bytes.every((b, i) => b === bytes[i]),
    );
    return special === undefined ? null : special.id;
  }

  pretokenize(text: string): ReadonlyArray<readonly [number, number]> {
    this.assertLive();
    const analysis = analyzeText(text);
    const plan = this.plan(analysis, false, false);
    return plan.start.map((s, c) => [s, plan.start[c + 1] ?? analysis.utf8.length] as const);
  }

  dispose(): void {
    this.disposed = true;
    this.cache.clear();
  }

  private assertLive(): void {
    if (this.disposed) throw new Error(`${this.config.id} tokenizer was disposed`);
  }

  /** Steps 2–3: special-string and regex chunks of the encoded text (the plan is left open: no end sentinel). */
  private plan(analysis: TextAnalysis, matchSpecials: boolean, withRules: boolean): ChunkPlan {
    const { text, utf16ToByte } = analysis;
    const plan = emptyPlan();
    let from = 0;
    for (const m of matchSpecials ? this.specials.find(text) : []) {
      if (m.start > from) pretokenizeSegment(this.pattern, text, from, m.start, utf16ToByte, withRules, plan);
      plan.start.push(utf16ToByte[m.start] ?? 0);
      plan.kind.push(ChunkKind.SpecialString);
      plan.rule.push(NO_RULE);
      plan.special.push(m.id);
      from = m.end;
    }
    if (from < text.length) pretokenizeSegment(this.pattern, text, from, text.length, utf16ToByte, withRules, plan);
    return plan;
  }

  /** Token id of the live part `[start, end)` after merging. */
  private idOfPart(utf8: Uint8Array, start: number, end: number): number {
    if (end - start === 1) return (this.byteRank[utf8[start] ?? 0] ?? 0) + this.config.idOffset;
    const index = this.vocab.indexOf(utf8, start, end);
    if (index < 0)
      throw new Error(`bytelevel: merged part [${String(start)}, ${String(end)}) is not a vocabulary entry`);
    return index + this.config.idOffset;
  }

  /** The shared body of `encode` (never yields: `incremental` false) and `encodeIncremental`. */
  private *run(
    input: string,
    options: EncodeOptions,
    budgetMs: number,
    incremental: boolean,
  ): Generator<EncodeProgress, TokenizationResult> {
    this.assertLive();
    const { idOffset, maxPieceBytes, bosId } = this.config;
    const vocab = this.vocab;
    const t0 = now();

    // 1. normalization (legacy Claude NFKC, with the per-code-point source map) and text analysis
    const nfkc = options.normalize === 'NFKC' ? nfkcWithSourceMap(input, isNfkcSegmentStart) : null;
    const analysis = analyzeText(nfkc === null ? input : nfkc.text);
    const t1 = now();
    const { utf8 } = analysis;
    const bytesTotal = utf8.length;
    const sliced = incremental && budgetMs !== Number.POSITIVE_INFINITY;
    let sliceStart = t1;
    let paused = 0;
    if (sliced) {
      yield { bytesDone: 0, bytesTotal };
      sliceStart = now();
      paused += sliceStart - t1;
    }

    // 2–3. specials and pre-tokenizer chunks
    const traced = options.trace !== false;
    const plan = this.plan(analysis, options.specialTokens === 'match', traced);
    if (sliced) {
      const pausedAt = now();
      yield { bytesDone: 0, bytesTotal };
      sliceStart = now();
      paused += sliceStart - pausedAt;
    }
    const chunkCount = plan.start.length;
    const directHit = new Uint8Array(chunkCount);
    const recorder = recorderFor(bytesTotal, options.trace, { rank: 'resultId' });
    const prio = new RankPriority(vocab, utf8, maxPieceBytes, idOffset);
    const capture = new StepCapture();
    const ends = new Int32Array(CHUNK_CACHE_MAX_CHUNK);
    const tokens = new TokenColumns(bytesTotal);
    let merges = 0;

    // 6. BOS (zero-width, first)
    if (options.addBos && bosId !== null) tokens.push(bosId, 0, TokenKind.Bos, TokenFlag.Special);

    // 4. chunks
    for (let c = 0; c < chunkCount; c++) {
      const s = plan.start[c] ?? 0;
      const e = plan.start[c + 1] ?? bytesTotal;
      if (sliced && (c & 15) === 0 && now() - sliceStart >= budgetMs) {
        const pausedAt = now();
        yield { bytesDone: s, bytesTotal };
        sliceStart = now();
        paused += sliceStart - pausedAt;
      }
      if (plan.kind[c] === ChunkKind.SpecialString) {
        tokens.push(plan.special[c] ?? 0, s, TokenKind.Special, TokenFlag.Special);
        continue;
      }
      const len = e - s;
      if (len === 1) {
        tokens.push((this.byteRank[utf8[s] ?? 0] ?? 0) + idOffset, s, TokenKind.Normal, TokenFlag.DirectHit);
        directHit[c] = 1;
        continue;
      }
      const whole = len <= maxPieceBytes ? vocab.indexOf(utf8, s, e) : -1;
      if (whole >= 0) {
        tokens.push(whole + idOffset, s, TokenKind.Normal, TokenFlag.DirectHit);
        directHit[c] = 1;
        recorder?.neverBorn(s, e);
        continue;
      }
      const cacheable = len <= CHUNK_CACHE_MAX_CHUNK;
      const cached = cacheable ? this.cache.get(utf8, s, e) : null;
      if (cached !== null) {
        let at = s;
        for (const id of cached.ids) {
          tokens.push(id, at, TokenKind.Normal, 0);
          at += (vocab.offsets[id - idOffset + 1] ?? 0) - (vocab.offsets[id - idOffset] ?? 0);
        }
        if (at !== e) throw new Error(`bytelevel: cached chunk [${String(s)}, ${String(e)}) does not cover its bytes`);
        const { steps } = cached;
        if (recorder !== null) {
          for (let i = 0; i < len; i++) ends[i] = i + 1;
          for (let k = 0; k < steps.length; k += 3) {
            const left = steps[k] ?? 0;
            const mid = steps[k + 1] ?? 0;
            const resultId = steps[k + 2] ?? 0;
            const end = ends[mid] ?? 0;
            ends[left] = end;
            recorder.record(StepKind.Merge, s + left, s + mid, s + end, resultId - idOffset, resultId, c);
          }
        }
        merges += steps.length / 3;
        continue;
      }
      const parts = bytePartList(s, e);
      let trace: TraceRecorder | null = recorder;
      if (cacheable) {
        capture.begin(s, recorder);
        trace = capture;
      }
      const state = createMergeState(parts, prio, c, trace);
      if (sliced) {
        while (!mergeStep(state, Math.max(0, budgetMs - (now() - sliceStart)))) {
          const pausedAt = now();
          yield { bytesDone: s + Math.floor(len * (1 - parts.count / len)), bytesTotal };
          sliceStart = now();
          paused += sliceStart - pausedAt;
        }
      } else {
        mergeStep(state, Number.POSITIVE_INFINITY);
      }
      const first = tokens.count;
      for (let a = parts.head; a !== -1; a = parts.next[a] ?? -1) {
        const ps = parts.start[a] ?? 0;
        tokens.push(this.idOfPart(utf8, ps, parts.end[a] ?? 0), ps, TokenKind.Normal, 0);
      }
      merges += len - parts.count;
      if (cacheable) this.cache.put(utf8, s, e, tokens.id.slice(first, tokens.count), capture.steps());
    }

    // 5, 7. flags, maps, char columns, stats
    if (sliced) {
      const pausedAt = now();
      yield { bytesDone: bytesTotal, bytesTotal };
      paused += now() - pausedAt;
    }
    tokens.start[tokens.count] = bytesTotal;
    const timeline = recorder === null ? null : recorder.finish();
    plan.start.push(bytesTotal);
    return buildResult({
      tokenizer: this.config.id,
      family: 'bytelevel-bpe',
      options,
      inputText: input,
      analysis,
      normalization:
        nfkc === null
          ? null
          : { changed: nfkc.changed, sourceRunStart: nfkc.sourceRunStart, sourceRunEnd: nfkc.sourceRunEnd },
      chunks: { byteStart: plan.start, kind: plan.kind, directHit, rule: plan.rule },
      tokens: {
        id: tokens.id.subarray(0, tokens.count),
        byteStart: tokens.start.subarray(0, tokens.count + 1),
        kind: tokens.kind.subarray(0, tokens.count),
        flags: tokens.flags.subarray(0, tokens.count),
      },
      timeline,
      mergeSteps: merges,
      timings: { analyzeMs: t1 - t0, encodeMs: now() - t1 - paused },
    });
  }
}
