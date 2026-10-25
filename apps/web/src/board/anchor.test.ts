/** Anchored inspector placement (05 §5, WCAG 2.4.11): the panel keeps the inspected row and the focused row clear. */
import { describe, expect, it } from 'vitest';
import { PANEL_GAP, placePanel, type Extent } from './anchor.ts';

const overlaps = (top: number, height: number, row: Extent): boolean => top < row.bottom && row.top < top + height;

describe('placePanel', () => {
  it('goes below the inspected row when it fits there', () => {
    expect(placePanel([{ top: 100, bottom: 250 }], 300, 900)).toBe(250 + PANEL_GAP);
  });

  it('flips above the row when there is no room below', () => {
    expect(placePanel([{ top: 600, bottom: 750 }], 300, 900)).toBe(600 - PANEL_GAP - 300);
  });

  it('keeps the focused row clear while a pinned row is inspected (pin, then PageDown)', () => {
    const pinned = { top: 100, bottom: 250 };
    const focused = { top: 400, bottom: 550 };
    const top = placePanel([pinned, focused], 300, 900);
    expect(overlaps(top, 300, pinned)).toBe(false);
    expect(overlaps(top, 300, focused)).toBe(false);
    expect(top).toBe(550 + PANEL_GAP);
  });

  it('uses the room above the focused row when the pinned row has scrolled away above', () => {
    const pinned = { top: -600, bottom: -450 };
    const focused = { top: 500, bottom: 650 };
    const top = placePanel([pinned, focused], 300, 700);
    expect(top).toBe(500 - PANEL_GAP - 300);
    expect(overlaps(top, 300, focused)).toBe(false);
  });

  it('never overlaps either row, even when nothing fits in the viewport', () => {
    for (let focusTop = -200; focusTop <= 900; focusTop += 25) {
      const pinned = { top: 150, bottom: 300 };
      const focused = { top: focusTop, bottom: focusTop + 150 };
      const top = placePanel([pinned, focused], 420, 700);
      expect(overlaps(top, 420, pinned), `focus at ${String(focusTop)}`).toBe(false);
      expect(overlaps(top, 420, focused), `focus at ${String(focusTop)}`).toBe(false);
    }
  });
});
