/**
 * The comparison table's column window (PA-19, 05 §4): every scroller of the table renders the same window of at most
 * `MAX_WINDOW` byte columns around what is on screen, so a 20,000-byte text mounts a few hundred cells, not 100,000, and
 * the generated placement classes (`.c1…c128`, `.s1…s128`; plugins/grid-classes.ts) place every cell rebased to the
 * window start. The window moves only when the visible columns leave its inner part (hysteresis: a scroll of a few
 * columns re-renders nothing); a focus move to a chip off the window scrolls the table to it first, and the window
 * follows the scroll (CompareTable `reveal`). Pure arithmetic.
 */

/** The largest window (= the generated placement classes). */
export const MAX_WINDOW = 128;
/** Columns mounted beyond each edge of the visible ones. */
export const OVERSCAN = 24;

/** A column range `[start, end)`, 0-based, absolute (marker column included). */
export interface ColumnWindow {
  readonly start: number;
  readonly end: number;
}

const clamp = (value: number, low: number, high: number): number => Math.min(high, Math.max(low, value));

/** The columns on screen for a scroll position (`pitch`: one column's width in px). */
function onScreen(scrollLeft: number, viewportWidth: number, pitch: number, cols: number): ColumnWindow {
  if (!(pitch > 0)) return { start: 0, end: Math.min(cols, MAX_WINDOW) };
  const start = clamp(Math.floor(scrollLeft / pitch), 0, cols);
  const end = clamp(Math.ceil((scrollLeft + viewportWidth) / pitch), start, cols);
  return { start, end };
}

/**
 * The window for a scroll position: the visible columns plus `overscan` on each side, clamped to `[0, cols)` and to at
 * most `MAX_WINDOW` columns (the overscan shrinks first, evenly; a viewport wider than the window keeps its left part).
 */
export function visibleColumns(
  scrollLeft: number,
  viewportWidth: number,
  pitch: number,
  cols: number,
  overscan: number = OVERSCAN,
): ColumnWindow {
  const seen = onScreen(scrollLeft, viewportWidth, pitch, cols);
  let start = Math.max(0, seen.start - overscan);
  let end = Math.min(cols, seen.end + overscan);
  if (end - start <= MAX_WINDOW) return { start, end };
  const spare = MAX_WINDOW - (seen.end - seen.start);
  if (spare <= 0) return { start: seen.start, end: seen.start + MAX_WINDOW };
  start = Math.max(0, seen.start - Math.floor(spare / 2));
  end = Math.min(cols, start + MAX_WINDOW);
  return { start: Math.max(0, end - MAX_WINDOW), end };
}

/**
 * The window after a scroll: `current` while the visible columns, widened by half the overscan, stay inside it (clamped
 * to the table), else a fresh `visibleColumns` window. A table of at most `MAX_WINDOW` columns is one window.
 */
export function nextWindow(
  current: ColumnWindow,
  scrollLeft: number,
  viewportWidth: number,
  pitch: number,
  cols: number,
  overscan: number = OVERSCAN,
): ColumnWindow {
  if (cols <= MAX_WINDOW) return current.start === 0 && current.end === cols ? current : { start: 0, end: cols };
  const seen = onScreen(scrollLeft, viewportWidth, pitch, cols);
  const margin = Math.floor(overscan / 2);
  const inner = { start: Math.max(0, seen.start - margin), end: Math.min(cols, seen.end + margin) };
  if (current.end <= cols && inner.start >= current.start && inner.end <= current.end) return current;
  return visibleColumns(scrollLeft, viewportWidth, pitch, cols, overscan);
}

/** Where a cell at absolute columns `[col, col + span)` sits in `window`: rebased first column (0-based) and span, clipped. */
export function placeIn(
  window: ColumnWindow,
  col: number,
  span: number,
): { readonly col: number; readonly span: number } {
  const start = Math.max(col, window.start);
  const end = Math.min(col + Math.max(1, span), window.end);
  return { col: start - window.start, span: Math.max(1, end - start) };
}
