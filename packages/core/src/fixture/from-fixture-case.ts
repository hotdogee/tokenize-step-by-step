/**
 * `fromFixtureCase` (03 §B.5, §C.7, AD-16): turns a golden-fixture case — or its compact `ExampleCaseWire` form — into a
 * full `TokenizationResult`. Pure; runs on the main thread (precomputed example chips), in the examples plugin and in tests.
 *
 * - Byte-level (tiktoken family): chunks from `chunks` (kind Regex), `directHit` from `merges`, tokens kind Normal with
 *   DirectHit on the tokens of direct-hit chunks, and a timeline replayed from the fixture's `[position, rank]` steps
 *   (rank = token id, so `stepRank === stepResultId`); a direct-hit chunk's inside boundaries are born NEVER.
 * - SentencePiece: one SpmText chunk, kinds from `type` (BYTE → Byte, USER_DEFINED → UserDefined except gemma4 → Normal per
 *   AD-31, CONTROL → Control, UNK → Unk, a zero-width leading `▁` → DummyPrefix) and no timeline (spm fixtures carry no
 *   steps, so the board derives stop 4 from the final tokens).
 * - `addBos` prepends the registry's BOS id as a zero-width Bos token at `[0, 0)`; `normalize: 'NFKC'` takes the case from
 *   `normalizedNFKC` (legacy Claude) and builds the 03 §B.4 source map against the original case text.
 */
import { buildResult } from '../model/build-result.ts';
import {
  ChunkKind,
  TokenFlag,
  TokenKind,
  type Family,
  type MergeTimeline,
  type TokenizationResult,
  type TokenizerId,
} from '../model/result.ts';
import { analyzeText, type GraphemeSegmenterLike } from '../text/analyze.ts';
import { nfkcWithSourceMap, type SegmentStartPredicate } from '../text/nfkc.ts';
import { decodeUtf8 } from '../text/utf8.ts';
import { fixtureStepsToOffsets } from '../timeline/fixture-steps.ts';
import { TimelineRecorder } from '../timeline/trace-recorder.ts';
import { spmCaseKinds, type ExampleCaseWire, type ExamplesWire } from './examples-wire.ts';
import type { Fixture, FixtureMergeStep, SpmFixtureCase, TiktokenFixtureCase } from './fixture-types.ts';

/** What `fromFixtureCase` needs from a registry `TokenizerEntry` (structurally compatible with it). */
export interface FixtureTokenizerRef {
  readonly id: TokenizerId;
  readonly family: Family;
  readonly engine?: { readonly bosId: number | null };
}

export interface FromFixtureOptions {
  /** Prepend BOS (only when the ref declares a BOS id). */
  readonly addBos?: boolean;
  /** `'NFKC'`: use the `normalizedNFKC` variant (legacy Claude). */
  readonly normalize?: 'none' | 'NFKC';
  /** NFKC segment cut rule (`nfkcSegmentStart(tables)`); default: one segment for the whole text (coarse but exact). */
  readonly nfkcSegmentStart?: SegmentStartPredicate | null;
  /** Grapheme segmenter override (`null` = fallback). */
  readonly segmenter?: GraphemeSegmenterLike | null;
  /** Build the byte-level timeline from the steps (default true). */
  readonly merges?: boolean;
  readonly seq?: number;
}

/** A case in one neutral shape, whichever source it came from. */
interface CaseData {
  readonly text: string;
  readonly ids: readonly number[];
  readonly ends: readonly number[];
  readonly kinds: readonly number[];
  readonly flags: readonly number[];
  /** Byte-level chunk end offsets; null for spm. */
  readonly chunkEnds: readonly number[] | null;
  /** Byte-level per-chunk `{ directHit, steps }`; null when the source omits them. */
  readonly merges: ReadonlyArray<{ readonly directHit: boolean; readonly steps: readonly FixtureMergeStep[] }> | null;
}

const FIXTURE_FAMILY: Readonly<Record<Fixture['family'], Family>> = {
  'tiktoken-bpe': 'bytelevel-bpe',
  'sentencepiece-bpe': 'spm-bpe',
};

function isWire(source: Fixture | ExamplesWire): source is ExamplesWire {
  return 'schema' in source;
}

function isTiktokenCase(c: TiktokenFixtureCase | SpmFixtureCase): c is TiktokenFixtureCase {
  return 'chunks' in c;
}

function fromFixtureData(fixture: Fixture, c: TiktokenFixtureCase | SpmFixtureCase): CaseData {
  const ends = c.tokens.map((t) => t.end);
  if (isTiktokenCase(c)) {
    const perChunk = c.chunks.map((_, i) => c.merges.find((m) => m.chunk === i));
    return {
      text: c.text,
      ids: c.ids,
      ends,
      kinds: c.tokens.map(() => TokenKind.Normal),
      flags: c.tokens.map(() => 0),
      chunkEnds: c.chunks.map(([, end]) => end),
      merges: perChunk.map((m) => ({ directHit: m?.directHit ?? false, steps: m?.steps ?? [] })),
    };
  }
  return {
    text: c.text,
    ids: c.ids,
    ends,
    kinds: spmCaseKinds(c, fixture.tokenizer),
    flags: c.tokens.map(() => 0),
    chunkEnds: null,
    merges: null,
  };
}

function cumulative(deltas: readonly number[]): number[] {
  let sum = 0;
  return deltas.map((d) => (sum += d));
}

function fromWireData(wire: ExampleCaseWire, family: Family): CaseData {
  const ends = cumulative(wire.tokenEnd);
  const flags = wire.ids.map(() => 0);
  for (const [i, f] of wire.flags ?? []) flags[i] = f;
  if (family === 'spm-bpe') {
    return {
      text: wire.text,
      ids: wire.ids,
      ends,
      kinds: wire.type ?? wire.ids.map(() => TokenKind.Normal),
      flags,
      chunkEnds: null,
      merges: null,
    };
  }
  const chunkEnds = cumulative(wire.chunks ?? []);
  let merges: CaseData['merges'] = null;
  if (wire.merges) {
    const byChunk = new Map(wire.merges.map((m) => [m.c, m]));
    merges = chunkEnds.map((end, c) => {
      const entry = byChunk.get(c);
      const oneByte = end - (c > 0 ? (chunkEnds[c - 1] ?? 0) : 0) === 1;
      const steps: FixtureMergeStep[] = [];
      const s = entry?.s ?? [];
      for (let k = 0; k + 1 < s.length; k += 2) steps.push([s[k] ?? 0, s[k + 1] ?? 0]);
      return { directHit: entry ? entry.d === 1 : oneByte, steps };
    });
  }
  return {
    text: wire.text,
    ids: wire.ids,
    ends,
    kinds: wire.type ?? wire.ids.map(() => TokenKind.Normal),
    flags,
    chunkEnds,
    merges,
  };
}

/** Finds a case by name in a fixture (or its `normalizedNFKC` list). */
function findCase(
  fixture: Fixture,
  caseName: string,
  normalized: boolean,
): TiktokenFixtureCase | SpmFixtureCase | undefined {
  const list: ReadonlyArray<TiktokenFixtureCase | SpmFixtureCase> =
    normalized && fixture.family === 'tiktoken-bpe' ? (fixture.normalizedNFKC ?? []) : fixture.cases;
  return list.find((c) => c.name === caseName);
}

/** Resolves the case data and the original (pre-normalization) text. */
function resolveCase(
  source: Fixture | ExamplesWire,
  caseName: string,
  ref: FixtureTokenizerRef,
  nfkc: boolean,
): { readonly data: CaseData; readonly inputText: string } {
  if (source.tokenizer !== ref.id) throw new Error(`${source.tokenizer} data cannot build a ${ref.id} result`);
  if (isWire(source)) {
    if (nfkc) throw new Error('ExamplesWire carries no NFKC variants');
    const wire = source.cases[caseName];
    if (wire === undefined) throw new Error(`examples for ${source.tokenizer} have no case ${caseName}`);
    return { data: fromWireData(wire, ref.family), inputText: wire.text };
  }
  if (FIXTURE_FAMILY[source.family] !== ref.family) {
    throw new Error(`fixture family ${source.family} does not match ${ref.id} (${ref.family})`);
  }
  const plain = findCase(source, caseName, false);
  if (plain === undefined) throw new Error(`fixture ${source.tokenizer} has no case ${caseName}`);
  if (!nfkc) return { data: fromFixtureData(source, plain), inputText: plain.text };
  const normalized = findCase(source, caseName, true);
  if (normalized !== undefined) return { data: fromFixtureData(source, normalized), inputText: plain.text };
  if (plain.text.normalize('NFKC') !== plain.text) {
    throw new Error(`fixture ${source.tokenizer} has no normalizedNFKC entry for ${caseName}, whose NFKC form differs`);
  }
  return { data: fromFixtureData(source, plain), inputText: plain.text };
}

/** Expands a fixture or wire case into a `TokenizationResult` (see the module comment). */
export function fromFixtureCase(
  source: Fixture | ExamplesWire,
  caseName: string,
  ref: FixtureTokenizerRef,
  options: FromFixtureOptions = {},
): TokenizationResult {
  const nfkc = options.normalize === 'NFKC';
  const { data, inputText } = resolveCase(source, caseName, ref, nfkc);
  const sourceMap = nfkc ? nfkcWithSourceMap(inputText, options.nfkcSegmentStart ?? null) : null;
  if (sourceMap !== null && sourceMap.text !== data.text) {
    throw new Error(`NFKC of ${caseName} in this runtime differs from the fixture's normalized text`);
  }
  const analysis = analyzeText(data.text, options.segmenter === undefined ? {} : { segmenter: options.segmenter });
  const n = analysis.utf8.length;

  // ---- chunks ----
  let chunkStarts: number[];
  let chunkKinds: number[];
  let directHit: number[];
  if (data.chunkEnds === null) {
    chunkStarts = n > 0 ? [0, n] : [0];
    chunkKinds = n > 0 ? [ChunkKind.SpmText] : [];
    directHit = chunkKinds.map(() => 0);
  } else {
    chunkStarts = [0, ...data.chunkEnds];
    chunkKinds = data.chunkEnds.map(() => ChunkKind.Regex);
    directHit = data.chunkEnds.map((end, c) => {
      const recorded = data.merges?.[c];
      if (recorded) return recorded.directHit ? 1 : 0;
      return end - (chunkStarts[c] ?? 0) === 1 ? 1 : 0;
    });
  }

  // ---- tokens ----
  const ids: number[] = [];
  const starts: number[] = [0];
  const kinds: number[] = [];
  const flags: number[] = [];
  const bosId = ref.engine?.bosId ?? null;
  if (options.addBos === true && bosId !== null) {
    ids.push(bosId);
    starts.push(0);
    kinds.push(TokenKind.Bos);
    flags.push(TokenFlag.Special);
  }
  let chunk = 0;
  data.ids.forEach((id, i) => {
    const start = starts[starts.length - 1] ?? 0;
    const end = data.ends[i] ?? start;
    while (chunk + 1 < chunkKinds.length && start >= (chunkStarts[chunk + 1] ?? n)) chunk++;
    ids.push(id);
    starts.push(end);
    kinds.push(data.kinds[i] ?? TokenKind.Normal);
    let f = data.flags[i] ?? 0;
    if (data.chunkEnds !== null && end > start && directHit[chunk] === 1) f |= TokenFlag.DirectHit;
    flags.push(f);
  });

  // ---- timeline (byte-level) ----
  let timeline: MergeTimeline | null = null;
  if (data.chunkEnds !== null && data.merges !== null && options.merges !== false) {
    const recorder = new TimelineRecorder(n);
    data.merges.forEach((m, c) => {
      const s = chunkStarts[c] ?? 0;
      const e = chunkStarts[c + 1] ?? s;
      if (m.directHit) recorder.neverBorn(s, e);
      for (const step of fixtureStepsToOffsets(s, e, m.steps)) {
        recorder.record(0, step.left, step.mid, step.end, step.rank, step.rank, c);
      }
    });
    timeline = recorder.finish();
  }

  return buildResult({
    tokenizer: ref.id,
    family: ref.family,
    options: {
      specialTokens: 'as-text',
      addBos: options.addBos === true,
      normalize: nfkc ? 'NFKC' : 'none',
      trace: timeline !== null,
    },
    inputText,
    analysis,
    normalization: sourceMap,
    chunks: { byteStart: chunkStarts, kind: chunkKinds, directHit },
    tokens: { id: ids, byteStart: starts, kind: kinds, flags },
    timeline,
    ...(options.seq === undefined ? {} : { seq: options.seq }),
  });
}

/** spm piece strings by id, collected from every case of a fixture or wire file (for `TokenizationView`'s `pieceOf`). */
export function fixturePieceOf(source: Fixture | ExamplesWire): (id: number) => string | null {
  const pieces = new Map<number, string>();
  if (isWire(source)) {
    for (const wire of Object.values(source.cases)) {
      if (!wire.piece) continue;
      const utf8 = analyzeText(wire.text, { segmenter: null }).utf8;
      let start = 0;
      wire.ids.forEach((id, i) => {
        const end = start + (wire.tokenEnd[i] ?? 0);
        const p = wire.piece?.[i];
        const piece = p === 0 ? decodeUtf8(utf8, start, end) : p;
        if (piece !== undefined && piece !== null) pieces.set(id, piece);
        start = end;
      });
    }
  } else if (source.family === 'sentencepiece-bpe') {
    for (const c of source.cases) for (const t of c.tokens) pieces.set(t.id, t.piece);
  }
  return (id) => pieces.get(id) ?? null;
}
