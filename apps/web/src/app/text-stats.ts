/**
 * Main-thread text figures for the counts line, the stage announcements and the board placeholder, from WP01's
 * `analyzeText` (`@tsbs/core/text/analyze`): code points and UTF-8 bytes follow TextEncoder semantics (a lone surrogate is
 * U+FFFD, 3 bytes) and grapheme clusters come from `Intl.Segmenter`, or one per code point without it (PD-4). They need
 * no tokenizer, so they stay live in every long-input tier (AD-27).
 */
import { analyzeText } from '@tsbs/core/text/analyze';

export { codePointLabel, hexByte as byteHex } from '@tsbs/core/text/utf8';

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

/** Per-code-point analysis (`limit` caps the per-char rows; counts always cover the whole text). */
export function textStats(text: string, limit = 2000): TextStats {
  const { utf8, chars: table, graphemes } = analyzeText(text);
  const chars: CodePointInfo[] = [];
  for (let i = 0; i < Math.min(limit, table.count); i++) {
    const cp = table.cp[i] ?? 0xfffd;
    const byteStart = table.byteStart[i] ?? 0;
    chars.push({
      cp,
      char: String.fromCodePoint(cp),
      byteStart,
      bytes: [...utf8.subarray(byteStart, table.byteStart[i + 1] ?? utf8.length)],
    });
  }
  return { codePoints: table.count, graphemes: graphemes.count, bytes: utf8.length, chars };
}
