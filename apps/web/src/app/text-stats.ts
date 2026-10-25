/**
 * TODO(WP-integration): minimal main-thread text analysis for the counts line and the board placeholder until WP01's
 * `analyzeText` (`@tsbs/core/text`) lands. Code points and UTF-8 lengths follow TextEncoder semantics (a lone surrogate is
 * U+FFFD, 3 bytes); grapheme clusters come from `Intl.Segmenter`, or one per code point when it is unavailable (PD-4).
 */

/** One code point of the text. */
export interface CodePointInfo {
  readonly cp: number;
  readonly char: string;
  readonly byteStart: number;
  readonly bytes: readonly number[];
}

export interface TextStats {
  readonly codePoints: number;
  readonly graphemes: number;
  readonly bytes: number;
  readonly chars: readonly CodePointInfo[];
}

const encoder = new TextEncoder();

/** Counts graphemes with Intl.Segmenter when available; otherwise one per code point. */
export function countGraphemes(text: string): number {
  let count = 0;
  if (typeof Intl.Segmenter === 'function') {
    for (const _ of new Intl.Segmenter(undefined, { granularity: 'grapheme' }).segment(text)) count++;
    return count;
  }
  for (const _ of text) count++;
  return count;
}

/** Per-code-point analysis (`limit` caps the per-char rows; counts always cover the whole text). */
export function textStats(text: string, limit = 2000): TextStats {
  const chars: CodePointInfo[] = [];
  let codePoints = 0;
  let bytes = 0;
  for (const raw of text) {
    const cp = raw.codePointAt(0) ?? 0xfffd;
    const isLoneSurrogate = cp >= 0xd800 && cp <= 0xdfff;
    const char = isLoneSurrogate ? '�' : raw;
    const encoded = encoder.encode(char);
    if (codePoints < limit)
      chars.push({ cp: isLoneSurrogate ? 0xfffd : cp, char, byteStart: bytes, bytes: [...encoded] });
    codePoints++;
    bytes += encoded.length;
  }
  return { codePoints, graphemes: countGraphemes(text), bytes, chars };
}

/** "U+7063" (at least four uppercase hex digits). */
export function codePointLabel(cp: number): string {
  return `U+${cp.toString(16).toUpperCase().padStart(4, '0')}`;
}

/** "E7" (two uppercase hex digits). */
export function byteHex(byte: number): string {
  return byte.toString(16).toUpperCase().padStart(2, '0');
}
