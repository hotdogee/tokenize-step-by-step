/**
 * The nine Unicode 16.0 character classes the pre-tokenizer patterns use (AD-4, 04 §2.2 rules 1–2), decoded lazily
 * from `tables.generated.ts`. Production patterns never use native `\p{…}`: the fixtures' chunks come from Unicode 16.0
 * engines while current browsers and Node are on Unicode 17.
 */
import { L, Ll, Lm, Lo, Lt, Lu, M, N, White_Space } from './tables.generated.ts';
import { type CodePointRanges, decodeRanges, rangesToClassBody } from './ranges.ts';

/** A pinned class: the eight general categories of the patterns plus `White_Space` (what `\s` means upstream). */
export type UnicodeClass = 'L' | 'Lu' | 'Ll' | 'Lt' | 'Lm' | 'Lo' | 'M' | 'N' | 'White_Space';

/** Every pinned class, in table order. */
export const UNICODE_CLASSES: readonly UnicodeClass[] = ['L', 'Lu', 'Ll', 'Lt', 'Lm', 'Lo', 'M', 'N', 'White_Space'];

const ENCODED: Readonly<Record<UnicodeClass, readonly number[]>> = { L, Lu, Ll, Lt, Lm, Lo, M, N, White_Space };
const rangeCache = new Map<UnicodeClass, CodePointRanges>();
const bodyCache = new Map<UnicodeClass, string>();

/** The class as sorted inclusive ranges (decoded once, shared: do not mutate). */
export function classRanges(name: UnicodeClass): CodePointRanges {
  let ranges = rangeCache.get(name);
  if (ranges === undefined) {
    ranges = decodeRanges(ENCODED[name]);
    rangeCache.set(name, ranges);
  }
  return ranges;
}

/** The class as the inside of a `[…]` regex class for the `u` flag (built once). */
export function classBody(name: UnicodeClass): string {
  let body = bodyCache.get(name);
  if (body === undefined) {
    body = rangesToClassBody(classRanges(name));
    bodyCache.set(name, body);
  }
  return body;
}
