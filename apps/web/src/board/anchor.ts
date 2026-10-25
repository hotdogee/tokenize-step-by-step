/**
 * Anchored inspector placement (768–1023 px, 05 §5; AD-34; WCAG 2.4.11): the panel goes above or below a packed row and
 * never covers a row it must keep clear — the inspected (pinned or hovered) cell's row, which the panel explains, and the
 * row holding keyboard focus, so a user who pins and keeps arrowing in the grid always sees the focused cell. Pure
 * arithmetic in viewport px; the Board measures the rows and converts the result into layout coordinates.
 */

/** A row's vertical extent in viewport px. */
export interface Extent {
  readonly top: number;
  readonly bottom: number;
}

/** Space between the panel and the row it sits against, px. */
export const PANEL_GAP = 4;

/**
 * The viewport top of a panel `height` px tall that overlaps none of `rows` (most important first). Candidates, in order:
 * below then above each row; the first that also fits inside the viewport wins, else the clear candidate with the most
 * visible height. Below the lowest row is always clear, so a clear candidate always exists.
 */
export function placePanel(
  rows: readonly Extent[],
  height: number,
  viewportHeight: number,
  gap: number = PANEL_GAP,
): number {
  const candidates = rows.flatMap((row) => [row.bottom + gap, row.top - gap - height]);
  const lowest = Math.max(...rows.map((row) => row.bottom));
  candidates.push(lowest + gap);
  const clear = candidates.filter((top) => rows.every((row) => top + height <= row.top || top >= row.bottom));
  const fitting = clear.find((top) => top >= 0 && top + height <= viewportHeight);
  if (fitting !== undefined) return fitting;
  const visible = (top: number): number => Math.min(top + height, viewportHeight) - Math.max(top, 0);
  let best = clear[0] ?? lowest + gap;
  for (const top of clear) if (visible(top) > visible(best)) best = top;
  return best;
}
