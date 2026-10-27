/**
 * Render descriptors of the comparison table (PA-19, 05 §4), pure and Node-tested, so the components stay declarative.
 *
 * The table has one byte-column axis: the input text's UTF-8 (every row's options are fixed — `ROW_OPTIONS`: no NFKC,
 * no BOS, specials as text — so every result indexes the same bytes), after one marker column when a row starts with a
 * zero-width token (Grok-1's dummy prefix `▁`), which every row then shares. Descriptors carry absolute 0-based
 * columns; the components rebase them to the column window (compare-window.ts) for the placement classes.
 *
 * - `headerCells`: the header box's character cells (the glyph over its byte columns, stand-ins and dotted-circle bases
 *   as on the board, the U+ label of a character of ≥ 2 columns — CSS hides it below 480 px —, no tint: the header is
 *   shared by every row) and byte cells (hex, decimal, lead bytes bolder), for the columns of a window. The table keeps
 *   only the text's UTF-8 (`headerText`); each window analyses its own slice of the text (`analyzeText`, no grapheme
 *   segmenter), so a 200,000-code-point text costs its bytes, not a whole-text analysis (AD-27).
 * - `rowChips`: a result's chips in a window — the id inside every chip (`digitsOf`/`idLines` with the PA-17 rule: a
 *   1-column chip with nothing but its id and ≥ 5 digits sets two lines), the tint by token index, the hatched cut edges
 *   of a partial token, the byte-fallback piece, the lock, the SPECIAL badge, the zero-width marker, the text (shown only
 *   from 4 columns and only with the "Show token text" preference) and the `tokenLabel` name, which always says the
 *   token's text ("token 3 of 29, id 3236, 下, 3 bytes").
 */
import type { TokenizationResult } from '@tsbs/core';
import { TokenFlag, TokenKind } from '@tsbs/core/model/result';
import { analyzeText } from '@tsbs/core/text/analyze';
import { isCombiningMark, standInFor } from '@tsbs/core/text/stand-ins';
import { codePointLabel, hexByte } from '@tsbs/core/text/utf8';
import { digitsOf, idLines } from '../board/cells.ts';
import {
  byteRole,
  bytePiece,
  chipText,
  firstSpanToken,
  joinParts,
  spokenGlyph,
  tokenLabel,
  visualGlyph,
  type Translate,
} from '../board/labels.ts';
import type { ColumnWindow } from './compare-window.ts';

/** A character of the header box. */
export interface CompareCharModel {
  /** Code point index. */
  readonly index: number;
  /** Absolute column of its first byte, and its byte count. */
  readonly col: number;
  readonly span: number;
  readonly glyph: string;
  readonly standIn: boolean;
  readonly combining: boolean;
  readonly cjk: boolean;
  /** `U+53F0` for a character of ≥ 2 columns (CSS shows it from 480 px), else null. */
  readonly uLabel: string | null;
  readonly label: string;
}

/** A byte of the header box. */
export interface CompareByteModel {
  /** Byte offset. */
  readonly index: number;
  readonly col: number;
  readonly hex: string;
  readonly dec: number;
  /** The first byte of its code point (drawn bolder). */
  readonly lead: boolean;
  readonly label: string;
}

/** A chip of a row. */
export interface CompareChipModel {
  /** Token index. */
  readonly index: number;
  /** Byte span of the token (start === end for the zero-width marker). */
  readonly start: number;
  readonly end: number;
  /** Absolute first column and column span. */
  readonly col: number;
  readonly span: number;
  readonly id: number;
  readonly digits: number;
  readonly idLines: readonly [string, string] | null;
  /** Token index mod 8; −1 for the marker. */
  readonly tint: number;
  readonly partial: boolean;
  readonly hatchStart: boolean;
  readonly hatchEnd: boolean;
  /** `<0xF0>` for a byte-fallback piece. */
  readonly bytePiece: string | null;
  readonly userDefined: boolean;
  readonly special: boolean;
  readonly marker: 'dummy' | 'bos' | null;
  /** The marker's `▁` / `BOS`. */
  readonly markerText: string | null;
  /** The visible text from 4 columns (shown only with the "Show token text" preference), else null. */
  readonly text: string | null;
  readonly label: string;
}

const CJK_FROM = 0x2e80;

/** Index of the last element of `starts[0…count)` ≤ `value` (the run holding `value`), or 0. */
function runOf(starts: ArrayLike<number>, count: number, value: number): number {
  let low = 0;
  let high = count - 1;
  while (low < high) {
    const mid = (low + high + 1) >> 1;
    if ((starts[mid] ?? 0) <= value) low = mid;
    else high = mid - 1;
  }
  return Math.max(0, low);
}

/** The first token is zero-width (the shared marker column, PA-19). */
export function hasLeadingMarker(result: TokenizationResult): boolean {
  return result.tokens.count > 0 && ((result.tokens.flags[0] ?? 0) & TokenFlag.ZeroWidth) !== 0;
}

/** The text the header box describes: the string, its UTF-8 (TextEncoder semantics, as every engine) and its code points. */
export interface HeaderText {
  readonly text: string;
  readonly utf8: Uint8Array;
  readonly codePoints: number;
}

const continuation = (byte: number): boolean => (byte & 0xc0) === 0x80;

/** `text` as the header box needs it (see `HeaderText`). */
export function headerText(text: string): HeaderText {
  const utf8 = new TextEncoder().encode(text);
  let codePoints = 0;
  for (const byte of utf8) if (!continuation(byte)) codePoints++;
  return { text, utf8, codePoints };
}

/** The header box's cells for the columns of `window` (`marker`: 1 when the marker column is there, else 0). */
export function headerCells(
  source: HeaderText,
  options: { readonly window: ColumnWindow; readonly marker: number; readonly t: Translate },
): { readonly chars: CompareCharModel[]; readonly bytes: CompareByteModel[] } {
  const { window, marker, t } = options;
  const { text, utf8, codePoints } = source;
  const firstByte = Math.max(0, window.start - marker);
  const lastByte = Math.min(utf8.length, window.end - marker);
  const charCells: CompareCharModel[] = [];
  const byteCells: CompareByteModel[] = [];
  if (lastByte <= firstByte) return { chars: charCells, bytes: byteCells };
  // The whole code points the window touches: their first code point's index and UTF-16 offset, by counting lead bytes
  // (a 4-byte sequence is a surrogate pair; a lone surrogate arrived as EF BF BD, one unit, like every other 3 bytes).
  let first = firstByte;
  while (first > 0 && continuation(utf8[first] ?? 0)) first--;
  let last = lastByte;
  while (last < utf8.length && continuation(utf8[last] ?? 0)) last++;
  let index = 0;
  let from = 0;
  for (let b = 0; b < first; b++) {
    const byte = utf8[b] ?? 0;
    if (continuation(byte)) continue;
    index++;
    from += byte >= 0xf0 ? 2 : 1;
  }
  let to = from;
  for (let b = first; b < last; b++) {
    const byte = utf8[b] ?? 0;
    if (!continuation(byte)) to += byte >= 0xf0 ? 2 : 1;
  }
  const part = analyzeText(text.slice(from, to), { segmenter: null });
  const { chars } = part;
  for (let i = 0; i < chars.count; i++) {
    const start = (chars.byteStart[i] ?? 0) + first;
    const span = (chars.byteStart[i + 1] ?? 0) + first - start;
    const cp = chars.cp[i] ?? 0;
    const standIn = standInFor(cp) !== null;
    charCells.push({
      index: index + i,
      col: start + marker,
      span,
      glyph: visualGlyph(part, i),
      standIn,
      combining: !standIn && isCombiningMark(cp),
      cjk: cp >= CJK_FROM,
      uLabel: span >= 2 ? codePointLabel(cp) : null,
      label: joinParts(
        [
          t('a11y.cell.char', { index: index + i + 1, count: codePoints, glyph: spokenGlyph(part, i, t) }),
          !isCombiningMark(cp) && codePointLabel(cp),
          t('counts.bytes', { n: span }),
        ],
        t,
      ),
    });
  }
  for (let b = firstByte; b < lastByte; b++) {
    const value = utf8[b] ?? 0;
    byteCells.push({
      index: b,
      col: b + marker,
      hex: hexByte(value),
      dec: value,
      lead: !continuation(value),
      label: joinParts(
        [
          t('a11y.cell.byte', { index: b + 1, count: utf8.length, hex: hexByte(value) }),
          t('a11y.cell.decimal', { dec: value }),
          byteRole(part, b - first, t, (i) => spokenGlyph(part, i, t)),
        ],
        t,
      ),
    });
  }
  return { chars: charCells, bytes: byteCells };
}

/** What `rowChips` needs besides the result. */
export interface ChipOptions {
  readonly window: ColumnWindow;
  /** 1 when the table has the marker column, else 0. */
  readonly marker: number;
  readonly t: Translate;
  /** The first piece fuses the dummy prefix (`fusesDummy`). */
  readonly fusedDummy?: boolean;
  /** The partial-character mark is shown (the "Mark partial-character tokens" preference): it shares the chip. */
  readonly hatchMark?: boolean;
}

/** `result`'s chips in `options.window`, in token order. */
export function rowChips(result: TokenizationResult, options: ChipOptions): CompareChipModel[] {
  const { window, marker, t, fusedDummy = false, hatchMark = false } = options;
  const { tokens, utf8 } = result;
  const out: CompareChipModel[] = [];
  if (tokens.count === 0) return out;
  const spm = result.family === 'spm-bpe';
  const fused = fusedDummy ? firstSpanToken(result) : -1;
  // The leading zero-width token sits in the marker column (column 0); rows have no other zero-width tokens (no BOS).
  if (marker === 1 && hasLeadingMarker(result) && window.start === 0) {
    const kind = tokens.kind[0] ?? 0;
    const id = tokens.id[0] ?? 0;
    const dummy = kind === TokenKind.DummyPrefix;
    out.push({
      index: 0,
      start: 0,
      end: 0,
      col: 0,
      span: 1,
      id,
      digits: digitsOf(id),
      idLines: idLines(id, digitsOf(id), 1, dummy),
      tint: -1,
      partial: false,
      hatchStart: false,
      hatchEnd: false,
      bytePiece: null,
      userDefined: false,
      special: !dummy,
      marker: dummy ? 'dummy' : 'bos',
      markerText: dummy ? '▁' : t('board.bos'),
      text: null,
      label: tokenLabel(result, 0, t, false),
    });
  }
  const firstByte = Math.max(0, window.start - marker);
  const lastByte = Math.min(utf8.length, window.end - marker);
  if (lastByte <= firstByte) return out;
  // The first token ending after `firstByte`.
  let i = runOf(tokens.byteStart, tokens.count, firstByte);
  while (i > 0 && (tokens.byteStart[i - 1] ?? 0) === (tokens.byteStart[i] ?? 0)) i--;
  for (; i < tokens.count; i++) {
    const start = tokens.byteStart[i] ?? 0;
    const end = tokens.byteStart[i + 1] ?? start;
    if (start >= lastByte) break;
    if (end <= firstByte || end === start) continue; // before the window, or zero-width
    const flags = tokens.flags[i] ?? 0;
    const kind = tokens.kind[i] ?? 0;
    const id = tokens.id[i] ?? 0;
    const span = end - start;
    const partial = (flags & TokenFlag.Partial) !== 0;
    const special = (flags & TokenFlag.Special) !== 0;
    const text = chipText(result, start, end, t, spm, i === fused);
    const bare = !(partial && hatchMark) && !special && kind !== TokenKind.Byte && kind !== TokenKind.UserDefined;
    out.push({
      index: i,
      start,
      end,
      col: start + marker,
      span,
      id,
      digits: digitsOf(id),
      idLines: idLines(id, digitsOf(id), span, bare),
      tint: i % 8,
      partial,
      hatchStart: kind !== TokenKind.Byte && (flags & TokenFlag.StartsMidChar) !== 0,
      hatchEnd: kind !== TokenKind.Byte && (flags & TokenFlag.EndsMidChar) !== 0,
      bytePiece: kind === TokenKind.Byte ? bytePiece(utf8[start] ?? 0) : null,
      userDefined: kind === TokenKind.UserDefined,
      special,
      marker: null,
      markerText: null,
      text: span >= 4 ? (text?.visible ?? null) : null,
      label: tokenLabel(result, i, t, i === fused, text?.spoken ?? null),
    });
  }
  return out;
}

/** The token whose chip covers byte `byte` of `result` (the zero-width marker for the marker column, `byte` −1), or −1. */
export function tokenAtByte(result: TokenizationResult, byte: number): number {
  if (byte < 0) return hasLeadingMarker(result) ? 0 : -1;
  if (byte >= result.utf8.length) return -1;
  return result.byteToToken[byte] ?? -1;
}
