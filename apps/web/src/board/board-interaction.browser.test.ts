/**
 * Board interaction in chromium (05 §5, §6, §8, §9): the APG keyboard state machine on a 3-row fixture (o200k `ja-text`
 * at 360 px, K = 9) with one roving tab stop, ↑/↓ edge no-ops, Enter/Space pin, `i` into the inspector and Esc back,
 * Esc unpins then returns to the textarea, `c` copies; focus persistence by byte offset across re-tokenization; the
 * inspector region on its three surfaces; hover after 120 ms; click pins; textarea selection sync.
 */
import '../theme/base.css';
import { afterEach, describe, expect, it } from 'vitest';
import { page, userEvent } from 'vitest/browser';
import { appWith, fixtureResult, frames, mountBoard, type MountedBoard } from './board.test-helper.ts';

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
    const board = await show(fixtureResult('openai-o200k_base', 'ja-text'));
    expect(board.grid.getAttribute('aria-colcount')).toBe('9');
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

  it('is a bottom sheet with an aria-expanded handle below 768 px and pads the scroll container', async () => {
    await page.viewport(360, 780);
    const board = await show(fixtureResult('openai-cl100k_base', 'zh-tw-tainan'));
    const host = board.target.querySelector<HTMLElement>('[data-testid="inspector-host"]');
    expect(host?.dataset['surface']).toBe('sheet');
    const handle = board.target.querySelector<HTMLButtonElement>('[data-testid="sheet-handle"]');
    expect(handle?.getAttribute('aria-expanded')).toBe('false');
    expect(handle?.getAttribute('aria-controls')).toBe('inspector-panel');
    expect(document.documentElement.style.getPropertyValue('--sheet-height')).toBe('56px');
    expect(getComputedStyle(document.documentElement).scrollPaddingBottom).toBe('56px');
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
