/**
 * `packRows` (05 §3.2, AD-17, AD-25): packs a result into board rows of at most K uniform columns, once per (result, K).
 *
 * Every byte is one column at every stage, a code point is never split across rows, and each zero-width token (BOS,
 * Grok-1's dummy `▁`) takes a full **marker column** placed immediately before the code point at its boundary
 * (`markersBefore(i)` is 0, 1 or 2 — BOS and the dummy can both precede code point 0); a zero-width token at the end of the
 * text (BOS on empty text) takes a trailing column, in a new row if the last one is full. Spans (graphemes, chunks,
 * tokens, live parts) become one `Fragment` per row they touch; all fragments of a span share its `spanId` (the index in
 * its table), and `first` / `last` tell the board where to draw the continuation marks.
 *
 * Properties (property-tested): rows ≤ K columns; fragments tile each span's bytes; for K ≥ 8 every row but the last wastes
 * at most maxUnit − 1 columns (maxUnit = 4 + the largest markersBefore); markers stay with their code point; deterministic.
 * A zero-width live part (the dummy before it merges) maps onto the dummy's marker column when the dummy is a final
 * zero-width token, else to a zero-span fragment at byte 0's column.
 */
import { TokenKind, type TokenizationResult } from '../model/result.ts';
import type { Fragment, PartsAt, RowModel } from '../model/view-types.ts';

export interface PackOptions {
  /** Live parts at the current step (`TokenizationView.partsAt(k)`); `parts` stays empty without them. */
  readonly parts?: PartsAt | null;
}

interface Placement {
  /** Row of each byte. */
  readonly rowOfByte: Int32Array;
  /** Column of each byte within its row. */
  readonly colOfByte: Int32Array;
  /** Marker column of each zero-width token (−1 for other tokens), and its row. */
  readonly markerCol: Int32Array;
  readonly markerRow: Int32Array;
}

function spanFragments(rows: readonly RowModel[], at: Placement, spanId: number, s: number, e: number): Fragment[] {
  const out: Fragment[] = [];
  if (!(e > s)) return out;
  for (let r = at.rowOfByte[s] ?? 0; r < rows.length; r++) {
    const row = rows[r];
    if (row === undefined || row.byteStart >= e) break;
    const fs = Math.max(s, row.byteStart);
    const fe = Math.min(e, row.byteEnd);
    if (fe <= fs) continue;
    const colStart = at.colOfByte[fs] ?? 0;
    out.push({
      spanId,
      row: r,
      colStart,
      colSpan: (at.colOfByte[fe - 1] ?? 0) + 1 - colStart,
      first: fs === s,
      last: fe === e,
      byteStart: fs,
      byteEnd: fe,
    });
  }
  return out;
}

function partFragmentsInto(rows: RowModel[], at: Placement, result: TokenizationResult, parts: PartsAt): void {
  const { partStart } = parts;
  let dummyCol = -1;
  let dummyRow = -1;
  for (let t = 0; t < result.tokens.count; t++) {
    if (result.tokens.kind[t] === TokenKind.DummyPrefix && (at.markerCol[t] ?? -1) >= 0) {
      dummyCol = at.markerCol[t] ?? -1;
      dummyRow = at.markerRow[t] ?? -1;
    }
  }
  for (let p = 0; p + 1 < partStart.length; p++) {
    const s = partStart[p] ?? 0;
    const e = partStart[p + 1] ?? 0;
    if (s === e) {
      const row = dummyRow >= 0 ? dummyRow : (at.rowOfByte[0] ?? 0);
      const colStart = dummyCol >= 0 ? dummyCol : (at.colOfByte[0] ?? 0);
      rows[row]?.parts.push({
        spanId: p,
        row,
        colStart,
        colSpan: dummyCol >= 0 ? 1 : 0,
        first: true,
        last: true,
        byteStart: s,
        byteEnd: e,
      });
      continue;
    }
    for (const f of spanFragments(rows, at, p, s, e)) rows[f.row]?.parts.push(f);
  }
}

function newRow(index: number, byteStart: number): RowModel {
  return {
    index,
    byteStart,
    byteEnd: byteStart,
    columns: 0,
    chars: [],
    markers: [],
    bytes: [],
    graphemes: [],
    chunks: [],
    tokens: [],
    parts: [],
  };
}

/** Packs `result` into rows of at most `K` columns (K ≥ 1; the board clamps K to 8..64, 05 §3.3). */
export function packRows(result: TokenizationResult, K: number, options: PackOptions = {}): RowModel[] {
  if (!Number.isInteger(K) || K < 1) throw new RangeError(`K must be a positive integer, got ${String(K)}`);
  const { chars, tokens, utf8, graphemes, chunks } = result;
  const n = utf8.length;
  const markersAt = new Map<number, number[]>();
  for (let t = 0; t < tokens.count; t++) {
    const s = tokens.byteStart[t] ?? 0;
    if (s !== tokens.byteStart[t + 1]) continue;
    const list = markersAt.get(s);
    if (list) list.push(t);
    else markersAt.set(s, [t]);
  }
  const at: Placement = {
    rowOfByte: new Int32Array(n),
    colOfByte: new Int32Array(n),
    markerCol: new Int32Array(tokens.count).fill(-1),
    markerRow: new Int32Array(tokens.count).fill(-1),
  };
  const rows: RowModel[] = [];
  let cur = newRow(0, 0);
  const closeRow = (nextByte: number): void => {
    rows.push(cur);
    cur = newRow(rows.length, nextByte);
  };
  const placeMarker = (t: number): void => {
    const col = cur.columns++;
    cur.markers.push({ col, token: t });
    at.markerCol[t] = col;
    at.markerRow[t] = cur.index;
  };
  for (let i = 0; i < chars.count; i++) {
    const s = chars.byteStart[i] ?? 0;
    const e = chars.byteStart[i + 1] ?? 0;
    const markers = markersAt.get(s) ?? [];
    const width = e - s + markers.length;
    if (cur.columns + width > K && cur.columns > 0) closeRow(s);
    for (const t of markers) placeMarker(t);
    const colStart = cur.columns;
    for (let b = s; b < e; b++) {
      const col = cur.columns++;
      at.rowOfByte[b] = cur.index;
      at.colOfByte[b] = col;
      cur.bytes.push({ col, byte: b });
    }
    cur.byteEnd = e;
    cur.chars.push({
      spanId: i,
      row: cur.index,
      colStart,
      colSpan: e - s,
      first: true,
      last: true,
      byteStart: s,
      byteEnd: e,
    });
  }
  for (const t of markersAt.get(n) ?? []) {
    if (cur.columns + 1 > K && cur.columns > 0) closeRow(n);
    placeMarker(t);
  }
  rows.push(cur);

  for (let g = 0; g < graphemes.count; g++) {
    for (const f of spanFragments(rows, at, g, graphemes.byteStart[g] ?? 0, graphemes.byteStart[g + 1] ?? 0)) {
      rows[f.row]?.graphemes.push(f);
    }
  }
  for (let c = 0; c < chunks.count; c++) {
    for (const f of spanFragments(rows, at, c, chunks.byteStart[c] ?? 0, chunks.byteStart[c + 1] ?? 0)) {
      rows[f.row]?.chunks.push(f);
    }
  }
  for (let t = 0; t < tokens.count; t++) {
    for (const f of spanFragments(rows, at, t, tokens.byteStart[t] ?? 0, tokens.byteStart[t + 1] ?? 0)) {
      rows[f.row]?.tokens.push(f);
    }
  }
  if (options.parts) partFragmentsInto(rows, at, result, options.parts);
  return rows;
}

/**
 * The same rows with `parts` recomputed for another step, without repacking (rows depend on (result, K) only). Returns new
 * row objects; the other arrays are shared with the input rows.
 */
export function withParts(rows: readonly RowModel[], result: TokenizationResult, parts: PartsAt): RowModel[] {
  const n = result.utf8.length;
  const at: Placement = {
    rowOfByte: new Int32Array(n),
    colOfByte: new Int32Array(n),
    markerCol: new Int32Array(result.tokens.count).fill(-1),
    markerRow: new Int32Array(result.tokens.count).fill(-1),
  };
  for (const row of rows) {
    for (const { col, byte } of row.bytes) {
      at.rowOfByte[byte] = row.index;
      at.colOfByte[byte] = col;
    }
    for (const { col, token } of row.markers) {
      at.markerCol[token] = col;
      at.markerRow[token] = row.index;
    }
  }
  const out = rows.map((row) => ({ ...row, parts: [] as Fragment[] }));
  partFragmentsInto(out, at, result, parts);
  return out;
}
