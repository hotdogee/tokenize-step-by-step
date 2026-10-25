/**
 * The board's pure model: K from the 05 §3.3 formula, the tiers per stage, ARIA row indices, arithmetic windowing, the
 * logical cells (fragments as one cell, byte-offset anchors that survive re-tokenization) and the 05 §8 keyboard state
 * machine on a 3-row fixture (o200k `ja-text` at K = 9, the 360 px phone layout).
 */
import { describe, expect, it } from 'vitest';
import { boardContext, caseResult } from './fixture-results.test-helper.ts';
import {
  appTier,
  ariaRowIndex,
  columnsFor,
  GUTTER,
  MAX_COLUMNS,
  MIN_COLUMNS,
  tiersFor,
  tokenMode,
} from './geometry.ts';
import { navigate, navKeyOf, resolveAnchor, type NavKey } from './navigation.ts';
import type { CellRef } from './units.ts';
import { mountedRows, spacers, VIRTUALIZE_ABOVE, visibleRows } from './window.ts';

describe('K = clamp(8, floor((boardWidth − 2·gutter) / cell), 64) (05 §3.3)', () => {
  const formula = (width: number, cell: number): number =>
    Math.min(64, Math.max(8, Math.floor((width - 2 * 16) / cell)));

  it('follows the formula over a sweep of widths and cells', () => {
    for (let width = 200; width <= 4000; width += 37)
      for (const cell of [27, 29, 30, 32, 35, 36, 37, 40, 44])
        expect(columnsFor(width, cell)).toBe(formula(width, cell));
  });

  it('clamps to the generated placement classes and keeps a column for sub-pixel widths', () => {
    expect(MIN_COLUMNS).toBe(8);
    expect(MAX_COLUMNS).toBe(64); // = the generated .c64/.s64 classes (plugins/grid-classes.test.ts)
    expect(GUTTER).toBe(16);
    expect(columnsFor(100, 36)).toBe(8);
    expect(columnsFor(100_000, 30)).toBe(64);
    expect(columnsFor(1088 - 1e-9 + 32, 32)).toBe(34);
    expect(columnsFor(800, 0)).toBe(8);
  });
});

describe('tiers per stage (05 §2, §8)', () => {
  const tiers = (stage: 1 | 2 | 3 | 4 | 5 | 6, byteView: 'hex' | 'dec' | 'both' = 'hex', wide = true) =>
    tiersFor({ stage, byteView, wide, chunkTier: true, tokens: true });

  it('adds bytes at stop 3, chunks at stops 4–5 and the token tier from stop 4', () => {
    expect(tiers(1)).toEqual(['char']);
    expect(tiers(2)).toEqual(['char']);
    expect(tiers(3)).toEqual(['char', 'hex']);
    expect(tiers(4)).toEqual(['char', 'hex', 'chunk', 'token']);
    expect(tiers(5, 'both')).toEqual(['char', 'hex', 'dec', 'chunk', 'token']);
    expect(tiers(6, 'dec')).toEqual(['char', 'dec', 'token']);
  });

  it('offers hex and dec rows only at ≥ 1024 px, chunk brackets only at ≥ 480 px, tokens only with a result', () => {
    expect(tiers(6, 'both', false)).toEqual(['char', 'hex', 'token']);
    expect(tiersFor({ stage: 5, byteView: 'hex', wide: false, chunkTier: false, tokens: true })).toEqual([
      'char',
      'hex',
      'token',
    ]);
    expect(tiersFor({ stage: 6, byteView: 'hex', wide: true, chunkTier: true, tokens: false })).toEqual([
      'char',
      'hex',
    ]);
  });

  it('numbers ARIA rows packedRow × tiers + tier + 1 and maps byte rows to the byte tier', () => {
    expect(ariaRowIndex(0, 0, 3)).toBe(1);
    expect(ariaRowIndex(2, 1, 3)).toBe(8);
    expect(appTier('hex')).toBe('byte');
    expect(appTier('dec')).toBe('byte');
    expect(appTier('chunk')).toBe('chunk');
    expect(tokenMode(5)).toBe('parts');
    expect(tokenMode(6)).toBe('tokens');
  });
});

describe('arithmetic windowing (AD-27)', () => {
  it('mounts every row of a short board and a window plus overscan of a long one', () => {
    expect(visibleRows(0, 900, 172, 5)).toEqual({ first: 0, last: 4 });
    expect(visibleRows(1720, 900, 172, 400)).toEqual({ first: 8, last: 17 });
    expect(visibleRows(-300, 900, 172, 400)).toEqual({ first: 0, last: 5 });
    expect(visibleRows(1e9, 900, 172, 400)).toEqual({ first: 399, last: 399 });
    expect(VIRTUALIZE_ABOVE).toBeGreaterThan(0);
  });

  it('always keeps the focused and pinned rows and pads the gaps with spacers', () => {
    const rows = mountedRows({ first: 10, last: 12 }, [3, null, 11, 250], 300);
    expect(rows).toEqual([3, 10, 11, 12, 250]);
    expect(spacers(rows, 300, 100)).toEqual([300, 600, 0, 0, 23_700, 4_900]);
    expect(spacers(rows, 300, 100).reduce((a, b) => a + b, 0) + rows.length * 100).toBe(300 * 100);
  });
});

describe('logical cells and anchors', () => {
  it('treats a span fragmented over rows as one cell with one fragment per row', () => {
    // o200k `mixed-hello-taiwan-tokyo` at K = 9: token 4 (185244, " 東京") wraps from row 1 to row 2.
    const ctx = boardContext(caseResult('openai-o200k_base', 'mixed-hello-taiwan-tokyo'), { K: 9 });
    const placed = ctx.units.placed({ tier: 'token', index: 4 });
    expect(placed.map((p) => p.row)).toEqual([1, 2]);
    expect(ctx.units.rowOf({ tier: 'token', index: 4 })).toBe(1);
    expect(ctx.units.inRow('token', 2).map((item) => item.index)).toEqual([4, 5, 6]);
  });

  it('places a zero-width token in its own full column and anchors it by slot', () => {
    const ctx = boardContext(caseResult('xai-grok1', 'zh-tw-tainan', { addBos: true }), { K: 9 });
    expect(ctx.units.placed({ tier: 'token', index: 0 })).toEqual([{ row: 0, col: 0, span: 1 }]);
    expect(ctx.units.placed({ tier: 'token', index: 1 })).toEqual([{ row: 0, col: 1, span: 1 }]);
    expect(ctx.units.anchorOf({ tier: 'token', index: 1 })).toEqual({ tier: 'token', byte: 0, slot: 1 });
    expect(ctx.units.resolve({ tier: 'token', byte: 0, slot: 1 })).toEqual({ tier: 'token', index: 1 });
    expect(ctx.units.resolve({ tier: 'token', byte: 0, slot: -1 })).toEqual({ tier: 'token', index: 2 });
  });

  it('resolves an anchor by byte offset across re-tokenization (cl100k → o200k)', () => {
    const cl100k = boardContext(caseResult('openai-cl100k_base', 'zh-tw-tainan'), { K: 34 });
    const anchor = cl100k.units.anchorOf({ tier: 'token', index: 2 }); // 96 = A3, byte 5
    expect(anchor).toEqual({ tier: 'token', byte: 5, slot: -1 });
    const o200k = boardContext(caseResult('openai-o200k_base', 'zh-tw-tainan'), { K: 9 });
    expect(o200k.units.resolve(anchor)).toEqual({ tier: 'token', index: 1 }); // 133072 = 灣
    expect(o200k.units.resolve({ tier: 'hex', byte: 99, slot: -1 })).toEqual({ tier: 'hex', index: 11 });
  });

  it('resolves the focus anchor to a navigable cell of the nearest shown tier (05 §8)', () => {
    const ctx = boardContext(caseResult('openai-cl100k_base', 'zh-tw-tainan'), { K: 34, stage: 3 });
    const token = { tier: 'token' as const, byte: 5, slot: -1 };
    expect(resolveAnchor(ctx.units, ctx.tiers, token)).toEqual({ tier: 'hex', index: 5 }); // no token tier at stop 3
    expect(resolveAnchor(ctx.units, ctx.tiers, { tier: 'char', byte: 4, slot: -1 })).toEqual({
      tier: 'char',
      index: 1,
    });
  });

  it('keeps a tab stop on empty text whose only cell is a trailing BOS marker (Llama 3 + addBos, AD-25)', () => {
    const ctx = boardContext(caseResult('meta-llama3', 'empty', { addBos: true }), { K: 9 });
    expect(ctx.tiers).toEqual(['char', 'hex', 'token']);
    expect(ctx.units.count('char')).toBe(0);
    const start = { tier: 'char' as const, byte: 0, slot: -1 }; // the Board's initial focus anchor
    expect(resolveAnchor(ctx.units, ctx.tiers, start)).toEqual({ tier: 'token', index: 0 });
    expect(ctx.units.navigable({ tier: 'token', index: 0 })).toBe(true);
  });
});

describe('keyboard state machine on a 3-row fixture (05 §8)', () => {
  // o200k `ja-text` 日本語のテキスト at K = 9: rows [日本語] [のテキ] [スト]; tokens 日本 · 語 · の · テ · キ · スト.
  const result = caseResult('openai-o200k_base', 'ja-text');
  const final = boardContext(result, { K: 9, stage: 6 });
  const replay = boardContext(result, { K: 9, stage: 5, step: 3 });
  const go = (ctx: typeof final, from: CellRef, key: NavKey): CellRef | null =>
    navigate(ctx.units, ctx.tiers, from, key);
  const char = (index: number): CellRef => ({ tier: 'char', index });

  it('has three packed rows', () => {
    expect(final.units.rows).toHaveLength(3);
    expect(final.tiers).toEqual(['char', 'hex', 'token']);
  });

  it('←/→ move by unit and wrap across rows; edges are no-ops', () => {
    expect(go(final, char(0), 'right')).toEqual(char(1));
    expect(go(final, char(2), 'right')).toEqual(char(3));
    expect(go(final, char(3), 'left')).toEqual(char(2));
    expect(go(final, char(0), 'left')).toBeNull();
    expect(go(final, char(7), 'right')).toBeNull();
  });

  it('↑/↓ change tier keeping the byte anchor; ↑ on the top tier and ↓ on the bottom tier do nothing', () => {
    expect(go(final, char(1), 'down')).toEqual({ tier: 'hex', index: 3 });
    expect(go(final, { tier: 'hex', index: 4 }, 'down')).toEqual({ tier: 'token', index: 0 });
    expect(go(final, { tier: 'token', index: 5 }, 'up')).toEqual({ tier: 'hex', index: 18 });
    expect(go(final, { tier: 'hex', index: 18 }, 'up')).toEqual(char(6));
    expect(go(final, char(4), 'up')).toBeNull();
    expect(go(final, { tier: 'token', index: 2 }, 'down')).toBeNull();
  });

  it('Home/End go to the row edges, Ctrl+Home/End to the board edges', () => {
    expect(go(final, { tier: 'hex', index: 12 }, 'home')).toEqual({ tier: 'hex', index: 9 });
    expect(go(final, { tier: 'hex', index: 12 }, 'end')).toEqual({ tier: 'hex', index: 17 });
    expect(go(final, { tier: 'hex', index: 12 }, 'boardStart')).toEqual({ tier: 'hex', index: 0 });
    expect(go(final, { tier: 'hex', index: 12 }, 'boardEnd')).toEqual({ tier: 'hex', index: 23 });
  });

  it('PageUp/PageDown change packed row at the nearest column', () => {
    expect(go(final, char(1), 'pageDown')).toEqual(char(4));
    expect(go(final, char(4), 'pageDown')).toEqual(char(7));
    expect(go(final, char(6), 'pageDown')).toBeNull();
    expect(go(final, char(5), 'pageUp')).toEqual(char(2));
    expect(go(final, char(0), 'pageUp')).toBeNull();
  });

  it('the chunk wrapped over all three rows is one cell (focus on its first fragment, no other chunk to reach)', () => {
    expect(replay.tiers).toEqual(['char', 'hex', 'chunk', 'token']);
    const chunk = { tier: 'chunk' as const, index: 0 };
    expect(replay.units.placed(chunk).map((p) => p.row)).toEqual([0, 1, 2]);
    expect(go(replay, chunk, 'right')).toBeNull();
    expect(go(replay, chunk, 'pageDown')).toBeNull();
    expect(go(replay, char(7), 'down')).toEqual({ tier: 'hex', index: 21 });
    expect(go(replay, { tier: 'hex', index: 21 }, 'down')).toEqual(chunk);
  });

  it('maps keydowns to navigation keys (Ctrl/⌘ + Home/End = board edges)', () => {
    const key = (k: string, mods: Partial<Record<'ctrlKey' | 'metaKey' | 'altKey', boolean>> = {}) =>
      navKeyOf({ key: k, ctrlKey: false, metaKey: false, altKey: false, ...mods });
    expect(key('ArrowLeft')).toBe('left');
    expect(key('Home', { ctrlKey: true })).toBe('boardStart');
    expect(key('End', { metaKey: true })).toBe('boardEnd');
    expect(key('PageDown')).toBe('pageDown');
    expect(key('ArrowLeft', { altKey: true })).toBeNull();
    expect(key('a')).toBeNull();
  });
});
