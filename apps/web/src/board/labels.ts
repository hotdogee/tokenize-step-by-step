/**
 * Text for screen readers and the inspector (05 §4, §8, §10): glyph names (stand-ins, combining marks), the coverage list
 * of a token or part ("first 2 of 3 bytes of 灣"), byte roles and the `aria-label` of every board cell. All strings come
 * from the catalogs through `t`, so every template renders in zh-TW, ja and en; ids, hex/dec values and offsets stay raw
 * ASCII digits (05 §10). Pure functions over a `TokenizationResult`.
 */
import type { CharTable, TokenizationResult } from '@tsbs/core';
import { TokenFlag, TokenKind } from '@tsbs/core/model/result';
import { isCombiningMark, standInFor, standInGlyph, type StandInKey } from '@tsbs/core/text/stand-ins';
import { codePointLabel, decodeUtf8, hexByte } from '@tsbs/core/text/utf8';
import type { MessageKey } from '../i18n/en.ts';
import type { Params } from '../i18n/types.ts';

/** The translator the board uses (`i18n.t`, or `translate` bound to a locale in tests). */
export type Translate = (key: MessageKey, params?: Params) => string;

/**
 * What the glyph and byte-role helpers read: the text, its per-code-point columns and the byte → code point map — a
 * `TokenizationResult`, or a bare `analyzeText` analysis (the comparison table's header, PA-19).
 */
export interface TextColumnsLike {
  readonly text: string;
  readonly chars: Pick<CharTable, 'cp' | 'utf16Start' | 'byteStart' | 'grapheme'>;
  readonly byteToChar: ArrayLike<number>;
}

const STAND_IN_NAMES: Readonly<Record<StandInKey, MessageKey>> = {
  space: 'a11y.standin.space',
  tab: 'a11y.standin.tab',
  lf: 'a11y.standin.lineFeed',
  cr: 'a11y.standin.carriageReturn',
  nbsp: 'a11y.standin.noBreakSpace',
  whitespace: 'a11y.standin.whiteSpace',
  control: 'a11y.standin.control',
  bom: 'a11y.standin.bom',
  zwj: 'a11y.standin.zwj',
  zwnj: 'a11y.standin.zwnj',
};

/** Stand-ins drawn as letters (ZWJ, ZWNJ, BOM): their spoken name starts with the same letters (WCAG 2.5.3). */
const SPELLED_STAND_INS: ReadonlySet<StandInKey> = new Set(['zwj', 'zwnj', 'bom']);

/** The dotted-circle base a combining mark is drawn on (05 §4; aria-hidden in the cell). */
export const DOTTED_CIRCLE = '◌';

/** Variation selectors (FE00–FE0F, E0100–E01EF) are described as such, other marks as combining marks (05 §4). */
export function isVariationSelector(cp: number): boolean {
  return (cp >= 0xfe00 && cp <= 0xfe0f) || (cp >= 0xe0100 && cp <= 0xe01ef);
}

/** The source text of code point `i`. */
export function charText(result: TextColumnsLike, i: number): string {
  const { chars, text } = result;
  return text.slice(chars.utf16Start[i] ?? 0, chars.utf16Start[i + 1] ?? text.length);
}

/** What the char tier draws for code point `i`: the stand-in, the mark on a dotted circle, or the glyph itself. */
export function visualGlyph(result: TextColumnsLike, i: number): string {
  const cp = result.chars.cp[i] ?? 0;
  const standIn = standInFor(cp);
  if (standIn !== null) return standInGlyph(standIn, cp);
  if (isCombiningMark(cp)) return DOTTED_CIRCLE + charText(result, i);
  return charText(result, i);
}

/** The base a combining mark attaches to: the previous code point of the same grapheme cluster, else the dotted circle. */
function baseOf(result: TextColumnsLike, i: number): string {
  const { chars } = result;
  if (i > 0 && chars.grapheme[i - 1] === chars.grapheme[i]) return charText(result, i - 1);
  return DOTTED_CIRCLE;
}

/** What a screen reader hears for code point `i`: the stand-in's name, the combining-mark sentence, or the glyph. */
export function spokenGlyph(result: TextColumnsLike, i: number, t: Translate): string {
  const cp = result.chars.cp[i] ?? 0;
  const standIn = standInFor(cp);
  if (standIn !== null) {
    const name = t(STAND_IN_NAMES[standIn], { cp: codePointLabel(cp) });
    return SPELLED_STAND_INS.has(standIn) ? `${standInGlyph(standIn, cp)} ${name}` : name;
  }
  if (isCombiningMark(cp)) {
    const key = isVariationSelector(cp) ? 'a11y.variationSelector' : 'a11y.combining';
    return t(key, { cp: codePointLabel(cp), base: baseOf(result, i) });
  }
  return charText(result, i);
}

/** The spm escaped-space glyph (piece display only, 05 §4). */
const ESCAPED_SPACE = '▁';

/** A chip's visible text and its screen-reader form (`chipText`). */
export interface ChipText {
  readonly visible: string;
  readonly spoken: string;
}

/**
 * What a token chip shows for the byte span [start, end) and what a screen reader hears (05 §4, §4.1; AD-36): the text
 * with the char tier's stand-ins (`standInGlyph`: `␠ ⇥ ⏎ ␍ ⍽ ⟨U+0085⟩ BOM ZWJ ZWNJ`; `▁` for an spm space, and in front
 * when the chip fuses the dummy prefix), and the same text with each glyph followed by its localized name ("a ZWJ
 * zero-width joiner b"), so the accessible name keeps the visible label in order (WCAG 2.5.3) without a raw glyph that a
 * screen reader would read literally. Null when the span is not whole UTF-8.
 */
export function chipText(
  result: TokenizationResult,
  start: number,
  end: number,
  t: Translate,
  spm: boolean,
  fusedDummy = false,
): ChipText | null {
  const text = decodeUtf8(result.utf8, start, end);
  if (text === null) return null;
  let visible = '';
  const spoken: string[] = [];
  let run = '';
  const glyph = (shown: string, name: string): void => {
    visible += shown;
    if (run !== '') spoken.push(run);
    run = '';
    spoken.push(`${shown} ${name}`);
  };
  if (fusedDummy) glyph(ESCAPED_SPACE, t('a11y.standin.escapedSpace'));
  for (const ch of text) {
    const cp = ch.codePointAt(0) ?? 0;
    const standIn = standInFor(cp);
    if (spm && cp === 0x20) glyph(ESCAPED_SPACE, t('a11y.standin.escapedSpace'));
    else if (standIn !== null) glyph(standInGlyph(standIn, cp), t(STAND_IN_NAMES[standIn], { cp: codePointLabel(cp) }));
    else {
      visible += ch;
      run += ch;
    }
  }
  if (run !== '') spoken.push(run);
  return { visible, spoken: spoken.join(' ') };
}

/** Joins label parts with the locale's separator (", " / "，" / "、"), skipping empty ones. */
export function joinParts(parts: ReadonlyArray<string | null | false>, t: Translate): string {
  return parts.filter((part): part is string => typeof part === 'string' && part !== '').join(t('a11y.sep'));
}

/**
 * The coverage list of the byte span [start, end): whole code points by name, partly covered ones as "first/last n of m
 * bytes of X" or "n of m bytes from inside X". `glyph(i)` names code point i (spoken or visual).
 */
export function coverageList(
  result: TokenizationResult,
  start: number,
  end: number,
  t: Translate,
  glyph: (i: number) => string,
): string {
  if (end <= start) return '';
  const { chars, byteToChar } = result;
  const items: string[] = [];
  const first = byteToChar[start] ?? 0;
  const last = byteToChar[end - 1] ?? first;
  for (let i = first; i <= last; i++) {
    const cs = chars.byteStart[i] ?? 0;
    const ce = chars.byteStart[i + 1] ?? 0;
    const s = Math.max(start, cs);
    const e = Math.min(end, ce);
    const params = { n: e - s, total: ce - cs, glyph: glyph(i) };
    if (s === cs && e === ce) items.push(glyph(i));
    else if (s === cs) items.push(t('a11y.part.first', params));
    else if (e === ce) items.push(t('a11y.part.last', params));
    else items.push(t('a11y.part.middle', params));
  }
  return items.join(t('a11y.sep'));
}

/** True when the byte span starts or ends inside a code point. */
export function cutsChar(result: TokenizationResult, start: number, end: number): boolean {
  if (end <= start) return false;
  const { chars, byteToChar, utf8 } = result;
  const startsMid = chars.byteStart[byteToChar[start] ?? 0] !== start;
  const endsMid = end < utf8.length && chars.byteStart[byteToChar[end] ?? 0] !== end;
  return startsMid || endsMid;
}

/** The byte's role in its code point ("first byte of 灣"). */
export function byteRole(result: TextColumnsLike, byte: number, t: Translate, glyph: (i: number) => string): string {
  const { chars, byteToChar } = result;
  const i = byteToChar[byte] ?? 0;
  const cs = chars.byteStart[i] ?? 0;
  const total = (chars.byteStart[i + 1] ?? cs + 1) - cs;
  const pos = byte - cs + 1;
  const params = { glyph: glyph(i), pos, total };
  if (total === 1) return t('a11y.byteRole.single', params);
  if (pos === 1) return t('a11y.byteRole.first', params);
  if (pos === total) return t('a11y.byteRole.last', params);
  return t('a11y.byteRole.middle', params);
}

/** `<0xF0>`: the SentencePiece byte-fallback piece spelling of a byte. */
export function bytePiece(byte: number): string {
  return `<0x${hexByte(byte)}>`;
}

/** `aria-label` of char cell `i` (05 §8). `source` is the NFKC source text when normalization changed this run. */
export function charLabel(result: TokenizationResult, i: number, t: Translate, source: string | null): string {
  const { chars } = result;
  const cp = chars.cp[i] ?? 0;
  const bytes = (chars.byteStart[i + 1] ?? 0) - (chars.byteStart[i] ?? 0);
  const first = chars.tokenFirst[i] ?? -1;
  const last = chars.tokenLast[i] ?? -1;
  // A stand-in spelled with letters (ZWJ) is followed by its U+ label on screen: keep that order, name after (WCAG 2.5.3).
  const standIn = standInFor(cp);
  const spelled = standIn !== null && SPELLED_STAND_INS.has(standIn);
  return joinParts(
    [
      t('a11y.cell.char', {
        index: i + 1,
        count: chars.count,
        glyph: spelled ? standInGlyph(standIn, cp) : spokenGlyph(result, i, t),
      }),
      !isCombiningMark(cp) && codePointLabel(cp),
      spelled && t(STAND_IN_NAMES[standIn], { cp: codePointLabel(cp) }),
      t('counts.bytes', { n: bytes }),
      first >= 0 && last > first && t('a11y.cell.splitAcross', { n: last - first + 1 }),
      source !== null && t('a11y.cell.normalizedFrom', { source }),
    ],
    t,
  );
}

/** `aria-label` of byte cell `byte`: "byte 4 of 12: E7, decimal 231, first byte of 灣, in token 2 of 5 (id 66285, partial)". */
export function byteLabel(result: TokenizationResult, byte: number, t: Translate): string {
  const { utf8, tokens, byteToToken } = result;
  const value = utf8[byte] ?? 0;
  const token = tokens.count > 0 ? (byteToToken[byte] ?? -1) : -1;
  const partial = token >= 0 && ((tokens.flags[token] ?? 0) & TokenFlag.Partial) !== 0;
  const charStart = result.chars.byteStart[result.byteToChar[byte] ?? 0] === byte;
  const cut = token >= 0 && !charStart && byteToToken[byte - 1] !== token;
  return joinParts(
    [
      t('a11y.cell.byte', { index: byte + 1, count: utf8.length, hex: hexByte(value) }),
      t('a11y.cell.decimal', { dec: value }),
      byteRole(result, byte, t, (i) => spokenGlyph(result, i, t)),
      token >= 0 &&
        t(partial ? 'a11y.cell.inTokenPartial' : 'a11y.cell.inToken', {
          index: token + 1,
          count: tokens.count,
          id: tokens.id[token] ?? 0,
        }),
      cut && t('a11y.marker.partialCut'),
    ],
    t,
  );
}

/**
 * `aria-label` of final token `index` (markers included): "token 2 of 5, id 66285, 2 bytes, partial: first 2 of 3 bytes of
 * 灣". `visible` is the spoken form of the text the chip shows after its id (`chipText(…).spoken`: the piece with each
 * stand-in glyph followed by its name), so the name contains the visible label in the same order (WCAG 2.5.3): id,
 * visible text, SPECIAL badge. A byte-fallback chip shows `<0xE7>` under its id and a BOS marker `BOS` under its id
 * (PA-17), so their names say the piece right after the id too.
 */
export function tokenLabel(
  result: TokenizationResult,
  index: number,
  t: Translate,
  fusedDummy: boolean,
  visible: string | null = null,
): string {
  const { tokens, utf8 } = result;
  const start = tokens.byteStart[index] ?? 0;
  const end = tokens.byteStart[index + 1] ?? 0;
  const id = tokens.id[index] ?? 0;
  const kind = tokens.kind[index] ?? 0;
  const flags = tokens.flags[index] ?? 0;
  if (start === end) {
    if (kind === TokenKind.DummyPrefix)
      return joinParts([t('a11y.marker.zeroWidthDummy'), t('a11y.cell.id', { id })], t);
    return joinParts([t('a11y.marker.zeroWidthBos'), t('a11y.cell.id', { id }), t('board.bos')], t);
  }
  const spoken = (i: number): string => spokenGlyph(result, i, t);
  const piece = kind === TokenKind.Byte ? bytePiece(utf8[start] ?? 0) : null;
  return joinParts(
    [
      t('a11y.cell.token', { index: index + 1, count: tokens.count, id }),
      piece ?? visible,
      (flags & TokenFlag.Special) !== 0 && `${t('board.special')} ${t('a11y.marker.special')}`,
      t('counts.bytes', { n: end - start }),
      piece !== null && t('a11y.cell.byteFallback'),
      kind === TokenKind.UserDefined && t('a11y.marker.userDefined'),
      fusedDummy && index === firstSpanToken(result) && t('inspector.fusedDummy'),
      (flags & TokenFlag.Partial) !== 0 &&
        t('a11y.cell.partial', { list: coverageList(result, start, end, t, spoken) }),
      (flags & TokenFlag.Partial) !== 0 && t('a11y.marker.splits'),
    ],
    t,
  );
}

/** Index of the first non-zero-width token (the one that fuses the dummy prefix), or −1. */
export function firstSpanToken(result: TokenizationResult): number {
  const { tokens } = result;
  for (let i = 0; i < tokens.count; i++) if (tokens.byteStart[i] !== tokens.byteStart[i + 1]) return i;
  return -1;
}

/**
 * `aria-label` of live part `index` (stops 4–5). The id comes before the hex — a byte-fallback part's `piece` (`<0xF0>`)
 * instead — in the order the chip shows them, so the visible label is part of the name (WCAG 2.5.3; PA-17 put the id
 * inside the chip). A `userDefined` part (a USER_DEFINED symbol, which the chip marks with the aria-hidden lock alone)
 * also says "pre-matched symbol, never merges", as `tokenLabel` does (AD-36).
 */
export function partLabel(
  result: TokenizationResult,
  index: number,
  count: number,
  start: number,
  end: number,
  id: number,
  t: Translate,
  piece: string | null = null,
  userDefined = false,
): string {
  if (start === end) return joinParts([t('a11y.marker.zeroWidthDummy'), id >= 0 && t('a11y.cell.id', { id })], t);
  const spoken = (i: number): string => spokenGlyph(result, i, t);
  const hex: string[] = [];
  for (let b = start; b < end; b++) hex.push(hexByte(result.utf8[b] ?? 0));
  return joinParts(
    [
      t('a11y.cell.part', { index: index + 1, count }),
      id >= 0 && t('a11y.cell.id', { id }),
      piece ?? hex.join(' '),
      t('counts.bytes', { n: end - start }),
      userDefined && t('a11y.marker.userDefined'),
      cutsChar(result, start, end) && t('a11y.cell.partial', { list: coverageList(result, start, end, t, spoken) }),
    ],
    t,
  );
}

/** The text a chunk bracket shows: "chunk 1 · rule 2" (+ "no merges" for a multi-byte direct hit at stop 5). */
export function chunkText(result: TokenizationResult, index: number, t: Translate, noMerges: boolean): string {
  const rule = result.chunks.rule[index] ?? 255;
  return [
    t('board.chunk', { index: index + 1 }),
    rule === 255 ? null : t('board.chunkRule', { rule }),
    noMerges ? t('board.noMerges') : null,
  ]
    .filter((part): part is string => part !== null)
    .join(' · ');
}

/** `aria-label` of chunk `index`; it starts with the bracket's visible text (WCAG 2.5.3). */
export function chunkLabel(result: TokenizationResult, index: number, t: Translate, noMerges = false): string {
  const { chunks } = result;
  const start = chunks.byteStart[index] ?? 0;
  const end = chunks.byteStart[index + 1] ?? 0;
  return joinParts(
    [
      chunkText(result, index, t, noMerges),
      t('a11y.cell.chunk', { index: index + 1, count: chunks.count }),
      t('counts.bytes', { n: end - start }),
      !noMerges && chunks.directHit[index] === 1 && end - start > 1 && t('inspector.directHit'),
    ],
    t,
  );
}
