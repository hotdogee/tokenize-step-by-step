/**
 * Text-language resolution (05 §10, AD-38). The text-language chip (`TextLangChoice`) is separate from the UI locale; what
 * goes into `lang` attributes of the input mirror, glyph cells and example chips is a `ResolvedTextLang`:
 *
 * - `zh-Hant` → `zh-Hant-TW` (so the zh-TW UI root and glyph cells share the `:lang(zh)` TC font stack); `ja`, `en` as is;
 * - `auto`: any kana → `ja`; any Hangul → `ko`; Han (or Bopomofo) only → `zh-Hant-TW`, unless the UI locale is ja → `ja`;
 *   Latin / other → `und` (inherits the UI font).
 *
 * Script tests use explicit code-point ranges, not `\p{Script=…}`, so the result is identical in every browser.
 */
import type { ResolvedTextLang, TextLangChoice } from '@tsbs/core';
import type { Locale } from './types.ts';

type Range = readonly [from: number, to: number];

const KANA: readonly Range[] = [
  [0x3040, 0x30ff], // Hiragana, Katakana
  [0x31f0, 0x31ff], // Katakana Phonetic Extensions
  [0xff66, 0xff9f], // Halfwidth Katakana
  [0x1aff0, 0x1b16f], // Kana Extended-B, Kana Supplement, Kana Extended-A, Small Kana Extension
];
const HANGUL: readonly Range[] = [
  [0x1100, 0x11ff],
  [0x3130, 0x318f],
  [0xa960, 0xa97f],
  [0xac00, 0xd7af],
  [0xd7b0, 0xd7ff],
  [0xffa0, 0xffdc],
];
const HAN_OR_BOPOMOFO: readonly Range[] = [
  [0x2e80, 0x2fdf], // CJK Radicals Supplement, Kangxi Radicals
  [0x3005, 0x3007], // 々 〆 〇
  [0x3021, 0x3029], // Hangzhou numerals
  [0x3100, 0x312f], // Bopomofo
  [0x31a0, 0x31bf], // Bopomofo Extended
  [0x3400, 0x4dbf], // Extension A
  [0x4e00, 0x9fff], // Unified Ideographs
  [0xf900, 0xfaff], // Compatibility Ideographs
  [0x20000, 0x323af], // Extensions B–H, Compatibility Supplement
];

const inRanges = (cp: number, ranges: readonly Range[]): boolean => ranges.some(([from, to]) => cp >= from && cp <= to);

/** Resolves the chip choice for `text` under the UI locale. */
export function resolveTextLang(choice: TextLangChoice, text: string, uiLocale: Locale): ResolvedTextLang {
  if (choice === 'zh-Hant') return 'zh-Hant-TW';
  if (choice !== 'auto') return choice;
  let han = false;
  let hangul = false;
  for (const char of text) {
    const cp = char.codePointAt(0) ?? 0;
    if (inRanges(cp, KANA)) return 'ja';
    if (inRanges(cp, HANGUL)) hangul = true;
    else if (inRanges(cp, HAN_OR_BOPOMOFO)) han = true;
  }
  if (hangul) return 'ko';
  if (han) return uiLocale === 'ja' ? 'ja' : 'zh-Hant-TW';
  return 'und';
}
