/**
 * Normalization-stable cut points for the legacy-Claude NFKC source map (03 §B.4): the text is cut before every code
 * point with `Canonical_Combining_Class = 0` and `NFKC_Quick_Check = Yes`, and each segment normalizes on its own to
 * the matching slice of the whole-string NFKC result. The tables (`cccNonZero`, `nfkcQcNotYes`) are the union of
 * Unicode 15.1 `unicodedata` and the regex module's newer data, so a cut is safe for any browser Unicode version in
 * between (tools/oracle/README.md § "Unicode tables").
 */
import { cccNonZero, nfkcQcNotYes } from './tables.generated.ts';
import { type CodePointRanges, decodeRanges, inRanges } from './ranges.ts';

/** A normalization table of `tables.generated.ts`. */
export type NormalizationTable = 'cccNonZero' | 'nfkcQcNotYes';

const ENCODED: Readonly<Record<NormalizationTable, readonly number[]>> = { cccNonZero, nfkcQcNotYes };
const cache = new Map<NormalizationTable, CodePointRanges>();

/** The table as sorted inclusive ranges (decoded once, shared: do not mutate). */
export function normalizationRanges(name: NormalizationTable): CodePointRanges {
  let ranges = cache.get(name);
  if (ranges === undefined) {
    ranges = decodeRanges(ENCODED[name]);
    cache.set(name, ranges);
  }
  return ranges;
}

/** Whether an NFKC segment may start before `cp` (`ccc(cp) = 0` and `NFKC_QC(cp) = Yes`). */
export function isNfkcSegmentStart(cp: number): boolean {
  return !inRanges(normalizationRanges('cccNonZero'), cp) && !inRanges(normalizationRanges('nfkcQcNotYes'), cp);
}
