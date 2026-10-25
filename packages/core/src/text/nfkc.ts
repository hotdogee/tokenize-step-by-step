/**
 * NFKC with a per-code-point source map (03 §B.4; legacy Claude only).
 *
 * NFKC is not per code point (ﾀ + ﾞ → ダ is 2 → 1, ㍻ → 平成 is 1 → 2), so the input is cut into normalization-stable
 * segments — before every code point with ccc = 0 and NFKC_Quick_Check = Yes — and each segment is normalized on its own.
 * Every output code point of a segment gets `sourceRunStart` = the segment's first input code point index and
 * `sourceRunEnd` = one past its last; deleted segments leave no rows. By the stability property the concatenated segment
 * outputs equal `input.normalize('NFKC')`; that is checked on every call, and if a runtime's tables ever disagree the map
 * degrades to one segment for the whole text (`exact: false`), which is coarse but never wrong.
 *
 * The cut predicate comes from the Unicode tables (`cccNonZero`, `nfkcQcNotYes` in tools/oracle/unicode_tables.json, which
 * WP02 converts to `core/unicode/tables.generated.ts`, AD-4); it is injected so this module has no table of its own.
 */
import { scalarAt } from './utf8.ts';

/** Sorted, inclusive `[first, last]` code-point ranges (the shape of tools/oracle/unicode_tables.json). */
export type CodePointRanges = ReadonlyArray<readonly [number, number]>;

/** True iff a normalization-stable segment may start before `cp`. */
export type SegmentStartPredicate = (cp: number) => boolean;

/** Binary search: is `cp` inside one of the sorted `ranges`? */
export function inRanges(ranges: CodePointRanges, cp: number): boolean {
  let lo = 0;
  let hi = ranges.length - 1;
  while (lo <= hi) {
    const mid = (lo + hi) >>> 1;
    const range = ranges[mid];
    if (range === undefined) return false;
    if (cp < range[0]) hi = mid - 1;
    else if (cp > range[1]) lo = mid + 1;
    else return true;
  }
  return false;
}

/** The 03 §B.4 cut rule over the exported tables: cut before code points with ccc = 0 and NFKC_QC = Yes. */
export function nfkcSegmentStart(tables: {
  readonly cccNonZero: CodePointRanges;
  readonly nfkcQcNotYes: CodePointRanges;
}): SegmentStartPredicate {
  return (cp) => !inRanges(tables.cccNonZero, cp) && !inRanges(tables.nfkcQcNotYes, cp);
}

export interface NfkcSourceMap {
  /** `input.normalize('NFKC')`. */
  readonly text: string;
  /** `text !== input`. */
  readonly changed: boolean;
  /** Per output code point: first input code point index of the run that produced it. */
  readonly sourceRunStart: Int32Array;
  /** Per output code point: one past the last input code point index of that run. */
  readonly sourceRunEnd: Int32Array;
  /** Number of segments the input was cut into. */
  readonly segments: number;
  /** False when the segment outputs did not concatenate to the whole-string NFKC and one segment was used instead. */
  readonly exact: boolean;
}

/** Code points of `text` (lone surrogates as U+FFFD, matching the char table). */
function codePoints(text: string): { readonly cps: number[]; readonly units: number[] } {
  const cps: number[] = [];
  const units: number[] = [];
  for (let i = 0; i < text.length;) {
    const s = scalarAt(text, i);
    cps.push(s.cp);
    units.push(i);
    i += s.units;
  }
  units.push(text.length);
  return { cps, units };
}

function countCodePoints(text: string): number {
  let n = 0;
  for (let i = 0; i < text.length; n++) i += scalarAt(text, i).units;
  return n;
}

function buildMap(
  input: string,
  cuts: readonly number[],
  units: readonly number[],
  inputCount: number,
): { readonly pieces: string[]; readonly start: number[]; readonly end: number[] } {
  const pieces: string[] = [];
  const start: number[] = [];
  const end: number[] = [];
  for (let s = 0; s < cuts.length; s++) {
    const first = cuts[s] ?? 0;
    const last = s + 1 < cuts.length ? (cuts[s + 1] ?? inputCount) : inputCount;
    const piece = input.slice(units[first], units[last]).normalize('NFKC');
    pieces.push(piece);
    const n = countCodePoints(piece);
    for (let k = 0; k < n; k++) {
      start.push(first);
      end.push(last);
    }
  }
  return { pieces, start, end };
}

/**
 * Normalizes `input` to NFKC and maps every output code point to its input run. `isSegmentStart = null` uses one segment
 * for the whole text (always correct, maximally coarse).
 */
export function nfkcWithSourceMap(input: string, isSegmentStart: SegmentStartPredicate | null): NfkcSourceMap {
  const text = input.normalize('NFKC');
  const { cps, units } = codePoints(input);
  const cuts: number[] = cps.length > 0 ? [0] : [];
  if (isSegmentStart !== null) {
    for (let i = 1; i < cps.length; i++) if (isSegmentStart(cps[i] ?? 0)) cuts.push(i);
  }
  let map = buildMap(input, cuts, units, cps.length);
  let exact = map.pieces.join('') === text;
  let segments = cuts.length;
  if (!exact) {
    map = buildMap(input, cps.length > 0 ? [0] : [], units, cps.length);
    exact = false;
    segments = cps.length > 0 ? 1 : 0;
  }
  return {
    text,
    changed: text !== input,
    sourceRunStart: Int32Array.from(map.start),
    sourceRunEnd: Int32Array.from(map.end),
    segments,
    exact,
  };
}
