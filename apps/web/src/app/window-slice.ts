/**
 * The board's window into a long on-demand result (AD-27, 05 §6): a SLICE of the full result — never a tokenization of
 * the windowed substring, which would be wrong for byte-level BPE unless snapped to chunk edges and always wrong for
 * SentencePiece's single global agenda. The window is about 2,000 bytes around the caret, snapped outward to an offset
 * that is a token, code-point and grapheme boundary at once, so every token, character and cluster in it is whole and its
 * ids equal the whole-text result's.
 *
 * `sliceResult` rebases every table of `TokenizationResult` to the window and keeps the 03 §B.3 invariants:
 *
 * - chunks are clipped at the window edges (byte-level chunks may extend beyond it; tokens never cross a chunk edge);
 * - the merge timeline keeps the steps inside the window, renumbered 1…m in their original order (a merge never crosses a
 *   final-token boundary, so every step is wholly inside or outside); born/died step numbers map through the same
 *   renumbering, and the truncation sentinel (`died = stepCount` for merges after `maxSteps`) becomes the new step count,
 *   so `replay(timeline, stepCount)` still equals the window's final token boundaries;
 * - a normalized (NFKC) result's source map is not carried into a window (`normalization: null`): the window shows the
 *   normalized text the tokens refer to.
 */
import type { ChunkTable, MergeTimeline, TokenTable, TokenizationResult } from '@tsbs/core';
import { ALIVE, NEVER, TokenFlag } from '@tsbs/core/model/result';
import { WINDOW_BYTES } from './long-input.ts';

/** A byte window `[start, end)` of a result. */
export interface ByteWindow {
  readonly start: number;
  readonly end: number;
}

/** Window centres move in steps of this many bytes, so moving the caret re-slices only now and then. */
export const WINDOW_STEP = 500;

/** First index `i` in `sorted[lo…hi)` with `sorted[i] >= value` (`hi` when none). */
function lowerBound(sorted: ArrayLike<number>, value: number, lo: number, hi: number): number {
  let a = lo;
  let b = hi;
  while (a < b) {
    const mid = (a + b) >>> 1;
    if ((sorted[mid] ?? 0) < value) a = mid + 1;
    else b = mid;
  }
  return a;
}

/** The byte offset of UTF-16 offset `utf16` in `result.text` (the start of the code point holding it). */
export function byteAtUtf16(result: TokenizationResult, utf16: number): number {
  const { chars, utf8 } = result;
  if (utf16 <= 0 || chars.count === 0) return 0;
  if (utf16 >= (chars.utf16Start[chars.count] ?? 0)) return utf8.length;
  const i = lowerBound(chars.utf16Start, utf16 + 1, 0, chars.count + 1) - 1;
  return chars.byteStart[Math.max(0, i)] ?? 0;
}

/** True when byte offset `b` is a code-point, grapheme and token boundary of `result` (0 and the end always are). */
export function isWindowEdge(result: TokenizationResult, b: number): boolean {
  const n = result.utf8.length;
  if (b <= 0 || b >= n) return true;
  const c = result.byteToChar[b] ?? 0;
  if (result.chars.byteStart[c] !== b) return false;
  const g = result.chars.grapheme[c] ?? 0;
  if (result.graphemes.byteStart[g] !== b) return false;
  const before = result.byteToToken[b - 1] ?? -1;
  return before < 0 || before !== result.byteToToken[b];
}

/** `[start, end)` widened until both ends are window edges (`isWindowEdge`). */
export function snapWindow(result: TokenizationResult, start: number, end: number): ByteWindow {
  const n = result.utf8.length;
  let s = Math.max(0, Math.min(start, n));
  let e = Math.max(s, Math.min(end, n));
  while (!isWindowEdge(result, s)) s--;
  while (!isWindowEdge(result, e)) e++;
  return { start: s, end: e };
}

/**
 * The window of about `size` bytes around byte `byte`: the centre moves in steps of `WINDOW_STEP` (at most a quarter of
 * the window, so the byte always stays inside) and the window is clamped to the text, then snapped outward. A result no
 * larger than `size` is its own window.
 */
export function windowAround(result: TokenizationResult, byte: number, size: number = WINDOW_BYTES): ByteWindow {
  const n = result.utf8.length;
  const width = Math.max(1, Math.floor(size));
  if (n <= width) return { start: 0, end: n };
  const step = Math.max(1, Math.min(WINDOW_STEP, Math.floor(width / 4)));
  const centre = Math.round(Math.max(0, Math.min(Math.floor(byte), n)) / step) * step;
  const end = Math.min(n, Math.max(width, centre + Math.floor(width / 2)));
  return snapWindow(result, Math.max(0, end - width), end);
}

/** `values[from…to)` minus `offset`, as the same typed-array kind (−1 entries stay −1 when `keepNegative`). */
function rebased<T extends Uint32Array | Int32Array>(
  values: T,
  from: number,
  to: number,
  offset: number,
  keepNegative = false,
): T {
  const out = values.slice(from, to) as T;
  if (offset !== 0)
    for (let i = 0; i < out.length; i++) if (!keepNegative || (out[i] ?? 0) >= 0) out[i] = (out[i] ?? 0) - offset;
  return out;
}

/** 1-based old step → 1-based new step (for kept steps) / count of kept steps before it (for the others). */
function stepRenumbering(timeline: MergeTimeline, start: number, end: number): { remap: Int32Array; kept: number[] } {
  const remap = new Int32Array(timeline.stepCount + 1);
  const kept: number[] = [];
  for (let k = 1; k <= timeline.stepCount; k++) {
    if ((timeline.stepLeft[k - 1] ?? 0) >= start && (timeline.stepEnd[k - 1] ?? 0) <= end) kept.push(k - 1);
    remap[k] = kept.length;
  }
  return { remap, kept };
}

function sliceTimeline(
  timeline: MergeTimeline,
  { start, end }: ByteWindow,
  k0: number,
  remap: Int32Array,
  kept: readonly number[],
): MergeTimeline {
  const n = end - start;
  const born = timeline.boundaryBorn.slice(start, end + 1);
  const died = timeline.boundaryDied.slice(start, end + 1);
  for (let b = 0; b <= n; b++) {
    const bornAt = born[b] ?? 0;
    const diedAt = died[b] ?? ALIVE;
    if (bornAt !== NEVER) born[b] = remap[bornAt] ?? 0;
    if (diedAt !== ALIVE) died[b] = remap[diedAt] ?? 0;
  }
  const leadingZeroWidthPart = timeline.leadingZeroWidthPart && start === 0;
  // The window edges are final-token boundaries, permanent in the window (03 §B.2) — except the virtual boundary of a
  // zero-width leading part, which keeps its own born/died.
  if (!leadingZeroWidthPart) {
    born[0] = 0;
    died[0] = ALIVE;
  }
  born[n] = 0;
  died[n] = ALIVE;
  const pick = <T extends Uint8Array | Uint32Array | Int32Array | Float32Array>(values: T, offset = 0): T => {
    const out = new (values.constructor as new (length: number) => T)(kept.length);
    for (let i = 0; i < kept.length; i++) out[i] = (values[kept[i] ?? 0] ?? 0) - offset;
    return out;
  };
  return {
    stepCount: kept.length,
    leadingZeroWidthPart,
    boundaryBorn: born,
    boundaryDied: died,
    stepKind: pick(timeline.stepKind),
    stepLeft: pick(timeline.stepLeft, start),
    stepMid: pick(timeline.stepMid, start),
    stepEnd: pick(timeline.stepEnd, start),
    stepRank: pick(timeline.stepRank),
    stepResultId: pick(timeline.stepResultId),
    stepChunk: pick(timeline.stepChunk, k0),
    truncated: timeline.truncated,
  };
}

/** The window `[start, end)` of `result` (both ends must be window edges, `snapWindow`) as a result of its own. */
export function sliceResult(result: TokenizationResult, window: ByteWindow): TokenizationResult {
  const { start: s, end: e } = window;
  const n = result.utf8.length;
  if (s <= 0 && e >= n) return result;
  const { chars, graphemes, chunks, tokens } = result;
  const c0 = s >= n ? chars.count : (result.byteToChar[s] ?? 0);
  const c1 = e >= n ? chars.count : (result.byteToChar[e] ?? 0);
  const g0 = c0 >= chars.count ? graphemes.count : (chars.grapheme[c0] ?? 0);
  const g1 = c1 >= chars.count ? graphemes.count : (chars.grapheme[c1] ?? 0);
  const k0 = s >= n ? chunks.count : (result.byteToChunk[s] ?? 0);
  const k1 = e > s ? (result.byteToChunk[e - 1] ?? 0) + 1 : k0;
  const t0 = lowerBound(tokens.byteStart, s, 0, tokens.count);
  const t1 = e >= n ? tokens.count : lowerBound(tokens.byteStart, e, t0, tokens.count);
  const u0 = chars.utf16Start[c0] ?? 0;
  const text = result.text.slice(u0, chars.utf16Start[c1] ?? result.text.length);

  const chunkStarts = new Uint32Array(k1 - k0 + 1);
  const chunkChars = new Uint32Array(k1 - k0 + 1);
  const chunkTokens = new Uint32Array(k1 - k0 + 1);
  for (let i = 0; i <= k1 - k0; i++) {
    const byte = Math.min(e, Math.max(s, chunks.byteStart[k0 + i] ?? e));
    chunkStarts[i] = byte - s;
    chunkChars[i] = Math.min(c1, Math.max(c0, chunks.charStart[k0 + i] ?? c1)) - c0;
    chunkTokens[i] = Math.min(t1, Math.max(t0, chunks.tokenStart[k0 + i] ?? t1)) - t0;
  }
  chunkStarts[0] = 0;
  chunkChars[0] = 0;
  chunkTokens[0] = 0;
  chunkStarts[k1 - k0] = e - s;
  chunkChars[k1 - k0] = c1 - c0;
  chunkTokens[k1 - k0] = t1 - t0;
  // A first chunk that starts exactly at the window keeps its own first token (leading zero-width tokens precede it).
  if (s === (chunks.byteStart[k0] ?? -1)) chunkTokens[0] = (chunks.tokenStart[k0] ?? t0) - t0;
  const sliced: ChunkTable = {
    count: k1 - k0,
    byteStart: chunkStarts,
    charStart: chunkChars,
    tokenStart: chunkTokens,
    kind: chunks.kind.slice(k0, k1),
    directHit: chunks.directHit.slice(k0, k1),
    rule: chunks.rule.slice(k0, k1),
  };

  const steps = result.timeline === null ? null : stepRenumbering(result.timeline, s, e);
  const stepFormed = tokens.stepFormed.slice(t0, t1);
  if (steps !== null)
    for (let t = 0; t < stepFormed.length; t++)
      if ((stepFormed[t] ?? -1) > 0) stepFormed[t] = steps.remap[stepFormed[t] ?? 0] ?? -1;
  const slicedTokens: TokenTable = {
    count: t1 - t0,
    id: tokens.id.slice(t0, t1),
    byteStart: rebased(tokens.byteStart, t0, t1 + 1, s),
    flags: tokens.flags.slice(t0, t1),
    kind: tokens.kind.slice(t0, t1),
    chunk: rebased(tokens.chunk, t0, t1, k0, true),
    charFirst: rebased(tokens.charFirst, t0, t1, c0),
    charLast: rebased(tokens.charLast, t0, t1, c0),
    stepFormed,
  };

  let partial = 0;
  let zeroWidth = 0;
  let special = 0;
  for (const flags of slicedTokens.flags) {
    if (flags & TokenFlag.Partial) partial++;
    if (flags & TokenFlag.ZeroWidth) zeroWidth++;
    if (flags & TokenFlag.Special) special++;
  }
  const tokenFirst = rebased(chars.tokenFirst, c0, c1, t0, true);
  const tokenLast = rebased(chars.tokenLast, c0, c1, t0, true);
  let split = 0;
  for (let i = 0; i < tokenFirst.length; i++) if ((tokenLast[i] ?? 0) > (tokenFirst[i] ?? 0)) split++;
  const timeline =
    result.timeline === null || steps === null
      ? null
      : sliceTimeline(result.timeline, window, k0, steps.remap, steps.kept);

  return {
    tokenizer: result.tokenizer,
    family: result.family,
    options: result.options,
    input: { text, codePoints: c1 - c0, utf16Units: text.length },
    text,
    normalization: null,
    utf8: result.utf8.slice(s, e),
    chars: {
      count: c1 - c0,
      cp: chars.cp.slice(c0, c1),
      utf16Start: rebased(chars.utf16Start, c0, c1 + 1, u0),
      byteStart: rebased(chars.byteStart, c0, c1 + 1, s),
      grapheme: rebased(chars.grapheme, c0, c1, g0),
      chunk: rebased(chars.chunk, c0, c1, k0, true),
      tokenFirst,
      tokenLast,
      sourceRunStart: null,
      sourceRunEnd: null,
    },
    graphemes: {
      count: g1 - g0,
      source: graphemes.source,
      charStart: rebased(graphemes.charStart, g0, g1 + 1, c0),
      byteStart: rebased(graphemes.byteStart, g0, g1 + 1, s),
    },
    chunks: sliced,
    tokens: slicedTokens,
    timeline,
    byteToChar: rebased(result.byteToChar, s, e, c0),
    byteToToken: rebased(result.byteToToken, s, e, t0, true),
    byteToChunk: rebased(result.byteToChunk, s, e, k0, true),
    stats: {
      codePoints: c1 - c0,
      utf16Units: text.length,
      bytes: e - s,
      graphemes: g1 - g0,
      chunks: k1 - k0,
      tokens: t1 - t0,
      partialTokens: partial,
      splitChars: split,
      zeroWidthTokens: zeroWidth,
      specialTokens: special,
      mergeSteps: timeline?.stepCount ?? 0,
    },
    timings: result.timings,
    seq: result.seq,
  };
}
