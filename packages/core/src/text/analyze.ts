/**
 * `analyzeText` (04 §4): one pass over a JS string that yields its UTF-8 bytes, the per-code-point table (code point,
 * UTF-16 start, byte start), the grapheme clusters and the UTF-16 → byte / byte → code point maps. Shared by both engines
 * and the main thread (instant stops 1–3 and the live counts while a vocabulary loads), so it is pure arithmetic.
 *
 * Lone surrogates become U+FFFD with 3 bytes, exactly as `TextEncoder` does (03 §B.2); they keep their single UTF-16 unit,
 * so `isUnpairedSurrogateAt` can tell the inspector "unpaired surrogate". Graphemes come from `Intl.Segmenter('und',
 * { granularity: 'grapheme' })`; without it (or with `segmenter: null`) every code point is its own cluster and
 * `source = 'fallback'` (PD-4) — every array stays well-formed and `count` is never -1.
 */
import type { GraphemeTable } from '../model/result.ts';
import { REPLACEMENT_CHARACTER, utf8Length, writeUtf8 } from './utf8.ts';

/** The part of `Intl.Segmenter` that `analyzeText` needs (an injectable seam for the fallback tests). */
export interface GraphemeSegmenterLike {
  segment(text: string): Iterable<{ readonly index: number }>;
}

export interface AnalyzeOptions {
  /** Grapheme segmenter. Default: a shared `Intl.Segmenter('und', { granularity: 'grapheme' })` when the runtime has one.
   *  `null` forces the one-cluster-per-code-point fallback. */
  readonly segmenter?: GraphemeSegmenterLike | null;
}

/** Per-code-point columns of `CharTable` that depend on the text alone (chunk/token columns are added by `buildResult`). */
export interface CharColumns {
  readonly count: number;
  readonly cp: Uint32Array;
  /** count+1 sentinel; index into `text`. */
  readonly utf16Start: Uint32Array;
  /** count+1 sentinel; byteLen(i) = byteStart[i+1] − byteStart[i] ∈ 1..4. */
  readonly byteStart: Uint32Array;
  /** Grapheme-cluster index of each code point. */
  readonly grapheme: Uint32Array;
}

export interface TextAnalysis {
  readonly text: string;
  readonly utf8: Uint8Array;
  readonly chars: CharColumns;
  readonly graphemes: GraphemeTable;
  /** utf16Units+1 entries: byte offset of the code point that starts at (or contains) each UTF-16 index. */
  readonly utf16ToByte: Uint32Array;
  /** utf8.length entries: index of the code point each byte belongs to. */
  readonly byteToChar: Uint32Array;
  /** Number of lone surrogates that were encoded as U+FFFD. */
  readonly unpairedSurrogates: number;
}

let sharedSegmenter: GraphemeSegmenterLike | null | undefined;

/** The runtime's grapheme segmenter, created once; `null` when `Intl.Segmenter` is unavailable. */
export function defaultGraphemeSegmenter(): GraphemeSegmenterLike | null {
  if (sharedSegmenter === undefined) {
    const intl: { readonly Segmenter?: typeof Intl.Segmenter } = Intl;
    sharedSegmenter = intl.Segmenter ? new intl.Segmenter('und', { granularity: 'grapheme' }) : null;
  }
  return sharedSegmenter;
}

/** True iff the UTF-16 unit at `index` is a surrogate that is not part of a valid pair. */
export function isUnpairedSurrogateAt(text: string, index: number): boolean {
  const unit = text.charCodeAt(index);
  if (unit >= 0xd800 && unit <= 0xdbff) {
    const next = text.charCodeAt(index + 1);
    return !(next >= 0xdc00 && next <= 0xdfff);
  }
  if (unit >= 0xdc00 && unit <= 0xdfff) {
    const prev = index > 0 ? text.charCodeAt(index - 1) : 0;
    return !(prev >= 0xd800 && prev <= 0xdbff);
  }
  return false;
}

/** Counts code points and UTF-8 bytes (pass 1 of `analyzeText`). */
function measure(text: string): { readonly count: number; readonly bytes: number } {
  let count = 0;
  let bytes = 0;
  for (let i = 0; i < text.length; count++) {
    const unit = text.charCodeAt(i);
    if (unit >= 0xd800 && unit <= 0xdbff) {
      const next = text.charCodeAt(i + 1);
      if (next >= 0xdc00 && next <= 0xdfff) {
        bytes += 4;
        i += 2;
        continue;
      }
    }
    bytes += unit >= 0xd800 && unit <= 0xdfff ? 3 : utf8Length(unit);
    i += 1;
  }
  return { count, bytes };
}

/** Builds the grapheme table and fills `grapheme` (one cluster per code point when `segmenter` is null). */
function segmentGraphemes(
  text: string,
  count: number,
  utf16Start: Uint32Array,
  byteStart: Uint32Array,
  grapheme: Uint32Array,
  segmenter: GraphemeSegmenterLike | null,
): GraphemeTable {
  if (segmenter === null) {
    const charStart = new Uint32Array(count + 1);
    for (let i = 0; i <= count; i++) charStart[i] = i;
    for (let i = 0; i < count; i++) grapheme[i] = i;
    return { count, source: 'fallback', charStart, byteStart: byteStart.slice() };
  }
  const starts: number[] = [];
  let char = 0;
  for (const { index } of segmenter.segment(text)) {
    while (char < count && (utf16Start[char] ?? 0) < index) char++;
    if (char < count && starts[starts.length - 1] !== char) starts.push(char);
  }
  if (count > 0 && starts[0] !== 0) starts.unshift(0);
  const clusters = starts.length;
  const charStart = new Uint32Array(clusters + 1);
  const graphemeBytes = new Uint32Array(clusters + 1);
  for (let g = 0; g < clusters; g++) {
    const first = starts[g] ?? 0;
    const last = g + 1 < clusters ? (starts[g + 1] ?? count) : count;
    charStart[g] = first;
    graphemeBytes[g] = byteStart[first] ?? 0;
    for (let i = first; i < last; i++) grapheme[i] = g;
  }
  charStart[clusters] = count;
  graphemeBytes[clusters] = byteStart[count] ?? 0;
  return { count: clusters, source: 'segmenter', charStart, byteStart: graphemeBytes };
}

/** Analyses `text` (04 §4). Pure; O(n) plus the segmenter. */
export function analyzeText(text: string, options: AnalyzeOptions = {}): TextAnalysis {
  const { count, bytes } = measure(text);
  const utf8 = new Uint8Array(bytes);
  const cp = new Uint32Array(count);
  const utf16Start = new Uint32Array(count + 1);
  const byteStart = new Uint32Array(count + 1);
  const grapheme = new Uint32Array(count);
  const utf16ToByte = new Uint32Array(text.length + 1);
  const byteToChar = new Uint32Array(bytes);
  let unpairedSurrogates = 0;
  let offset = 0;
  let i = 0;
  for (let c = 0; c < count; c++) {
    let scalar = text.charCodeAt(i);
    let units = 1;
    if (scalar >= 0xd800 && scalar <= 0xdbff) {
      const next = text.charCodeAt(i + 1);
      if (next >= 0xdc00 && next <= 0xdfff) {
        scalar = 0x10000 + ((scalar - 0xd800) << 10) + (next - 0xdc00);
        units = 2;
      }
    }
    if (units === 1 && scalar >= 0xd800 && scalar <= 0xdfff) {
      scalar = REPLACEMENT_CHARACTER;
      unpairedSurrogates++;
    }
    cp[c] = scalar;
    utf16Start[c] = i;
    byteStart[c] = offset;
    utf16ToByte[i] = offset;
    if (units === 2) utf16ToByte[i + 1] = offset;
    const end = writeUtf8(utf8, offset, scalar);
    byteToChar.fill(c, offset, end);
    offset = end;
    i += units;
  }
  utf16Start[count] = text.length;
  byteStart[count] = bytes;
  utf16ToByte[text.length] = bytes;
  const segmenter = options.segmenter === undefined ? defaultGraphemeSegmenter() : options.segmenter;
  const graphemes = segmentGraphemes(text, count, utf16Start, byteStart, grapheme, segmenter);
  return {
    text,
    utf8,
    chars: { count, cp, utf16Start, byteStart, grapheme },
    graphemes,
    utf16ToByte,
    byteToChar,
    unpairedSurrogates,
  };
}
