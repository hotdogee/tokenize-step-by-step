/**
 * BYOK in chromium (05 §13): the live token tier drawn through the board's extra-tier hook (row-aligned chips under the
 * Grok-2 token tier, hatched cuts exactly at the differing boundaries, one extra 32 px track per row, aria-hidden, never
 * for an unaligned answer, only at stop 6), and the drawer's key lifecycle (lazy body, masked input, exact request
 * headers through `fetch`, the key forgotten on "Forget key", on collapse and on `pagehide`, never in web storage).
 */
import '../theme/base.css';
import axe from 'axe-core';
import { flushSync, mount, unmount } from 'svelte';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { page } from 'vitest/browser';
import { appWith, fixtureResult, frames, mountBoard, type MountedBoard } from '../board/board.test-helper.ts';
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

function showAnswer(tokens: readonly LiveToken[]): void {
  answers.setXai(
    { text: TEXT, model: 'grok-4.7', tokens, alignment: alignLiveTokens(TEXT, tokens, GROK2) },
    { tokenizer: 'xai-grok2', row: LiveTierRow },
  );
  flushSync();
}

let board: MountedBoard | null = null;

afterEach(() => {
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
