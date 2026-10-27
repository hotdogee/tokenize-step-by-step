/**
 * BYOK in chromium (05 §13): the live token tier drawn through the board's extra-tier hook (row-aligned chips under the
 * Grok-2 token tier, hatched cuts exactly at the differing boundaries, one extra 32 px track per row right under the token
 * tier and before the gap, as tall as the token cells from 2560 px, aria-hidden, never for an unaligned answer, only at
 * stop 6, every fragment's id inside its chip by the board's rule and above the cuts), and the drawer's key lifecycle
 * (lazy body, masked input, exact request headers through `fetch`, the key forgotten on "Forget key", on collapse and on
 * `pagehide`, never in web storage).
 */
import '../theme/base.css';
import axe from 'axe-core';
import { flushSync, mount, unmount } from 'svelte';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { page } from 'vitest/browser';
import { appWith, cellPx, fixtureResult, frames, mountBoard, type MountedBoard } from '../board/board.test-helper.ts';
import DrawerHarness from './DrawerHarness.test-helper.svelte';
import { drawer } from './drawer.svelte.ts';
import { keys } from './keys.svelte.ts';
import { answers } from './live-state.svelte.ts';
import { alignLiveTokens, type LiveToken } from './live-tier.ts';
import LiveTierRow from './LiveTierRow.svelte';

const GROK2 = { id: 'xai-grok2', family: 'bytelevel-bpe' } as const;
const WCAG: axe.RunOptions = {
  runOnly: { type: 'tag', values: ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa'] },
};

async function axeViolations(target: HTMLElement): Promise<string[]> {
  const results = await axe.run(target, WCAG);
  return results.violations.map((v) => `${v.id}: ${v.nodes.map((n) => n.target.join(' ')).join(', ')}`);
}
const TEXT = '台灣台南';
const encoder = new TextEncoder();

/** Live tokens cutting TEXT's UTF-8 at `cuts`. */
function cutAt(cuts: readonly number[]): LiveToken[] {
  const utf8 = encoder.encode(TEXT);
  const edges = [0, ...cuts, utf8.length];
  return edges.slice(1).map((end, i) => ({ id: 100 + i, text: null, bytes: utf8.slice(edges[i], end) }));
}

/** `tokens` with the ids `ids` (the rest keep theirs). */
function withIds(tokens: readonly LiveToken[], ids: readonly number[]): LiveToken[] {
  return tokens.map((token, i) => ({ ...token, id: ids[i] ?? token.id }));
}

interface Box {
  readonly left: number;
  readonly right: number;
  readonly top: number;
  readonly bottom: number;
}

/** The chip's padding box: its border box less the border. */
function paddingBox(chip: Element): Box {
  const rect = chip.getBoundingClientRect();
  const style = getComputedStyle(chip);
  const px = (value: string): number => Number.parseFloat(value);
  return {
    left: rect.left + px(style.borderLeftWidth),
    right: rect.right - px(style.borderRightWidth),
    top: rect.top + px(style.borderTopWidth),
    bottom: rect.bottom - px(style.borderBottomWidth),
  };
}

/** A line of an id: across, the extent of its digits (a Range over its text); down, its line box. */
function lineRun(line: Element): Box {
  const range = document.createRange();
  range.selectNodeContents(line);
  const text = range.getBoundingClientRect();
  const box = line.getBoundingClientRect();
  return { left: text.left, right: text.right, top: box.top, bottom: box.bottom };
}

function expectWithin(inner: Box, outer: Box, what: string): void {
  expect(inner.left, `${what} left`).toBeGreaterThanOrEqual(outer.left - 0.02);
  expect(inner.right, `${what} right`).toBeLessThanOrEqual(outer.right + 0.02);
  expect(inner.top, `${what} top`).toBeGreaterThanOrEqual(outer.top - 0.02);
  expect(inner.bottom, `${what} bottom`).toBeLessThanOrEqual(outer.bottom + 0.02);
}

/** The digits subset is `font-display: block`: wait for it so the rects measure its glyphs. */
async function digitsLoaded(): Promise<void> {
  await document.fonts.load('12px "TSBS Digits"', '0123456789');
  await frames(2);
}

function showAnswer(tokens: readonly LiveToken[]): void {
  answers.setXai(
    { text: TEXT, model: 'grok-4.7', tokens, alignment: alignLiveTokens(TEXT, tokens, GROK2) },
    { tokenizer: 'xai-grok2', row: LiveTierRow },
  );
  flushSync();
}

let board: MountedBoard | null = null;

afterEach(() => {
  document.documentElement.dataset['cellSize'] = 'M';
  answers.clear();
  keys.forgetAll();
  drawer.open = false;
  board?.destroy();
  board = null;
  vi.restoreAllMocks();
});

describe('live token tier on the board (extra-tier hook)', () => {
  it('lines the live tokens up under the Grok-2 tier and hatches exactly the differing boundaries', async () => {
    await page.viewport(1440, 900);
    const app = appWith(fixtureResult('xai-grok2', 'zh-tw-tainan'));
    board = await mountBoard(app, 600);
    const grid = board.grid;
    const rowHeight = grid.querySelector<HTMLElement>('.bd-row')?.offsetHeight ?? 0;
    const rowCount = grid.getAttribute('aria-rowcount');

    // Grok-2: [0,3) 15721 · [3,5) 7489 · [5,6) 291 · [6,9) 15721 · [9,12) 12048 (boundaries 3 5 6 9); answer: 3 6.
    showAnswer(cutAt([3, 6]));
    await frames(3);
    const layer = grid.querySelector<HTMLElement>('[data-testid="extra-tier"]');
    expect(layer).not.toBeNull();
    expect(layer?.getAttribute('aria-hidden')).toBe('true');
    expect([...grid.querySelectorAll<HTMLElement>('[data-boundary]')].map((cut) => cut.dataset['boundary'])).toEqual([
      '5',
      '9',
    ]);
    expect([...grid.querySelectorAll<HTMLElement>('.lv-cell[data-first]')].map((c) => c.dataset['liveId'])).toEqual([
      '100',
      '101',
      '102',
    ]);
    // One extra 32 px track per packed row; the ARIA grid is unchanged (the layer is decorative).
    expect(grid.querySelector<HTMLElement>('.bd-row')?.offsetHeight).toBe(rowHeight + 32);
    expect(grid.getAttribute('aria-rowcount')).toBe(rowCount);
    expect(await axeViolations(board.target)).toEqual([]);

    // Each cut sits on the left edge of its byte's column: boundary 5 = the column of byte 5 in the byte tier.
    const cut = grid.querySelector<HTMLElement>('[data-boundary="5"]')?.getBoundingClientRect();
    const byte5 = grid.querySelector<HTMLElement>('[data-tier="hex"][data-index="5"]')?.getBoundingClientRect();
    expect(Math.abs((cut?.left ?? 0) - (byte5?.left ?? 99))).toBeLessThan(1);
  });

  it('draws no cut when the answer matches Grok-2, nothing at stops 1–5, and nothing for an unaligned answer', async () => {
    const app = appWith(fixtureResult('xai-grok2', 'zh-tw-tainan'));
    board = await mountBoard(app, 600);
    const grid = board.grid;
    showAnswer(cutAt([3, 5, 6, 9]));
    await frames(2);
    expect(grid.querySelectorAll('.lv-cell[data-first]')).toHaveLength(5);
    expect(grid.querySelectorAll('[data-boundary]')).toHaveLength(0);

    app.setStage(5);
    await frames(2);
    expect(grid.querySelector('[data-testid="extra-tier"]')).toBeNull();
    app.setStage(6);
    await frames(2);
    expect(grid.querySelector('[data-testid="extra-tier"]')).not.toBeNull();

    const misaligned: LiveToken[] = [{ id: 1, text: '台灣台南', bytes: null }];
    showAnswer(misaligned);
    await frames(2);
    expect(grid.querySelector('[data-testid="extra-tier"]')).toBeNull();
    expect(grid.querySelectorAll('[data-boundary], .lv-cell')).toHaveLength(0);
  });

  it('puts every fragment’s id inside its chip by the board’s rule (PA-17)', async () => {
    await page.viewport(1440, 900);
    const app = appWith(fixtureResult('xai-grok2', 'zh-tw-tainan'));
    board = await mountBoard(app, 600);
    const grid = board.grid;
    /** Each live chip's id: its text, whether it is on two lines, and its glyph run inside the chip's padding box. */
    const ids = (): Array<[string | undefined, string | undefined, boolean, boolean]> =>
      [...grid.querySelectorAll<HTMLElement>('.lv-cell')].map((cell) => {
        const chip = cell.querySelector('.bd-chip') ?? cell;
        const id = chip.querySelector('.bd-id');
        const range = document.createRange();
        range.selectNodeContents(id ?? chip);
        const run = range.getBoundingClientRect();
        const box = chip.getBoundingClientRect();
        const border = Number.parseFloat(getComputedStyle(chip).borderLeftWidth);
        const inside = run.left >= box.left + border - 0.02 && run.right <= box.right - border + 0.02;
        return [cell.dataset['liveId'], id?.textContent, id?.classList.contains('two') ?? false, inside];
      });

    // K = 8: rows 台灣 | 台南. Grok-2's boundaries with longer ids: 灣's last byte is a 1-column chip.
    showAnswer(withIds(cutAt([3, 5, 6, 9]), [15721, 7489, 236778, 15721, 12048]));
    await frames(2);
    expect(grid.querySelector('.lv-id')).toBeNull();
    expect(ids()).toEqual([
      ['15721', '15721', false, true],
      ['7489', '7489', false, true],
      ['236778', '236778', true, true],
      ['15721', '15721', false, true],
      ['12048', '12048', false, true],
    ]);
    expect(grid.querySelector('.lv-cell[data-live-id="236778"] > .bd-chip.stacked')).not.toBeNull();

    // A token across the row end shows its id on both fragments, continuation included.
    showAnswer(withIds(cutAt([3, 9]), [15721, 654321, 12048]));
    await frames(2);
    expect(ids()).toEqual([
      ['15721', '15721', false, true],
      ['654321', '654321', false, true],
      ['654321', '654321', false, true],
      ['12048', '12048', false, true],
    ]);
  });

  for (const [width, size] of [
    [2560, 'M'],
    [2560, 'L'],
    [3840, 'M'],
    [3840, 'L'],
  ] as const) {
    it(`keeps every live id's lines inside its chip at ${String(width)} px, cell ${size}: the token cells' height`, async () => {
      await page.viewport(width, 1440);
      const app = appWith(fixtureResult('xai-grok2', 'zh-tw-tainan'));
      document.documentElement.dataset['cellSize'] = size;
      board = await mountBoard(app, 600);
      showAnswer(withIds(cutAt([3, 5, 6, 9]), [15721, 7489, 236778, 15721, 12048]));
      await digitsLoaded();
      const grid = board.grid;
      const cell = cellPx();
      const token = grid.querySelector('.bd-cell-token')?.getBoundingClientRect().height ?? 0;
      expect(token).toBeCloseTo(cell * 0.75 + 5, 1);
      const live = [...grid.querySelectorAll<HTMLElement>('.lv-cell')];
      expect(live).toHaveLength(5);
      for (const lv of live) {
        expect(lv.getBoundingClientRect().height, lv.dataset['liveId']).toBeCloseTo(token, 1);
        const chip = lv.querySelector('.bd-chip') ?? lv;
        const id = chip.querySelector('.bd-id') ?? chip;
        for (const line of id.classList.contains('two') ? [...id.children] : [id])
          expectWithin(lineRun(line), paddingBox(chip), `${lv.dataset['liveId'] ?? ''} ${line.textContent}`);
      }
      expect(grid.querySelector('.lv-cell[data-live-id="236778"] .bd-id.two')).not.toBeNull();
      // The row grows by the extra track (token cells + 9 px), and the board's probe measures the same row height.
      const row = grid.querySelector('.bd-row')?.getBoundingClientRect().height ?? 0;
      expect(row).toBeCloseTo(cell * 3.5 + 56 + cell * 0.75 + 9, 0);
      expect(board.target.querySelector('.probe')?.getBoundingClientRect().height).toBeCloseTo(row, 1);
    });
  }

  for (const width of [600, 1440]) {
    it(`sits the live tier right under the Grok-2 chips, before the row's gap, at ${String(width)} px`, async () => {
      await page.viewport(width, 900);
      const app = appWith(fixtureResult('xai-grok2', 'zh-tw-tainan'));
      // K = 8: rows 台灣 | 台南.
      board = await mountBoard(app, width >= 1024 ? 2 * 16 + 320 + 8 * 32 : 2 * 16 + 8 * 36);
      showAnswer(cutAt([3, 6]));
      await frames(2);
      const grid = board.grid;
      expect(grid.getAttribute('aria-colcount')).toBe('8');
      const row = grid.querySelector('[data-row="0"]')?.getBoundingClientRect();
      const tokens = [...grid.querySelectorAll('[data-row="0"] .bd-cell-token')].map((c) => c.getBoundingClientRect());
      const tokenBottom = Math.max(...tokens.map((rect) => rect.bottom));
      const live = [...grid.querySelectorAll('[data-row="0"] .lv-cell > .bd-chip')].map((c) =>
        c.getBoundingClientRect(),
      );
      expect(live.length).toBeGreaterThan(0);
      for (const chip of live) {
        expect(chip.top - tokenBottom).toBeGreaterThanOrEqual(0);
        expect(chip.top - tokenBottom).toBeLessThanOrEqual(4);
        // The 12 px gap track follows the live tier, so the next row's characters stay clear of it.
        expect(chip.bottom + 12).toBeLessThanOrEqual((row?.bottom ?? 0) + 0.02);
      }
      const next = grid.querySelector('[data-row="1"] .bd-cell-char')?.getBoundingClientRect();
      expect((next?.top ?? 0) - Math.max(...live.map((rect) => rect.bottom))).toBeGreaterThanOrEqual(12);
      expect(board.target.querySelector('.probe')?.getBoundingClientRect().height).toBe(row?.height);
    });
  }

  it('paints a live id above a cut inside its chip; the cut shows above and below the id', async () => {
    await page.viewport(1440, 900);
    const app = appWith(fixtureResult('xai-grok2', 'zh-tw-tainan'));
    board = await mountBoard(app, 600);
    // Grok-2's boundaries 3 5 6 9; the answer's 3 4 6 9: its 2-column token [4, 6) holds Grok-2's boundary 5.
    showAnswer(withIds(cutAt([3, 4, 6, 9]), [15721, 291, 9865, 15721, 12048]));
    await digitsLoaded();
    const grid = board.grid;
    const chip = grid.querySelector('.lv-cell[data-live-id="9865"]');
    const cut = grid.querySelector<HTMLElement>('[data-boundary="5"]');
    const id = chip?.querySelector('.bd-id');
    const vis = chip?.querySelector('.bd-chip')?.getBoundingClientRect();
    if (chip === null || cut === null || id === null || id === undefined || vis === undefined)
      throw new Error('no cut inside a live chip');
    expect(chip.className).toMatch(/\bs2\b/);
    // The cut takes no pointer events (decorative): let it be hit-tested so elementFromPoint sees what paints on top.
    cut.style.pointerEvents = 'auto';
    // The strip is drawn on the left edge of the cut's column, which runs through the id.
    const edge = cut.getBoundingClientRect().left;
    const box = id.getBoundingClientRect();
    expect(edge).toBeGreaterThan(box.left);
    expect(edge).toBeLessThan(box.right);
    const centre = document.elementFromPoint((box.left + box.right) / 2, (box.top + box.bottom) / 2);
    expect(centre === id || id.contains(centre)).toBe(true);
    const x = edge + 1;
    expect(document.elementFromPoint(x, (vis.top + box.top) / 2)).toBe(cut);
    expect(document.elementFromPoint(x, (vis.bottom + box.bottom) / 2)).toBe(cut);
  });

  it('disappears when the text changes or the answers are cleared', async () => {
    const app = appWith(fixtureResult('xai-grok2', 'zh-tw-tainan'));
    board = await mountBoard(app, 600);
    showAnswer(cutAt([3, 6]));
    await frames(2);
    expect(board.grid.querySelector('[data-testid="extra-tier"]')).not.toBeNull();
    answers.clear();
    await frames(2);
    expect(board.grid.querySelector('[data-testid="extra-tier"]')).toBeNull();
  });
});

describe('drawer key lifecycle', () => {
  function mountDrawer(): { target: HTMLElement; destroy: () => void } {
    const app = appWith(fixtureResult('xai-grok2', 'zh-tw-tainan'));
    const target = document.createElement('div');
    document.body.append(target);
    const component = mount(DrawerHarness, { target, props: { app } });
    flushSync();
    return {
      target,
      destroy() {
        void unmount(component);
        target.remove();
      },
    };
  }

  async function open(target: HTMLElement): Promise<void> {
    target.querySelector<HTMLButtonElement>('[data-testid="live-check-toggle"]')?.click();
    for (let i = 0; i < 200 && target.querySelector('[data-testid="byok-warning"]') === null; i++) await frames(1);
  }

  function typeKey(target: HTMLElement, provider: 'anthropic' | 'xai', value: string): HTMLInputElement {
    const input = target.querySelector<HTMLInputElement>(`[data-testid="${provider}-key"]`);
    if (input === null) throw new Error('no key input');
    input.value = value;
    input.dispatchEvent(new Event('input', { bubbles: true }));
    flushSync();
    return input;
  }

  it('is closed by default, loads the body on open, and masks the key input', async () => {
    const { target, destroy } = mountDrawer();
    const toggle = target.querySelector<HTMLButtonElement>('[data-testid="live-check-toggle"]');
    expect(toggle?.getAttribute('aria-expanded')).toBe('false');
    expect(target.querySelector('#live-check-body')?.hasAttribute('hidden')).toBe(true);
    await open(target);
    expect(toggle?.getAttribute('aria-expanded')).toBe('true');
    const input = target.querySelector<HTMLInputElement>('[data-testid="anthropic-key"]');
    expect(input?.type).toBe('password');
    expect(input?.getAttribute('autocomplete')).toBe('off');
    expect(target.querySelector('form')).toBeNull();
    expect(await axeViolations(target)).toEqual([]);
    // With an answer on screen (token list, comparison sentence) the drawer stays axe clean.
    showAnswer(cutAt([3, 6]));
    await frames(2);
    expect(target.querySelector('[data-testid="live-token-list"]')).not.toBeNull();
    expect(await axeViolations(target)).toEqual([]);
    destroy();
  });

  it('sends exactly the byok.json headers with credentials omitted, and keeps the key out of storage', async () => {
    const fetchSpy = vi
      .spyOn(globalThis, 'fetch')
      .mockResolvedValue(new Response(JSON.stringify({ input_tokens: 25 }), { status: 200 }));
    const { target, destroy } = mountDrawer();
    await open(target);
    typeKey(target, 'anthropic', 'sk-ant-browser-test');
    target.querySelector<HTMLButtonElement>('[data-testid="anthropic-run"]')?.click();
    for (let i = 0; i < 100 && !target.textContent.includes('API total'); i++) await frames(1);
    expect(fetchSpy).toHaveBeenCalledTimes(1);
    const [url, init] = fetchSpy.mock.calls[0] ?? [];
    expect(url).toBe('https://api.anthropic.com/v1/messages/count_tokens');
    expect(init?.credentials).toBe('omit');
    expect(init?.headers).toEqual({
      'content-type': 'application/json',
      authorization: 'Bearer sk-ant-browser-test',
      'anthropic-version': '2026-10-21',
      'anthropic-dangerous-direct-browser-access': 'true',
    });
    expect(target.querySelector('[data-testid="anthropic-result"]')?.textContent).toContain(
      'API total 25 (includes ≈ 8 frame tokens → ≈ 17 content tokens)',
    );
    const stored = [
      ...Object.keys(localStorage).map((k) => localStorage.getItem(k) ?? ''),
      ...Object.keys(sessionStorage).map((k) => sessionStorage.getItem(k) ?? ''),
    ].join('\n');
    expect(stored).not.toContain('sk-ant-browser-test');
    expect(location.href).not.toContain('sk-ant-browser-test');
    destroy();
  });

  it('forgets the key on "Forget key", on collapse and on pagehide', async () => {
    const { target, destroy } = mountDrawer();
    await open(target);
    typeKey(target, 'anthropic', 'sk-ant-1');
    expect(keys.anthropic).toBe('sk-ant-1');
    target.querySelector<HTMLButtonElement>('[data-testid="anthropic-forget"]')?.click();
    flushSync();
    expect(keys.anthropic).toBe('');
    expect(target.querySelector<HTMLInputElement>('[data-testid="anthropic-key"]')?.value).toBe('');

    typeKey(target, 'xai', 'xai-2');
    target.querySelector<HTMLButtonElement>('[data-testid="live-check-toggle"]')?.click();
    flushSync();
    expect(keys.xai).toBe('');
    await open(target);
    expect(target.querySelector<HTMLInputElement>('[data-testid="xai-key"]')?.value).toBe('');

    typeKey(target, 'xai', 'xai-3');
    window.dispatchEvent(new PageTransitionEvent('pagehide', { persisted: true }));
    flushSync();
    expect(keys.xai).toBe('');
    expect(target.querySelector<HTMLInputElement>('[data-testid="xai-key"]')?.value).toBe('');
    destroy();
  });
});
