/**
 * Board interaction in chromium (05 §5, §6, §8, §9): the APG keyboard state machine on a 3-row fixture (o200k `ja-text`
 * at 360 px, K from the formula) with one roving tab stop, ↑/↓ edge no-ops, Enter/Space pin, `i` into the inspector and
 * Esc back, Esc unpins then returns to the textarea, `c` copies; focus persistence by byte offset across
 * re-tokenization and across a long input's window moves (absolute anchors); a tab stop on a lone BOS marker; the inspector region on its three surfaces (the anchored panel below
 * the row, flipped above it near the viewport bottom); hover after 120 ms; keyboard input taking the inspector back from
 * a resting pointer, and content scrolling under it no hover; click pins; textarea selection sync; focus scrolls follow the in-app Reduce motion switch.
 */
import '../theme/base.css';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { page, userEvent } from 'vitest/browser';
import { packRows } from '@tsbs/core/layout/pack-rows';
import { AppState } from '../app/app-state.svelte.ts';
import { hubOf } from '../app/fake-client.test-helper.ts';
import { motionPrefs } from '../motion/motion-prefs.svelte.ts';
import {
  appWith,
  expectedColumns,
  fixtureResult,
  frames,
  idleClient,
  mountBoard,
  syntheticResult,
  type MountedBoard,
} from './board.test-helper.ts';

let mounted: MountedBoard | null = null;

afterEach(() => {
  mounted?.destroy();
  mounted = null;
  document.documentElement.style.removeProperty('--sheet-height');
});

async function show(...args: Parameters<typeof appWith>): Promise<MountedBoard> {
  mounted = await mountBoard(appWith(...args));
  return mounted;
}

/** The focused element as `tier:index`. */
function focused(): string {
  const active = document.activeElement as HTMLElement | null;
  return `${active?.dataset['tier'] ?? active?.id ?? active?.tagName ?? 'none'}:${active?.dataset['index'] ?? ''}`;
}

function tabStops(board: MountedBoard): number {
  return board.grid.querySelectorAll('[tabindex="0"]').length;
}

async function press(keys: string): Promise<void> {
  await userEvent.keyboard(keys);
  await frames(2);
}

describe('keyboard state machine on a 3-row fixture (05 §8)', () => {
  it('moves by unit, changes tier by byte anchor, and keeps one tab stop', async () => {
    await page.viewport(360, 780);
    const result = fixtureResult('openai-o200k_base', 'ja-text');
    const board = await show(result);
    const K = expectedColumns(360);
    expect(board.grid.getAttribute('aria-colcount')).toBe(String(K));
    expect(packRows(result, K)).toHaveLength(3); // the tour below walks a 3-row layout
    expect(board.grid.querySelectorAll('.bd-row')).toHaveLength(3);
    board.grid.querySelector<HTMLElement>('[tabindex="0"]')?.focus();
    expect(focused()).toBe('char:0');
    await press('{ArrowRight}');
    expect(focused()).toBe('char:1');
    await press('{ArrowUp}');
    expect(focused()).toBe('char:1'); // top tier: no-op
    await press('{ArrowDown}');
    expect(focused()).toBe('hex:3');
    await press('{ArrowDown}');
    expect(focused()).toBe('token:0');
    await press('{ArrowDown}');
    expect(focused()).toBe('token:0'); // bottom tier: no-op
    await press('{End}');
    expect(focused()).toBe('token:1');
    await press('{ArrowRight}');
    expect(focused()).toBe('token:2'); // wraps to row 2
    await press('{PageDown}');
    expect(focused()).toBe('token:5');
    await press('{Control>}{Home}{/Control}');
    expect(focused()).toBe('token:0');
    await press('{Control>}{End}{/Control}');
    expect(focused()).toBe('token:5');
    await press('{Home}');
    expect(focused()).toBe('token:5');
    await press('{PageUp}');
    expect(focused()).toBe('token:2');
    expect(tabStops(board)).toBe(1);
    expect(document.activeElement?.getAttribute('tabindex')).toBe('0');
  });

  it('Enter pins and announces, i enters the inspector, Esc returns, Esc unpins, Esc returns to the textarea', async () => {
    await page.viewport(1440, 900);
    const board = await show(fixtureResult('openai-cl100k_base', 'zh-tw-tainan'));
    board.grid.querySelector<HTMLElement>('[tabindex="0"]')?.focus();
    await press('{ArrowDown}{ArrowDown}{ArrowRight}');
    expect(focused()).toBe('token:1');
    await press('{Enter}');
    expect(board.app.status).toContain('pinned: token 2 of 5, id 66285, partial');
    expect(board.grid.querySelector('[data-tier="token"][data-index="1"]')?.hasAttribute('data-pinned')).toBe(true);
    expect(board.app.pinned).toEqual({ byte: 3, tier: 'token' });
    await press('{ArrowRight}');
    expect(focused()).toBe('token:2'); // focus stays in the grid while pinned
    expect(document.getElementById('inspector-heading')?.textContent).toBe('Inspector — token 2 of 5');
    await press('i');
    expect(document.getElementById('inspector-panel')?.contains(document.activeElement)).toBe(true);
    expect(board.app.inspectorFocus).toBe('panel');
    await press('{Escape}');
    expect(focused()).toBe('token:2');
    await press('{Escape}');
    expect(board.app.pinned).toBeNull();
    expect(board.app.status).toContain('unpinned');
    await press('{Escape}');
    expect(focused()).toBe('text-input:');
  });

  it('Space toggles the pin; c copies the focused value and says so', async () => {
    await page.viewport(1440, 900);
    const board = await show(fixtureResult('openai-cl100k_base', 'zh-tw-tainan'));
    board.grid.querySelector<HTMLElement>('[tabindex="0"]')?.focus();
    await press('{ArrowDown}');
    await press(' ');
    expect(board.app.pinned).toEqual({ byte: 0, tier: 'byte' });
    await press(' ');
    expect(board.app.pinned).toBeNull();
    await press('c');
    expect(board.app.status).toContain('copied: E5');
  });

  it('keeps focus on the same byte offset after re-tokenization (cl100k → o200k)', async () => {
    await page.viewport(1440, 900);
    const board = await show(fixtureResult('openai-cl100k_base', 'zh-tw-tainan'));
    board.grid.querySelector<HTMLElement>('[tabindex="0"]')?.focus();
    await press('{ArrowDown}{ArrowDown}{ArrowRight}{ArrowRight}');
    expect(focused()).toBe('token:2'); // 96 = A3 at byte 5
    board.app.tokenizer = 'openai-o200k_base';
    board.app.result = fixtureResult('openai-o200k_base', 'zh-tw-tainan');
    await frames(3);
    expect(focused()).toBe('token:1'); // 133072 = 灣 covers byte 5
    expect(tabStops(board)).toBe(1);
  });

  it('keeps one tab stop on empty text whose only cell is a trailing BOS marker (Llama 3 + addBos)', async () => {
    await page.viewport(1440, 900);
    const board = await show(fixtureResult('meta-llama3', 'empty', { addBos: true }));
    const stop = board.grid.querySelector<HTMLElement>('[tabindex="0"]');
    expect(tabStops(board)).toBe(1);
    expect(stop?.dataset['variant']).toBe('marker');
    stop?.focus();
    await press('{ArrowUp}');
    expect(focused()).toBe('token:0'); // the char and byte tiers are empty
  });

  it('keeps focus and pin on the same absolute byte when a long input’s window moves (AD-17, AD-27)', async () => {
    await page.viewport(1440, 900);
    // 25,000 CJK code points (3 bytes each, 5,000 distinct): the on-demand tier; one token per code point, id = it.
    const text = Array.from({ length: 25_000 }, (_, i) => String.fromCodePoint(0x4e00 + (i % 5000))).join('');
    const result = syntheticResult(text);
    const app = new AppState(hubOf(idleClient()));
    app.setText(text);
    app.options = result.options;
    app.result = result; // the whole-text run, current for the text
    app.setCaret(10_000); // byte 30,000
    await app.slicerReady();
    const board = await mountBoard(app);
    mounted = board;
    const windowStart = (): number => Number((board.grid.dataset['window'] ?? '').split('-')[0]);
    const start = windowStart();
    expect(start).toBeGreaterThan(0);
    board.grid.querySelector<HTMLElement>('[data-tier="token"][data-index="5"][data-first]')?.focus();
    await press('{Enter}'); // pin it
    const byte = start + 15;
    expect(app.focus).toEqual({ tier: 'token', byte });
    expect(app.pinned).toEqual({ byte, tier: 'token' });
    const id = `id ${String(0x4e00 + ((byte / 3) % 5000))}`;

    // The caret moves one window step back: the same token, at another index of the moved window.
    app.setCaret(9_833); // byte 29,499
    await frames(3);
    const moved = windowStart();
    expect(moved).toBeLessThan(start);
    const index = String((byte - moved) / 3);
    expect(app.focus).toEqual({ tier: 'token', byte });
    expect(app.pinned).toEqual({ byte, tier: 'token' });
    const stop = board.grid.querySelector<HTMLElement>('[tabindex="0"]');
    expect(stop?.dataset['index']).toBe(index);
    expect(stop?.getAttribute('aria-label')).toContain(id);
    expect(board.grid.querySelector<HTMLElement>('[data-pinned]')?.dataset['index']).toBe(index);

    // Far away the window does not hold the pinned byte: nothing shows as pinned, and the anchors stay for the way back.
    app.setCaret(20_000);
    await frames(3);
    expect(board.grid.querySelector('[data-pinned]')).toBeNull();
    expect(app.focus).toEqual({ tier: 'token', byte });
    expect(app.pinned).toEqual({ byte, tier: 'token' });
    app.setCaret(9_833);
    await frames(3);
    expect(board.grid.querySelector<HTMLElement>('[data-pinned]')?.dataset['index']).toBe(index);
  });

  it('scrolls focus moves with behavior "auto" when the in-app switch reduces motion (05 §7)', async () => {
    await page.viewport(1440, 900);
    const scrolls: Array<ScrollIntoViewOptions | boolean | undefined> = [];
    vi.spyOn(Element.prototype, 'scrollIntoView').mockImplementation((options) => {
      scrolls.push(options);
    });
    try {
      expect(motionPrefs.system).toBe(false); // the OS setting is no-preference: only the switch reduces motion
      motionPrefs.setReduced(false); // the switch starts off, whatever another test file left in storage
      const board = await show(fixtureResult('openai-o200k_base', 'ja-text'));
      board.grid.querySelector<HTMLElement>('[tabindex="0"]')?.focus();
      await press('{ArrowRight}');
      expect(scrolls.at(-1)).toMatchObject({ behavior: 'smooth' });
      motionPrefs.setReduced(true);
      await press('{ArrowRight}');
      expect(focused()).toBe('char:2');
      expect(scrolls.at(-1)).toMatchObject({ behavior: 'auto', block: 'nearest' });
    } finally {
      motionPrefs.setReduced(false);
      vi.restoreAllMocks();
    }
  });
});

describe('inspector region (05 §5, AD-34)', () => {
  it('is one non-modal region on the side rail at ≥ 1024 px and follows focus immediately', async () => {
    await page.viewport(1440, 900);
    const board = await show(fixtureResult('openai-cl100k_base', 'zh-tw-tainan'));
    const host = board.target.querySelector<HTMLElement>('[data-testid="inspector-host"]');
    const panel = document.getElementById('inspector-panel');
    expect(host?.dataset['surface']).toBe('rail');
    expect(panel?.getAttribute('role')).toBe('region');
    expect(panel?.getAttribute('aria-labelledby')).toBe('inspector-heading');
    expect(board.target.querySelector('[inert]')).toBeNull();
    board.grid.querySelector<HTMLElement>('[tabindex="0"]')?.focus();
    await press('{ArrowRight}');
    expect(document.getElementById('inspector-heading')?.textContent).toBe('Inspector — character 2 of 4');
  });

  it('follows hover after 120 ms on fine pointers and pins on click', async () => {
    await page.viewport(1440, 900);
    const board = await show(fixtureResult('openai-cl100k_base', 'zh-tw-tainan'));
    const target = board.grid.querySelector<HTMLElement>('[data-tier="token"][data-index="2"]');
    if (target === null) throw new Error('no token cell');
    await userEvent.hover(target);
    await new Promise((resolve) => setTimeout(resolve, 200));
    await frames(1);
    expect(document.getElementById('inspector-heading')?.textContent).toBe('Inspector — token 3 of 5');
    await userEvent.click(target);
    await frames(1);
    expect(board.app.pinned).toEqual({ byte: 5, tier: 'token' });
    await userEvent.click(target);
    await frames(1);
    expect(board.app.pinned).toBeNull();
  });

  it('a keyboard focus move takes the inspector and the slice back from a resting pointer (05 §5)', async () => {
    await page.viewport(1440, 900);
    const board = await show(fixtureResult('openai-cl100k_base', 'zh-tw-tainan'));
    const hovered = board.grid.querySelector<HTMLElement>('[data-tier="token"][data-index="0"]');
    if (hovered === null) throw new Error('no token cell');
    await userEvent.hover(hovered);
    await new Promise((resolve) => setTimeout(resolve, 200));
    await frames(1);
    expect(document.getElementById('inspector-heading')?.textContent).toBe('Inspector — token 1 of 5');
    board.grid.querySelector<HTMLElement>('[tabindex="0"]')?.focus();
    await press('{ArrowRight}{ArrowRight}');
    expect(focused()).toBe('char:2');
    expect(document.getElementById('inspector-heading')?.textContent).toBe('Inspector — character 3 of 4');
    const slice = [...board.grid.querySelectorAll<HTMLElement>('[data-slice]')].map(
      (cell) => `${cell.dataset['tier'] ?? ''}:${cell.dataset['index'] ?? ''}`,
    );
    expect(slice).toEqual(['char:2', 'hex:6', 'hex:7', 'hex:8', 'token:3']);
    await new Promise((resolve) => setTimeout(resolve, 200)); // the pointer has not moved: no hover comes back
    await frames(1);
    expect(document.getElementById('inspector-heading')?.textContent).toBe('Inspector — character 3 of 4');
  });

  it('content scrolling under a resting pointer is no hover; a move onto a cell is (05 §5)', async () => {
    await page.viewport(1440, 900);
    const board = await show(fixtureResult('openai-cl100k_base', 'zh-tw-tainan'));
    let at = { x: 0, y: 0 };
    const record = (event: PointerEvent): void => {
      at = { x: event.clientX, y: event.clientY };
    };
    document.addEventListener('pointermove', record);
    const textarea = document.getElementById('text-input');
    const token = board.grid.querySelector<HTMLElement>('[data-tier="token"][data-index="2"]');
    if (textarea === null || token === null) throw new Error('no textarea or token cell');
    await userEvent.hover(textarea); // the mouse rests over the textarea
    document.removeEventListener('pointermove', record);
    board.grid.querySelector<HTMLElement>('[tabindex="0"]')?.focus();
    await press('{ArrowRight}');
    expect(document.getElementById('inspector-heading')?.textContent).toBe('Inspector — character 2 of 4');
    // What a browser sends when the page scrolls a cell under the resting pointer: a pointerover at its position.
    const over = (clientX: number): boolean =>
      token.dispatchEvent(
        new PointerEvent('pointerover', { bubbles: true, pointerType: 'mouse', clientX, clientY: at.y }),
      );
    over(at.x);
    await new Promise((resolve) => setTimeout(resolve, 200));
    await frames(1);
    expect(document.getElementById('inspector-heading')?.textContent).toBe('Inspector — character 2 of 4');
    over(at.x + 1); // the pointer moved: a hover
    await new Promise((resolve) => setTimeout(resolve, 200));
    await frames(1);
    expect(document.getElementById('inspector-heading')?.textContent).toBe('Inspector — token 3 of 5');
  });

  it('is an anchored panel beside the active cell at 768–1023 px', async () => {
    await page.viewport(900, 900);
    const board = await show(fixtureResult('openai-cl100k_base', 'zh-tw-tainan'));
    const host = board.target.querySelector<HTMLElement>('[data-testid="inspector-host"]');
    expect(host?.dataset['surface']).toBe('anchored');
    expect(host?.hidden).toBe(true);
    const cell = board.grid.querySelector<HTMLElement>('[tabindex="0"]');
    cell?.focus();
    await frames(3);
    expect(host?.hidden).toBe(false);
    const cellRect = cell?.getBoundingClientRect();
    const hostRect = host?.getBoundingClientRect();
    expect(hostRect?.top ?? 0).toBeGreaterThanOrEqual(cellRect?.bottom ?? 0);
  });

  it('flips the anchored panel above the row when it does not fit below', async () => {
    await page.viewport(900, 1000);
    const text = Array.from({ length: 400 }, (_, i) => String.fromCodePoint(0x4e00 + i)).join('');
    const board = await show(syntheticResult(text));
    const host = board.target.querySelector<HTMLElement>('[data-testid="inspector-host"]');
    board.grid.querySelector<HTMLElement>('[tabindex="0"]')?.focus();
    await frames(3);
    const panelHeight = host?.getBoundingClientRect().height ?? 0;
    expect(panelHeight).toBeGreaterThan(0);
    expect(panelHeight).toBeLessThan(innerHeight - 160); // 60vh at most: room above a row at the bottom
    // Scroll packed row 8 to the bottom edge of the viewport: no room below it, room above.
    const rowPx = board.grid.querySelector('.bd-row')?.getBoundingClientRect().height ?? 0;
    const gridTop = board.grid.getBoundingClientRect().top + scrollY;
    window.scrollTo(0, gridTop + 9 * rowPx - (innerHeight - 2));
    await frames(3);
    const row = board.grid.querySelector<HTMLElement>('[data-row="8"]');
    row?.querySelector<HTMLElement>('[data-tier="char"]')?.focus({ preventScroll: true });
    await frames(3);
    const rowRect = row?.getBoundingClientRect();
    const hostRect = host?.getBoundingClientRect();
    expect(rowRect?.bottom ?? 0).toBeGreaterThan(innerHeight - 10);
    expect(hostRect?.bottom ?? Number.POSITIVE_INFINITY).toBeLessThanOrEqual((rowRect?.top ?? 0) + 0.5);
    expect(hostRect?.top ?? -1).toBeGreaterThanOrEqual(0);
    window.scrollTo(0, 0);
  });

  it('is a bottom sheet with an aria-expanded handle below 768 px and pads the scroll container', async () => {
    await page.viewport(360, 780);
    const board = await show(fixtureResult('openai-cl100k_base', 'zh-tw-tainan'));
    const host = board.target.querySelector<HTMLElement>('[data-testid="inspector-host"]');
    expect(host?.dataset['surface']).toBe('sheet');
    const handle = board.target.querySelector<HTMLButtonElement>('[data-testid="sheet-handle"]');
    expect(handle?.getAttribute('aria-expanded')).toBe('false');
    expect(handle?.getAttribute('aria-controls')).toBe('inspector-panel');
    expect(document.documentElement.style.getPropertyValue('--sheet-height')).toBe('56px');
    // The sheet height plus the 8 px gap that keeps a focused cell's ring clear of the sheet.
    expect(getComputedStyle(document.documentElement).scrollPaddingBottom).toBe('64px');
    expect(host?.getBoundingClientRect().height).toBe(56);
    handle?.click();
    await frames(2);
    expect(handle?.getAttribute('aria-expanded')).toBe('true');
    expect(document.documentElement.style.getPropertyValue('--sheet-height')).toBe('40vh');
    expect(Math.round(host?.getBoundingClientRect().height ?? 0)).toBe(Math.round(780 * 0.4));
    expect(handle?.getBoundingClientRect().height).toBeGreaterThanOrEqual(44);
  });
});

describe('selection sync (05 §6)', () => {
  it('marks the cells covered by the textarea selection', async () => {
    await page.viewport(1440, 900);
    const board = await show(fixtureResult('openai-cl100k_base', 'zh-tw-tainan'));
    const textarea = document.getElementById('text-input') as HTMLTextAreaElement;
    textarea.focus();
    textarea.setSelectionRange(1, 2);
    document.dispatchEvent(new Event('selectionchange'));
    await frames(2);
    const selected = [...board.grid.querySelectorAll<HTMLElement>('[data-selected]')].map(
      (cell) => `${cell.dataset['tier'] ?? ''}:${cell.dataset['index'] ?? ''}`,
    );
    expect(selected).toEqual(['char:1', 'hex:3', 'hex:4', 'hex:5', 'token:1', 'token:2']);
  });
});

describe('inspected slice on a partial token (05 §4.1, AD-35)', () => {
  /** The partial chip's cut edge and its slice bar, as computed styles. */
  function hatchAndBar(board: MountedBoard): {
    hatch: CSSStyleDeclaration;
    bar: CSSStyleDeclaration;
    chip: HTMLElement;
  } {
    const cell = board.grid.querySelector<HTMLElement>('[data-tier="token"][data-index="1"]');
    if (cell === null) throw new Error('no token cell');
    const vis = cell.querySelector<HTMLElement>('.bd-chip.hatch-end');
    if (vis === null) throw new Error('no partial chip');
    expect(cell.hasAttribute('data-slice')).toBe(true);
    return {
      hatch: getComputedStyle(vis, '::after'),
      bar: getComputedStyle(cell, '::after'),
      chip: vis,
    };
  }

  function expectHatchedEdgeAndFullBar(board: MountedBoard): void {
    const { hatch, bar, chip } = hatchAndBar(board);
    // The two-tone hatch stays on the right (cut) edge, over the chip's full inner height …
    expect(hatch.backgroundImage).toContain('repeating-linear-gradient');
    expect(hatch.right).toBe('0px');
    expect(hatch.width).toBe('4px');
    expect(Number.parseFloat(hatch.height)).toBe(chip.clientHeight);
    // … and the slice bar runs along the bottom of the chip instead of replacing it.
    expect(bar.content).not.toBe('none');
    expect(bar.height).toBe('2px');
    expect(bar.bottom).toBe('1px');
    expect(Number.parseFloat(bar.width)).toBeGreaterThan(chip.getBoundingClientRect().width - 8);
  }

  it('keeps the hatched cut edge of cl100k 66285 while 灣 is focused and while the token is pinned', async () => {
    await page.viewport(1440, 900);
    const board = await show(fixtureResult('openai-cl100k_base', 'zh-tw-tainan'));
    board.grid.querySelector<HTMLElement>('[tabindex="0"]')?.focus();
    await press('{ArrowRight}');
    expect(focused()).toBe('char:1');
    expectHatchedEdgeAndFullBar(board);
    await press('{ArrowDown}{ArrowDown}');
    expect(focused()).toBe('token:1');
    await press('{Enter}');
    expect(board.app.pinned).toEqual({ byte: 3, tier: 'token' });
    expectHatchedEdgeAndFullBar(board);
  });
});
