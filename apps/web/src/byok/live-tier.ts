/**
 * The live token tier adapter (05 §13): xAI's `token_bytes` → byte spans and flags under the Grok-2 token tier.
 *
 * - **Spans** are the cumulative byte lengths of the returned tokens. **Flags** come from the same rules as every board
 *   token: the result builder (`buildResult`) derives Partial / ZeroWidth / StartsMidChar / EndsMidChar from the spans
 *   and the text's code-point boundaries.
 * - **Alignment guard**: the spans mean something only when `concat(token_bytes) === utf8(text)`. Otherwise (a model that
 *   adds BOS/specials, normalises, or returns `string_token` only) the tier is *unaligned*: the panel reports
 *   `{matched}` (the common prefix) of `{total}` bytes and shows the tokens as a strip in order — no spans, no hatching.
 * - **Comparison**: a boundary is a byte offset 0 < b < n where a token starts. Boundaries present on one side only
 *   differ; "k of n boundaries differ" counts them against the union of both sides' boundaries. The board hatches each
 *   differing boundary on the live tier.
 *
 * Pure functions (unit-tested); nothing here keeps results beyond the caller's memory.
 */
import type { Family, RowModel, TokenizationResult, TokenizerId } from '@tsbs/core';
import { buildResult } from '@tsbs/core/model/build-result';
import { ChunkKind, TokenKind } from '@tsbs/core/model/result';
import { analyzeText } from '@tsbs/core/text/analyze';

/** One token of the provider's answer, in order. */
export interface LiveToken {
  readonly id: number;
  /** `string_token` (display only), or null when absent. */
  readonly text: string | null;
  /** `token_bytes`, or null when the answer has no valid byte array for this token. */
  readonly bytes: Uint8Array | null;
}

/** The tier lines up with the text: spans and flags per token. */
export interface AlignedTier {
  readonly aligned: true;
  /** count+1 byte offsets; token t covers [starts[t], starts[t+1]). */
  readonly starts: Uint32Array;
  /** `TokenFlag` bits per token. */
  readonly flags: Uint8Array;
  /** UTF-8 length of the text. */
  readonly total: number;
}

/** The tier does not line up: `matched` bytes of the concatenation equal the text's first bytes, of `total`. */
export interface UnalignedTier {
  readonly aligned: false;
  readonly matched: number;
  readonly total: number;
}

export type Alignment = AlignedTier | UnalignedTier;

/** The tokenizer the live tier is compared with (its id and family name the flag-deriving result). */
export interface PairedRef {
  readonly id: TokenizerId;
  readonly family: Family;
}

/** Aligns `tokens` with `text` by their bytes (see the module comment for the guard). */
export function alignLiveTokens(text: string, tokens: readonly LiveToken[], paired: PairedRef): Alignment {
  const analysis = analyzeText(text);
  const { utf8 } = analysis;
  const total = utf8.length;
  const starts = new Uint32Array(tokens.length + 1);
  let offset = 0;
  let matched = 0;
  let complete = true;
  for (let t = 0; t < tokens.length; t++) {
    const bytes = tokens[t]?.bytes ?? null;
    if (bytes === null) {
      complete = false;
      break;
    }
    for (const byte of bytes) {
      if (matched === offset && offset < total && utf8[offset] === byte) matched++;
      offset++;
    }
    starts[t + 1] = offset;
  }
  if (!complete || offset !== total || matched !== total) return { aligned: false, matched, total };
  const result = buildResult({
    tokenizer: paired.id,
    family: paired.family,
    analysis,
    chunks: total > 0 ? { byteStart: [0, total], kind: [ChunkKind.Regex] } : { byteStart: [0], kind: [] },
    tokens: { id: tokens.map((token) => token.id), byteStart: starts, kind: tokens.map(() => TokenKind.Normal) },
    timeline: null,
  });
  return { aligned: true, starts, flags: result.tokens.flags, total };
}

/** Interior boundaries (0 < b < total) of `count` tokens whose starts are `starts` (count+1 entries). */
export function interiorBoundaries(starts: ArrayLike<number>, count: number, total: number): Set<number> {
  const set = new Set<number>();
  for (let t = 1; t < count; t++) {
    const b = starts[t] ?? 0;
    if (b > 0 && b < total) set.add(b);
  }
  return set;
}

/** How the live boundaries compare with a reference result's token boundaries. */
export interface BoundaryDiff {
  /** Sorted byte offsets that are a boundary on one side only. */
  readonly differing: readonly number[];
  /** Number of distinct boundaries on either side (the "n" of "k of n boundaries differ"). */
  readonly union: number;
}

/** Compares an aligned tier with `reference` (null when the two do not cover the same bytes). */
export function boundaryDiff(tier: AlignedTier, reference: TokenizationResult): BoundaryDiff | null {
  if (reference.utf8.length !== tier.total) return null;
  const live = interiorBoundaries(tier.starts, tier.starts.length - 1, tier.total);
  const ref = interiorBoundaries(reference.tokens.byteStart, reference.tokens.count, tier.total);
  const differing: number[] = [];
  let union = ref.size;
  for (const b of live) {
    if (!ref.has(b)) {
      differing.push(b);
      union++;
    }
  }
  for (const b of ref) if (!live.has(b)) differing.push(b);
  differing.sort((a, b) => a - b);
  return { differing, union };
}

const diffs = new WeakMap<TokenizationResult, WeakMap<AlignedTier, BoundaryDiff | null>>();

/** `boundaryDiff`, memoised per (tier, reference) so every mounted board row shares one comparison. */
export function diffFor(tier: AlignedTier, reference: TokenizationResult): BoundaryDiff | null {
  let byTier = diffs.get(reference);
  if (byTier === undefined) {
    byTier = new WeakMap();
    diffs.set(reference, byTier);
  }
  if (!byTier.has(tier)) byTier.set(tier, boundaryDiff(tier, reference));
  return byTier.get(tier) ?? null;
}

/** Index of the first value ≥ `x` in the sorted `values`. */
function lowerBound(values: ArrayLike<number>, x: number, end: number = values.length): number {
  let lo = 0;
  let hi = end;
  while (lo < hi) {
    const mid = (lo + hi) >>> 1;
    if ((values[mid] ?? 0) < x) lo = mid + 1;
    else hi = mid;
  }
  return lo;
}

/** True when a differing boundary lies on token t's edges or inside it (a zero-width token never differs). */
export function tokenDiffers(tier: AlignedTier, diff: BoundaryDiff, t: number): boolean {
  const s = tier.starts[t] ?? 0;
  const e = tier.starts[t + 1] ?? 0;
  if (e <= s) return false;
  const i = lowerBound(diff.differing, s);
  return i < diff.differing.length && (diff.differing[i] ?? 0) <= e;
}

/** The column of byte `b` in `row` (rows hold whole code points, so their bytes are consecutive). */
export function columnOf(row: RowModel, b: number): number {
  const entry = row.bytes[b - row.byteStart];
  if (entry?.byte === b) return entry.col;
  return row.bytes.find((candidate) => candidate.byte === b)?.col ?? 0;
}

/** One live token's piece in one packed row. */
export interface LiveFragment {
  readonly token: number;
  /** 0-based first column and column span in the row. */
  readonly col: number;
  readonly span: number;
  readonly first: boolean;
  readonly last: boolean;
}

/** The live tokens' fragments in `row`, left to right (zero-width tokens take no column on the live tier). */
export function rowFragments(row: RowModel, tier: AlignedTier): LiveFragment[] {
  const out: LiveFragment[] = [];
  const count = tier.starts.length - 1;
  // The last token starting at or before the row's first byte.
  let t = Math.max(0, lowerBound(tier.starts, row.byteStart + 1, count) - 1);
  for (; t < count; t++) {
    const s = tier.starts[t] ?? 0;
    const e = tier.starts[t + 1] ?? 0;
    if (s >= row.byteEnd) break;
    const fs = Math.max(s, row.byteStart);
    const fe = Math.min(e, row.byteEnd);
    if (fe <= fs) continue;
    const col = columnOf(row, fs);
    out.push({ token: t, col, span: columnOf(row, fe - 1) + 1 - col, first: fs === s, last: fe === e });
  }
  return out;
}

/** A differing boundary drawn in `row`: at the left edge of byte `boundary`'s column. */
export interface RowCut {
  readonly boundary: number;
  readonly col: number;
}

/** The differing boundaries that fall at the start of a byte of `row`. */
export function rowCuts(row: RowModel, diff: BoundaryDiff): RowCut[] {
  const out: RowCut[] = [];
  for (let i = lowerBound(diff.differing, row.byteStart); i < diff.differing.length; i++) {
    const b = diff.differing[i] ?? 0;
    if (b >= row.byteEnd) break;
    out.push({ boundary: b, col: columnOf(row, b) });
  }
  return out;
}
