/**
 * Arithmetic virtualization (05 §3.3, AD-27): rows have a fixed height per breakpoint, so the rows in view follow from the
 * scroll offset alone (`scrollTop → row`), and rows outside the window are not mounted. The window always includes the
 * rows holding the focused and the pinned cell (05 §8), so roving `tabindex` never loses its element, and at stop 5 the
 * row holding the part the current step formed, so follow mode can mark and reach it after a jump (05 §2, PA-13).
 */

/** Rows mounted beyond each edge of the viewport. */
export const OVERSCAN = 2;
/** PA-11: a board with more grid cells than this is virtualized (2,000 cells must render in ≤ 50 ms of script, 06 §3). */
export const VIRTUALIZE_CELLS = 600;
/** PA-11: a board with more packed rows than this is virtualized. */
export const VIRTUALIZE_ROWS = 8;
/** Boards with at most this many packed rows (and at most `VIRTUALIZE_CELLS` cells) mount every row. */
export const VIRTUALIZE_ABOVE = VIRTUALIZE_ROWS;

/** Whether a board of `cells` grid cells in `rows` packed rows mounts only its window (PA-11: whichever bound first). */
export function shouldVirtualize(cells: number, rows: number): boolean {
  return cells > VIRTUALIZE_CELLS || rows > VIRTUALIZE_ROWS;
}

export interface RowRange {
  /** First and last row index of the window (inclusive); `last < first` for an empty board. */
  readonly first: number;
  readonly last: number;
}

/**
 * The rows overlapping the viewport plus the overscan. `viewTop` is the viewport top minus the grid top in px (negative
 * while the grid is still below the fold), `viewHeight` the viewport height; `virtualize` false mounts every row
 * (default: by row count alone; the board passes `shouldVirtualize`, which also counts cells).
 */
export function visibleRows(
  viewTop: number,
  viewHeight: number,
  rowHeight: number,
  rowCount: number,
  overscan: number = OVERSCAN,
  virtualize: boolean = rowCount > VIRTUALIZE_ROWS,
): RowRange {
  if (rowCount <= 0) return { first: 0, last: -1 };
  if (!virtualize || !(rowHeight > 0)) return { first: 0, last: rowCount - 1 };
  const top = Math.floor(viewTop / rowHeight);
  const bottom = Math.ceil((viewTop + Math.max(0, viewHeight)) / rowHeight) - 1;
  const first = Math.min(rowCount - 1, Math.max(0, top - overscan));
  const last = Math.max(first, Math.min(rowCount - 1, Math.max(0, bottom) + overscan));
  return { first, last };
}

/** The mounted row indices: the window plus every row in `keep` (focused, pinned, just merged), sorted and unique. */
export function mountedRows(range: RowRange, keep: ReadonlyArray<number | null>, rowCount: number): number[] {
  const rows = new Set<number>();
  for (let r = range.first; r <= range.last; r++) rows.add(r);
  for (const r of keep) if (r !== null && r >= 0 && r < rowCount) rows.add(r);
  return [...rows].sort((a, b) => a - b);
}

/** Spacer heights (px) before each mounted row and after the last one, so the grid keeps its full height. */
export function spacers(mounted: readonly number[], rowCount: number, rowHeight: number): number[] {
  const out: number[] = [];
  let next = 0;
  for (const r of mounted) {
    out.push((r - next) * rowHeight);
    next = r + 1;
  }
  out.push(Math.max(0, rowCount - next) * rowHeight);
  return out;
}
