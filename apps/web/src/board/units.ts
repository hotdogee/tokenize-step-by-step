/**
 * The board's logical cells per tier (05 §3.2, §8): code points, bytes, chunks, and tokens (stop 6) or live parts
 * (stops 4–5). A unit fragmented over several packed rows is ONE logical cell; keyboard focus lands on its first fragment.
 * Focus and pin are kept as byte-offset anchors (AD-17) so they survive re-tokenization, a new K and a virtual remount:
 * `resolve(anchor)` finds the unit that now holds the anchor's byte (the nearest one when the byte is gone).
 */
import type { PartsAt, RowModel, TokenizationResult } from '@tsbs/core';
import type { BoardTier } from './geometry.ts';

/** A logical cell: a unit index in a tier (char index, byte offset, chunk, token or part index). */
export interface CellRef {
  readonly tier: BoardTier;
  readonly index: number;
}

/**
 * Where focus or pin sits, independent of the current tokenization: the tier, the byte offset where the unit starts, and
 * for zero-width units (BOS, dummy prefix) which of the zero-width units at that boundary (`slot` ≥ 0; −1 otherwise).
 */
export interface Anchor {
  readonly tier: BoardTier;
  readonly byte: number;
  readonly slot: number;
}

/** One fragment of a unit as placed on the board: packed row, 0-based first column and column span. */
export interface Placed {
  readonly row: number;
  readonly col: number;
  readonly span: number;
}

/** A unit as it appears in one packed row (sorted by column). */
export interface RowItem extends Placed {
  readonly index: number;
}

/** The byte span of a unit (`start === end` for zero-width units). */
export interface Span {
  readonly start: number;
  readonly end: number;
}

export class BoardUnits {
  readonly result: TokenizationResult;
  readonly rows: readonly RowModel[];
  /** Live parts on the token tier (stops 4–5), or null when it shows the final tokens. */
  readonly parts: PartsAt | null;
  readonly #rowOfByte: Int32Array;
  readonly #colOfByte: Int32Array;
  readonly #markers = new Map<number, Placed>();

  constructor(result: TokenizationResult, rows: readonly RowModel[], parts: PartsAt | null) {
    this.result = result;
    this.rows = rows;
    this.parts = parts;
    const n = result.utf8.length;
    this.#rowOfByte = new Int32Array(n);
    this.#colOfByte = new Int32Array(n);
    for (const row of rows) {
      for (const { col, byte } of row.bytes) {
        this.#rowOfByte[byte] = row.index;
        this.#colOfByte[byte] = col;
      }
      for (const { col, token } of row.markers) this.#markers.set(token, { row: row.index, col, span: 1 });
    }
  }

  /** Number of units in `tier`. */
  count(tier: BoardTier): number {
    const { chars, utf8, chunks, tokens } = this.result;
    switch (tier) {
      case 'char':
        return chars.count;
      case 'hex':
      case 'dec':
        return utf8.length;
      case 'chunk':
        return chunks.count;
      case 'token':
        return this.parts === null ? tokens.count : this.parts.partStart.length - 1;
    }
  }

  /** The byte span of unit `index` in `tier`. */
  span(tier: BoardTier, index: number): Span {
    const { chars, chunks, tokens } = this.result;
    switch (tier) {
      case 'char':
        return { start: chars.byteStart[index] ?? 0, end: chars.byteStart[index + 1] ?? 0 };
      case 'hex':
      case 'dec':
        return { start: index, end: index + 1 };
      case 'chunk':
        return { start: chunks.byteStart[index] ?? 0, end: chunks.byteStart[index + 1] ?? 0 };
      case 'token': {
        const starts = this.parts === null ? tokens.byteStart : this.parts.partStart;
        return { start: starts[index] ?? 0, end: starts[index + 1] ?? 0 };
      }
    }
  }

  /** The fragments of a unit in row order (empty when the unit has no column, e.g. a zero-width part before it fuses). */
  placed(ref: CellRef): Placed[] {
    const { tier, index } = ref;
    if (index < 0 || index >= this.count(tier)) return [];
    const { start, end } = this.span(tier, index);
    if (tier === 'char' || tier === 'hex' || tier === 'dec') {
      if (end <= start) return [];
      return [{ row: this.#rowOfByte[start] ?? 0, col: this.#colOfByte[start] ?? 0, span: end - start }];
    }
    if (tier === 'token' && this.parts === null && start === end) {
      const marker = this.#markers.get(index);
      return marker === undefined ? [] : [marker];
    }
    const out: Placed[] = [];
    const firstRow = start < this.result.utf8.length ? (this.#rowOfByte[start] ?? 0) : this.rows.length - 1;
    for (let r = Math.max(0, firstRow); r < this.rows.length; r++) {
      const row = this.rows[r];
      if (row === undefined) break;
      if (start !== end && row.byteStart >= end) break;
      const list = tier === 'chunk' ? row.chunks : this.parts === null ? row.tokens : row.parts;
      const fragment = list.find((f) => f.spanId === index && f.colSpan > 0);
      if (fragment !== undefined) out.push({ row: r, col: fragment.colStart, span: fragment.colSpan });
      if (start === end) break;
    }
    return out;
  }

  /** True when the unit has a column on the board (keyboard navigation skips the others). */
  navigable(ref: CellRef): boolean {
    return this.placed(ref).length > 0;
  }

  /** Packed row of the unit's first fragment (−1 when it has none). */
  rowOf(ref: CellRef): number {
    return this.placed(ref)[0]?.row ?? -1;
  }

  /** The navigable units of `tier` that have a fragment in packed row `row`, by column. */
  inRow(tier: BoardTier, row: number): RowItem[] {
    const model = this.rows[row];
    if (model === undefined) return [];
    let items: RowItem[];
    switch (tier) {
      case 'char':
        items = model.chars.map((f) => ({ index: f.spanId, row, col: f.colStart, span: f.colSpan }));
        break;
      case 'hex':
      case 'dec':
        items = model.bytes.map((b) => ({ index: b.byte, row, col: b.col, span: 1 }));
        break;
      case 'chunk':
        items = model.chunks.map((f) => ({ index: f.spanId, row, col: f.colStart, span: f.colSpan }));
        break;
      case 'token':
        items =
          this.parts === null
            ? [
                ...model.markers.map((m) => ({ index: m.token, row, col: m.col, span: 1 })),
                ...model.tokens.map((f) => ({ index: f.spanId, row, col: f.colStart, span: f.colSpan })),
              ]
            : model.parts
                .filter((f) => f.colSpan > 0)
                .map((f) => ({ index: f.spanId, row, col: f.colStart, span: f.colSpan }));
        break;
    }
    return items.sort((a, b) => a.col - b.col);
  }

  /** The zero-width units at boundary `byte` in the token tier, in order. */
  #zeroWidthAt(byte: number): number[] {
    const out: number[] = [];
    const total = this.count('token');
    for (let i = 0; i < total; i++) {
      const { start, end } = this.span('token', i);
      if (start === byte && end === byte) out.push(i);
      else if (start > byte) break;
    }
    return out;
  }

  /** The anchor of a unit (byte offset where it starts; slot for zero-width units). */
  anchorOf(ref: CellRef): Anchor {
    const { start, end } = this.span(ref.tier, ref.index);
    const slot = ref.tier === 'token' && start === end ? this.#zeroWidthAt(start).indexOf(ref.index) : -1;
    return { tier: ref.tier, byte: start, slot };
  }

  /** The unit holding `anchor` now: the zero-width unit in its slot, else the unit covering its byte (clamped). */
  resolve(anchor: Anchor): CellRef | null {
    const { tier } = anchor;
    const total = this.count(tier);
    if (total === 0) return null;
    const n = this.result.utf8.length;
    if (tier === 'token' && anchor.slot >= 0) {
      const zero = this.#zeroWidthAt(anchor.byte);
      const index = zero[Math.min(anchor.slot, zero.length - 1)];
      if (index !== undefined) return { tier, index };
    }
    if (n === 0) return { tier, index: total - 1 };
    const byte = Math.min(Math.max(0, anchor.byte), n - 1);
    switch (tier) {
      case 'char':
        return { tier, index: this.result.byteToChar[byte] ?? 0 };
      case 'hex':
      case 'dec':
        return { tier, index: byte };
      case 'chunk':
        return { tier, index: Math.max(0, this.result.byteToChunk[byte] ?? 0) };
      case 'token': {
        if (this.parts === null) return { tier, index: Math.max(0, this.result.byteToToken[byte] ?? 0) };
        return { tier, index: this.#partAt(byte) };
      }
    }
  }

  /** The non-zero-width part covering `byte` (binary search over the part starts). */
  #partAt(byte: number): number {
    const starts = this.parts?.partStart ?? new Uint32Array(1);
    let lo = 0;
    let hi = starts.length - 2;
    while (lo < hi) {
      const mid = (lo + hi + 1) >> 1;
      if ((starts[mid] ?? 0) <= byte) lo = mid;
      else hi = mid - 1;
    }
    while (lo + 1 < starts.length - 1 && starts[lo] === starts[lo + 1]) lo++;
    return lo;
  }
}
