/** The comparison table's column window (PA-19): clamping, the 128-column cap, hysteresis, rebasing. */
import { describe, expect, it } from 'vitest';
import { MAX_WINDOW, nextWindow, OVERSCAN, placeIn, visibleColumns } from './compare-window.ts';

describe('visibleColumns', () => {
  it('adds the overscan on each side and clamps to the table', () => {
    expect(visibleColumns(0, 300, 30, 1000)).toEqual({ start: 0, end: 10 + OVERSCAN });
    expect(visibleColumns(3000, 300, 30, 1000)).toEqual({ start: 100 - OVERSCAN, end: 110 + OVERSCAN });
    expect(visibleColumns(29_700, 300, 30, 1000)).toEqual({ start: 990 - OVERSCAN, end: 1000 });
  });

  it('never spans more than 128 columns: the overscan shrinks first, then the right part of the viewport', () => {
    const wide = visibleColumns(3000, 2400, 30, 1000);
    expect(wide.end - wide.start).toBe(MAX_WINDOW);
    expect(wide.start).toBeLessThanOrEqual(100);
    expect(wide.end).toBeGreaterThanOrEqual(180);
    expect(visibleColumns(0, 6000, 30, 1000)).toEqual({ start: 0, end: MAX_WINDOW });
  });

  it('covers a short table whole', () => {
    expect(visibleColumns(0, 1280, 30, 12)).toEqual({ start: 0, end: 12 });
  });
});

describe('nextWindow', () => {
  const cols = 1000;
  it('keeps the window while the visible columns stay in its inner part (no re-render for a small scroll)', () => {
    const current = visibleColumns(3000, 300, 30, cols);
    expect(nextWindow(current, 3090, 300, 30, cols)).toBe(current);
    expect(nextWindow(current, 2910, 300, 30, cols)).toBe(current);
  });

  it('moves the window once the visible columns leave its inner part', () => {
    const current = visibleColumns(3000, 300, 30, cols);
    const moved = nextWindow(current, 3600, 300, 30, cols);
    expect(moved).not.toBe(current);
    expect(moved).toEqual(visibleColumns(3600, 300, 30, cols));
  });

  it('is the whole table up to 128 columns', () => {
    const whole = { start: 0, end: 100 };
    expect(nextWindow(whole, 900, 300, 30, 100)).toBe(whole);
    expect(nextWindow({ start: 0, end: 12 }, 0, 300, 30, 100)).toEqual(whole);
  });
});

describe('placeIn', () => {
  it('rebases a cell to the window start and clips it at the window edges', () => {
    const window = { start: 100, end: 228 };
    expect(placeIn(window, 100, 3)).toEqual({ col: 0, span: 3 });
    expect(placeIn(window, 98, 4)).toEqual({ col: 0, span: 2 });
    expect(placeIn(window, 226, 6)).toEqual({ col: 126, span: 2 });
    expect(placeIn({ start: 0, end: 12 }, 9, 3)).toEqual({ col: 9, span: 3 });
  });
});
