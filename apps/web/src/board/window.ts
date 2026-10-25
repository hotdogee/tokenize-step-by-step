/**
 * Arithmetic virtualization (05 §3.3, AD-27): rows have a fixed height per breakpoint, so the rows in view follow from the
 * scroll offset alone (`scrollTop → row`), and rows outside the window are not mounted. The window always includes the
 * rows holding the focused and the pinned cell (05 §8), so roving `tabindex` never loses its element, and at stop 5 the
 * row holding the part the current step formed, so follow mode can mark and reach it after a jump (05 §2, PA-13).
 */

/** Rows mounted beyond each edge of the viewport. */
export const OVERSCAN = 2;
/** Boards with at most this many packed rows mount every row (≈ the "full board" tier of AD-27 for short inputs). */
export const VIRTUALIZE_ABOVE = 24;

export interface RowRange {
  /** First and last row index of the window (inclusive); `last < first` for an empty board. */
  readonly first: number;
  readonly last: number;
}

/**
 * The rows overlapping the viewport plus the overscan. `viewTop` is the viewport top minus the grid top in px (negative
 * while the grid is still below the fold), `viewHeight` the viewport height.
 */
export function visibleRows(
  viewTop: number,
  viewHeight: number,
  rowHeight: number,
  rowCount: number,
  overscan: number = OVERSCAN,
): RowRange {
  if (rowCount <= 0) return { first: 0, last: -1 };
  if (rowCount <= VIRTUALIZE_ABOVE || !(rowHeight > 0)) return { first: 0, last: rowCount - 1 };
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
