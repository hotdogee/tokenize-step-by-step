/**
 * The comparison table in chromium (PA-19, 05 §4): the default rows of 台灣台南 without a `style` attribute (first-paint
 * safe), the column window of the zh-TW paragraph (rebased placement, cells outside it absent), the three scrollers in
 * step with the captions pinned left, every id inside its chip (PA-17, with Linux's whole-pixel advances), the grid's
 * ARIA (counts, `aria-owns`, axe), the keyboard (↑/↓ by byte, End, Enter opens Advanced on the row's tokenizer, Esc),
 * the chip toggles, the Anthropic API row, the marker column of Grok-1's dummy prefix and a failed row's action.
 */
import '../theme/base.css';
import axe from 'axe-core';
import { flushSync, mount, unmount } from 'svelte';
import { afterEach, describe, expect, it, onTestFinished } from 'vitest';
import { page, userEvent } from 'vitest/browser';
import type { TokenizationResult, TokenizerId } from '@tsbs/core';
import { AppState } from '../app/app-state.svelte.ts';
import { FakeClients, flush, hubOf } from '../app/fake-client.test-helper.ts';
import { fixtureResult, frames, idleClient } from '../board/board.test-helper.ts';
import { EXAMPLES } from '../app/registry.ts';
import { preferences } from '../shell/preferences.svelte.ts';
import CompareHarness from './CompareHarness.test-helper.svelte';

const TOKENIZERS: readonly TokenizerId[] = [
  'openai-o200k_base',
  'openai-cl100k_base',
  'anthropic-claude-legacy',
  'google-gemma4',
  'google-gemma2',
  'meta-llama4-muse',
  'meta-llama3',
  'xai-grok2',
  'xai-grok1',
];

interface Mounted {
  readonly app: AppState;
  readonly section: HTMLElement;
  readonly target: HTMLElement;
}

let destroy: (() => void) | null = null;

afterEach(() => {
  destroy?.();
  destroy = null;
  try {
    localStorage.removeItem('tsbs:rows');
  } catch {
    // storage unavailable
  }
});

/** Mounts the table over every tokenizer's precomputed result of the example `caseName`. */
async function show(caseName: string): Promise<Mounted> {
  const seeds: TokenizationResult[] = TOKENIZERS.map((id) => fixtureResult(id, caseName));
  const text = EXAMPLES.find((chip) => chip.fixtureCase === caseName)?.text ?? '';
  return showApp(new AppState(hubOf(idleClient(), { seeds }), { text }));
}

/** Mounts the table over `app`. */
async function showApp(app: AppState): Promise<Mounted> {
  const target = document.createElement('div');
  document.body.append(target);
  const component = mount(CompareHarness, { target, props: { app } });
  flushSync();
  await frames(3);
  destroy = () => {
    void unmount(component);
    target.remove();
  };
  const section = target.querySelector<HTMLElement>('#compare');
  if (section === null) throw new Error('no table');
  return { app, section, target };
}

const chipsOf = (section: HTMLElement, lab: string): HTMLElement[] => [
  ...section.querySelectorAll<HTMLElement>(`[data-row="${lab}"] [role="gridcell"][data-index]`),
];

const scroller = (section: HTMLElement, name: 'thead' | 'tbody' | 'sbar'): HTMLElement => {
  const element = section.querySelector<HTMLElement>(`.cmp-${name}`);
  if (element === null) throw new Error(`no .cmp-${name}`);
  return element;
};

interface Box {
  readonly left: number;
  readonly right: number;
  readonly top: number;
  readonly bottom: number;
}

const px = (value: string): number => Number.parseFloat(value);

/** The chip's padding box: its border box less the border, which an id must not run into. */
function paddingBox(chip: Element): Box {
  const rect = chip.getBoundingClientRect();
  const style = getComputedStyle(chip);
  return {
    left: rect.left + px(style.borderLeftWidth),
    right: rect.right - px(style.borderRightWidth),
    top: rect.top + px(style.borderTopWidth),
    bottom: rect.bottom - px(style.borderBottomWidth),
  };
}

/** An element's glyph run: across, the extent of its text; down, its line box (as board-render.browser.test.ts). */
function glyphRun(element: Element): Box {
  const range = document.createRange();
  range.selectNodeContents(element);
  const text = range.getBoundingClientRect();
  const box = element.getBoundingClientRect();
  return { left: text.left, right: text.right, top: box.top, bottom: box.bottom };
}

/**
 * Chromium on Linux at device scale 1 rounds glyph advances to whole pixels: a run of n narrowed digits can measure up to
 * n × 0.5 px wider than the CSS fit, centred, so n × 0.25 px past each side (board-render.browser.test.ts, PA-17).
 */
function advanceSlack(digits: number): number {
  const probe = document.createElement('span');
  probe.style.font = "10px 'TSBS Digits'";
  probe.style.setProperty('font-stretch', '62.5%');
  probe.textContent = '0';
  document.body.append(probe);
  const range = document.createRange();
  range.selectNodeContents(probe);
  const width = range.getBoundingClientRect().width;
  probe.remove();
  return Number.isInteger(width) ? digits * 0.25 : 0;
}

function expectWithin(inner: Box, outer: Box, what: string, slack = 0): void {
  expect(inner.left, `${what} left`).toBeGreaterThanOrEqual(outer.left - 0.02 - slack);
  expect(inner.right, `${what} right`).toBeLessThanOrEqual(outer.right + 0.02 + slack);
  expect(inner.top, `${what} top`).toBeGreaterThanOrEqual(outer.top - 0.02);
  expect(inner.bottom, `${what} bottom`).toBeLessThanOrEqual(outer.bottom + 0.02);
}

describe('the default rows (台灣台南)', () => {
  it('renders the five rows with their counts and no style attribute in the render (the static first paint is CSP safe)', async () => {
    await page.viewport(1280, 900);
    const { section } = await show('zh-tw-tainan');
    // Only what the mounted table measures afterwards, through the CSSOM (the static paint has no style at all:
    // prerender.test.ts): the pinned boxes' heights for the focus scroll margins.
    expect([...section.style].sort()).toEqual(['--cmp-foot-h', '--cmp-head-h']);
    expect(section.querySelectorAll('[style]')).toHaveLength(0);
    expect(section.className).toContain('k12');
    expect(['openai', 'anthropic', 'google', 'meta', 'xai'].map((lab) => chipsOf(section, lab).length)).toEqual([
      4, 5, 3, 3, 5,
    ]);
    const anthropic = section.querySelector('[data-row="anthropic"] .cmp-cap')?.textContent ?? '';
    expect(anthropic).toContain('5 tokens');
    const partial = section.querySelector('[data-row="anthropic"] [data-testid="row-partial"]');
    expect(partial?.querySelector('[aria-hidden="true"]:nth-child(2)')?.textContent).toBe('2 partial');
    expect(partial?.querySelector('.visually-hidden')?.textContent).toBe('2 partial-character tokens');
    expect(section.querySelectorAll('[data-source="precomputed"]')).toHaveLength(5);
  });

  it('puts every id inside its chip at 360 and 1440 px (PA-17)', async () => {
    for (const width of [360, 1440]) {
      await page.viewport(width, 900);
      const { section } = await show('zh-tw-tainan');
      await document.fonts.load('12px "TSBS Digits"', '0123456789');
      await frames(2);
      const ids = [...section.querySelectorAll<HTMLElement>('.cmp-chip .bd-id')];
      expect(ids.length).toBeGreaterThan(15);
      for (const id of ids) {
        const chip = id.closest('.bd-chip');
        if (chip === null) throw new Error('id outside a chip');
        expectWithin(glyphRun(id), paddingBox(chip), `${String(width)} ${id.textContent}`, advanceSlack(7));
      }
      destroy?.();
      destroy = null;
    }
  });

  it('owns its header and chip rows through aria-owns, counts them, and is axe clean', async () => {
    await page.viewport(1280, 900);
    const { section, target } = await show('zh-tw-tainan');
    const grid = section.querySelector<HTMLElement>('[role="grid"]');
    expect(grid?.getAttribute('aria-rowcount')).toBe('7');
    expect(grid?.getAttribute('aria-colcount')).toBe('12');
    const owned = (grid?.getAttribute('aria-owns') ?? '').split(' ');
    expect(owned).toEqual([
      'cmp-r-char',
      'cmp-r-hex',
      'cmp-row-openai',
      'cmp-row-anthropic',
      'cmp-row-google',
      'cmp-row-meta',
      'cmp-row-xai',
    ]);
    for (const id of owned) expect(document.getElementById(id)?.getAttribute('role'), id).toBe('row');
    expect(grid?.children).toHaveLength(0); // the captions and their selects are no part of the grid
    expect(section.querySelectorAll('[tabindex="0"]')).toHaveLength(1);
    const results = await axe.run(target, {
      runOnly: { type: 'tag', values: ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa'] },
    });
    expect(results.violations.map((v) => `${v.id}: ${v.nodes.map((n) => n.target.join(' ')).join(', ')}`)).toEqual([]);
  });

  it('moves by byte between rows, to a row’s end, opens Advanced on Enter and returns to the text on Esc', async () => {
    await page.viewport(1280, 900);
    const { app, section } = await show('zh-tw-tainan');
    const stop = section.querySelector<HTMLElement>('[tabindex="0"]');
    expect(stop?.dataset['lab']).toBe('openai');
    stop?.focus();
    await userEvent.keyboard('{ArrowRight}');
    expect(document.activeElement?.getAttribute('data-index')).toBe('1');
    await userEvent.keyboard('{ArrowDown}');
    // Claude 1/2 legacy: [0,3) [3,5) [5,6) [6,9) [9,12) — the chip covering byte 3.
    expect(document.activeElement?.getAttribute('data-lab')).toBe('anthropic');
    expect(document.activeElement?.getAttribute('data-index')).toBe('1');
    await userEvent.keyboard('{End}');
    expect(document.activeElement?.getAttribute('data-index')).toBe('4');
    await userEvent.keyboard('{PageDown}');
    expect(document.activeElement?.getAttribute('data-lab')).toBe('xai');
    await userEvent.keyboard('{Enter}');
    expect(app.advancedOpen).toBe(true);
    expect(app.tokenizer).toBe('xai-grok2');
    expect(app.boardFocus).toBe(9);
    await userEvent.keyboard('{Escape}');
    expect(document.activeElement?.id).toBe('text-input');
  });

  it('shows the token text and the partial-character mark only with the preferences on', async () => {
    await page.viewport(1280, 900);
    const { section } = await show('zh-tw-tainan');
    expect(section.querySelectorAll('.bd-chip-text')).toHaveLength(0);
    expect(section.querySelectorAll('.cmp-chip .bd-icon')).toHaveLength(0);
    expect(section.querySelectorAll('.cmp-chip .hatch-end, .cmp-chip .hatch-start')).toHaveLength(4); // the cut edges stay
    preferences.setChipText(true);
    preferences.setChipHatch(true);
    onTestFinished(() => {
      preferences.setChipText(false);
      preferences.setChipHatch(false);
    });
    flushSync();
    expect([...section.querySelectorAll('.bd-chip-text')].map((text) => text.textContent)).toEqual(['台灣', '台灣']);
    expect(section.querySelectorAll('[data-row="anthropic"] .bd-icon')).toHaveLength(2);
  });

  it('turns the Anthropic row into the API prompt, with no chips and no grid row', async () => {
    await page.viewport(1280, 900);
    const { app, section } = await show('zh-tw-tainan');
    app.rows.select('anthropic', 'anthropic-api');
    flushSync();
    const row = section.querySelector<HTMLElement>('[data-row="anthropic"]');
    expect(row?.dataset['tokenizer']).toBe('anthropic-api');
    expect(row?.textContent).toContain('Current Claude models count tokens through the API.');
    expect(row?.querySelector('[data-testid="row-live-check"]')?.textContent).toBe('Live check…');
    expect(row?.querySelector('[role="row"]')).toBeNull();
    expect(section.querySelector('[role="grid"]')?.getAttribute('aria-rowcount')).toBe('6');
  });

  it('gives Grok-1’s dummy prefix one marker column that every row shares', async () => {
    await page.viewport(1280, 900);
    const { app, section } = await show('zh-tw-tainan');
    app.rows.select('xai', 'xai-grok1');
    flushSync();
    expect(section.dataset['cols']).toBe('13');
    const marker = section.querySelector<HTMLElement>('[data-row="xai"] [data-marker="dummy"]');
    expect(marker?.getAttribute('aria-colindex')).toBe('1');
    expect(chipsOf(section, 'openai')[0]?.getAttribute('aria-colindex')).toBe('2');
    expect(section.querySelector('#cmp-r-char [role="columnheader"]')?.getAttribute('aria-colindex')).toBe('2');
  });
});

describe('the zh-TW paragraph (1,245 bytes)', () => {
  it('mounts a window of at most 128 columns, rebased to its start, and moves it with the scroll', async () => {
    await page.viewport(1280, 900);
    const { section } = await show('zh-tw-paragraph');
    expect(section.dataset['cols']).toBe('1245');
    const [start, end] = (section.dataset['window'] ?? '').split('-').map(Number);
    expect(start).toBe(0);
    expect((end ?? 0) - (start ?? 0)).toBeLessThanOrEqual(128);
    expect(chipsOf(section, 'openai').length).toBeLessThan(80);
    const body = scroller(section, 'tbody');
    body.scrollLeft = 900 * 30;
    body.dispatchEvent(new Event('scroll'));
    await frames(3);
    const [moved, movedEnd] = (section.dataset['window'] ?? '').split('-').map(Number);
    expect(moved).toBeGreaterThan(700);
    for (const chip of chipsOf(section, 'meta')) {
      const col = Number(chip.dataset['col']);
      const span = Number(chip.getAttribute('aria-colspan'));
      expect(col + span).toBeGreaterThan(moved ?? 0);
      expect(col).toBeLessThan(movedEnd ?? 0);
    }
    expect(section.querySelectorAll('.cmp-chip.c1, .cmp-char.c1').length).toBeGreaterThan(0);
    expect(section.style.getPropertyValue('--cmp-start')).toBe(String(moved));
  });

  it('keeps the three scrollers in step and the captions at the left edge', async () => {
    await page.viewport(1280, 900);
    const { section } = await show('zh-tw-paragraph');
    const body = scroller(section, 'tbody');
    body.scrollLeft = 480;
    await frames(3);
    expect(scroller(section, 'thead').scrollLeft).toBeCloseTo(480, 0);
    expect(scroller(section, 'sbar').scrollLeft).toBeCloseTo(480, 0);
    const left = section.getBoundingClientRect().left;
    for (const caption of section.querySelectorAll('.cmp-cap'))
      expect(caption.getBoundingClientRect().left).toBeCloseTo(left, 0);
    expect(section.classList.contains('scrolled')).toBe(true);
    scroller(section, 'sbar').scrollLeft = 120;
    await frames(3);
    expect(body.scrollLeft).toBeCloseTo(120, 0);
  });
});

describe('a row whose tokenizer fails to load', () => {
  const failure = (code: string, retryable = false): Error => Object.assign(new Error(code), { code, retryable });

  it('shows the error with its action: Reload, Retry, or back to the lab’s primary tokenizer', async () => {
    await page.viewport(1280, 900);
    const clients = new FakeClients();
    const { app, section } = await showApp(new AppState(hubOf(clients.spawn), { text: 'free', rows: ['meta-llama3'] }));
    await new Promise((resolve) => setTimeout(resolve, 60)); // the rows ask after the board's debounce
    app.hub.start();
    await flush();
    clients.of('xai-grok2').loads[0]?.reject(failure('fetch')); // a 404 after a deploy
    clients.of('google-gemma4').loads[0]?.reject(failure('oom')); // on the primary: nothing to go back to
    clients.of('meta-llama3').loads[0]?.reject(failure('oom'));
    await flush();
    flushSync();
    const action = (lab: string): HTMLButtonElement | null =>
      section.querySelector<HTMLButtonElement>(`[data-row="${lab}"] [data-testid="row-action"]`);
    expect(action('xai')?.dataset['action']).toBe('reload');
    expect(action('xai')?.textContent).toBe('Reload');
    expect(action('google')?.dataset['action']).toBe('retry');
    expect(action('meta')?.dataset['action']).toBe('back');
    expect(section.querySelector('[data-row="meta"] [data-testid="row-status"]')?.textContent).toContain('try Llama 4');
    expect(action('openai')).toBeNull(); // still loading
    action('meta')?.click();
    flushSync();
    expect(section.querySelector<HTMLElement>('[data-row="meta"]')?.dataset['tokenizer']).toBe('meta-llama4-muse');
    expect(app.rows.nonDefault()).toEqual([]);
    action('google')?.click(); // Retry loads again
    await flush();
    expect(clients.of('google-gemma4').loads).toHaveLength(2);
  });
});
