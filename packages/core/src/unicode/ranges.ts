/**
 * Code-point range lists: decoding the compact form of `tables.generated.ts`, membership tests and regex class bodies.
 *
 * A decoded list is a flat `Uint32Array` `[first0, last0, first1, last1, …]` of sorted, inclusive, non-overlapping
 * ranges. Lists handed out by the accessors in `classes.ts` / `normalization.ts` are shared: never mutate them.
 */

/** Sorted inclusive ranges as a flat `[first, last, first, last, …]` array. */
export type CodePointRanges = Uint32Array;

/**
 * Decodes the `(gap, span)` pairs written by `scripts/unicode-tables.ts`: with `next = 0`, each pair gives
 * `first = next + gap`, `last = first + span`, then `next = last + 1`.
 */
export function decodeRanges(pairs: readonly number[]): CodePointRanges {
  if (pairs.length % 2 !== 0) throw new RangeError('decodeRanges: odd number of values');
  const out = new Uint32Array(pairs.length);
  let next = 0;
  for (let i = 0; i < pairs.length; i += 2) {
    const first = next + (pairs[i] ?? 0);
    const last = first + (pairs[i + 1] ?? 0);
    out[i] = first;
    out[i + 1] = last;
    next = last + 1;
  }
  return out;
}

/** Whether `cp` lies in one of the ranges (binary search, O(log n)). */
export function inRanges(ranges: CodePointRanges, cp: number): boolean {
  let lo = 0;
  let hi = (ranges.length >> 1) - 1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    if (cp < (ranges[2 * mid] ?? 0)) hi = mid - 1;
    else if (cp > (ranges[2 * mid + 1] ?? 0)) lo = mid + 1;
    else return true;
  }
  return false;
}

/** Number of code points covered by the ranges. */
export function rangeSize(ranges: CodePointRanges): number {
  let total = 0;
  for (let i = 0; i < ranges.length; i += 2) total += (ranges[i + 1] ?? 0) - (ranges[i] ?? 0) + 1;
  return total;
}

const hex = (cp: number) => `\\u{${cp.toString(16)}}`;

/**
 * The inside of a `[…]` character class matching exactly these code points under the `u` flag: every code point is
 * written as a `\u{…}` escape, so no character can be read as class syntax (`]`, `\`, `-`, `^`).
 */
export function rangesToClassBody(ranges: CodePointRanges): string {
  const parts: string[] = [];
  for (let i = 0; i < ranges.length; i += 2) {
    const first = ranges[i] ?? 0;
    const last = ranges[i + 1] ?? 0;
    parts.push(first === last ? hex(first) : `${hex(first)}-${hex(last)}`);
  }
  return parts.join('');
}
