/**
 * Board component tests in chromium (06 §1 "Component"): the 05 §4.1 hard cases rendered from fixture results with DOM
 * assertions, K from the 05 §3.3 formula at 360/768/1024/1440/3840 px (never literals), the APG grid's ARIA indices,
 * arithmetic virtualization of a 60k-byte synthetic result (≤ 15 rows in the DOM), CSP-safe styling and axe.
 */
import '../theme/base.css';
import axe from 'axe-core';
import { afterEach, describe, expect, it } from 'vitest';
import { page } from 'vitest/browser';
import { appWith, fixtureResult, frames, mountBoard, syntheticResult, type MountedBoard } from './board.test-helper.ts';
import { columnsFor } from './geometry.ts';

let mounted: MountedBoard | null = null;

afterEach(() => {
  mounted?.destroy();
  mounted = null;
});

async function show(...args: Parameters<typeof appWith>): Promise<MountedBoard> {
  mounted = await mountBoard(appWith(...args));
  return mounted;
}

const cells = (board: MountedBoard, selector: string): HTMLElement[] => [
  ...board.grid.querySelectorAll<HTMLElement>(selector),
];
const cell = (board: MountedBoard, selector: string): HTMLElement => {
  const found = board.grid.querySelector<HTMLElement>(selector);
  if (found === null) throw new Error(`no ${selector}`);
  return found;
};

/** The px width of `--cell` as the page resolves it now. */
function cellPx(): number {
  const probe = document.createElement('div');
  probe.style.width = 'var(--cell)';
  document.body.append(probe);
  const width = probe.getBoundingClientRect().width;
  probe.remove();
  return width;
}

describe('05 §4.1 hard cases', () => {
  it('partial-character token: sliced background, hatched cuts, aria-label (cl100k 灣)', async () => {
    await page.viewport(1440, 900);
    const board = await show(fixtureResult('openai-cl100k_base', 'zh-tw-tainan'));
    const wan = cell(board, '[data-tier="char"][data-index="1"]');
    const slices = [...wan.querySelectorAll<HTMLElement>('.bd-slice')];
    expect(slices.map((slice) => slice.className.match(/bd-t\d/)?.[0])).toEqual(['bd-t1', 'bd-t1', 'bd-t2']);
    expect(slices[2]?.classList.contains('bd-cut')).toBe(true);
    const cutRule = getComputedStyle(slices[2] ?? wan, '::before');
    expect(cutRule.backgroundImage).toContain('repeating-linear-gradient');
    expect(wan.querySelectorAll('.bd-glyph')).toHaveLength(1);
    const chip = cell(board, '[data-tier="token"][data-index="1"]');
    expect(chip.getAttribute('aria-label')).toContain('partial: first 2 of 3 bytes of 灣');
    const vis = chip.querySelector<HTMLElement>('.bd-chip');
    expect(vis?.classList.contains('hatch-end')).toBe(true);
    expect(getComputedStyle(vis ?? chip, '::after').backgroundImage).toContain('repeating-linear-gradient');
    expect(getComputedStyle(vis ?? chip).borderTopRightRadius).toBe('0px');
    expect(chip.querySelector('svg.bd-icon')).not.toBeNull();
    expect(cell(board, '[data-tier="hex"][data-index="5"] .bd-face').classList.contains('bd-cut')).toBe(true);
  });

  it('partial token crossing a char boundary: one 5-column chip, right edge hatched (Grok-2 4242)', async () => {
    await page.viewport(1440, 900);
    const board = await show(fixtureResult('xai-grok2', 'ja-shibuya-ramen'));
    const chip = cell(board, '[data-tier="token"][data-index="7"]');
    expect(chip.getAttribute('aria-colspan')).toBe('5');
    const vis = chip.querySelector('.bd-chip');
    expect(vis?.classList.contains('hatch-end')).toBe(true);
    expect(vis?.classList.contains('hatch-start')).toBe(false);
    expect(chip.textContent).toContain('4242');
  });

  it('zero-width token: a full-column marker cell with an SVG mark and aria-label (Grok-1 ▁, 360 px)', async () => {
    await page.viewport(360, 780);
    const board = await show(fixtureResult('xai-grok1', 'zh-tw-tainan'));
    const marker = cell(board, '[data-variant="marker"]');
    expect(marker.getAttribute('aria-label')).toBe('dummy prefix, 0 bytes, id 130089');
    expect(marker.getAttribute('aria-colindex')).toBe('1');
    expect(marker.querySelector('svg')).not.toBeNull();
    expect(marker.getBoundingClientRect().width).toBeCloseTo(cellPx(), 0);
    expect(marker.getBoundingClientRect().height).toBeGreaterThanOrEqual(28);
    expect(getComputedStyle(marker.querySelector('.bd-chip') ?? marker).borderTopStyle).toBe('dotted');
  });

  it('byte-fallback chips show the Byte icon and <0xF0> (Gemma 4 𰻝, shattered at stop 4)', async () => {
    await page.viewport(1440, 900);
    const board = await show(fixtureResult('google-gemma4', 'cjk-ext-g-biang'), { stage: 4 });
    const pieces = cells(board, '[data-tier="token"] .bd-piece').map((el) => el.textContent);
    expect(pieces).toEqual(['<0xF0>', '<0xB0>', '<0xBB>', '<0x9D>']);
    expect(cells(board, '[data-tier="token"] svg.bd-icon')).toHaveLength(4);
  });

  it('USER_DEFINED symbols carry the lock (Grok-1 digits)', async () => {
    await page.viewport(1440, 900);
    const board = await show(fixtureResult('xai-grok1', 'zh-date'));
    const digit = cell(board, '[data-tier="token"][data-index="1"]');
    expect(digit.getAttribute('aria-label')).toContain('pre-matched symbol, never merges');
    expect(digit.querySelector('svg.bd-icon')).not.toBeNull();
  });

  it('a direct-hit chunk says “no merges” at stop 5 (o200k Hello)', async () => {
    await page.viewport(1440, 900);
    const board = await show(fixtureResult('openai-o200k_base', 'en-hello-world'), { stage: 5, step: 0 });
    expect(cell(board, '[data-tier="chunk"][data-index="0"]').textContent).toContain('no merges');
  });

  it('grapheme brackets, ZWJ stand-ins in the subset font, combining marks on a dotted circle', async () => {
    await page.viewport(1440, 900);
    let board = await show(fixtureResult('openai-o200k_base', 'emoji-family-zwj'));
    const bracket = board.target.querySelector<HTMLElement>('.bd-gbracket');
    expect(bracket?.className).toContain('s18');
    const zwj = cell(board, '[data-tier="char"][data-index="1"]');
    expect(zwj.textContent).toContain('ZWJ');
    expect(getComputedStyle(zwj.querySelector('.bd-glyph') ?? zwj).fontFamily).toContain('TSBS Stand-ins');
    mounted?.destroy();
    board = await show(fixtureResult('openai-o200k_base', 'katakana-decomposed'));
    const mark = cell(board, '[data-tier="char"][data-index="1"]');
    expect(mark.querySelector('.bd-glyph')?.textContent).toBe('◌゙');
    expect(mark.getAttribute('aria-label')).toContain('combining mark U+3099 attached to カ');
  });

  it('NFKC: the normalized-text row underlines the changed run (Claude legacy ﾀﾞ → ダ)', async () => {
    await page.viewport(1440, 900);
    const result = fixtureResult('anthropic-claude-legacy', 'halfwidth-katakana-dakuten', { normalize: 'NFKC' });
    const board = await show(result);
    const source = board.target.querySelector<HTMLElement>('.bd-src.changed');
    expect(source?.textContent).toBe('ﾀﾞ');
    expect(getComputedStyle(source ?? board.grid).textDecorationLine).toBe('underline');
    expect(board.grid.classList.contains('nfkc')).toBe(true);
  });

  it('special-token match: SPECIAL badge with a dashed border', async () => {
    await page.viewport(1440, 900);
    const { buildResult } = await import('@tsbs/core/model/build-result');
    const { analyzeText } = await import('@tsbs/core/text/analyze');
    const result = buildResult({
      tokenizer: 'openai-o200k_base',
      family: 'bytelevel-bpe',
      options: { specialTokens: 'match' },
      analysis: analyzeText('<|endoftext|>'),
      chunks: { byteStart: [0, 13], kind: [1] },
      tokens: { id: [199999], byteStart: [0, 13], kind: [5] },
      timeline: null,
    });
    const board = await show(result);
    const chip = cell(board, '[data-tier="token"][data-index="0"]');
    expect(chip.querySelector('.bd-badge')?.textContent).toBe('SPECIAL');
    expect(getComputedStyle(chip.querySelector('.bd-chip') ?? chip).borderTopStyle).toBe('dashed');
  });
});

describe('K from the 05 §3.3 formula (never literals)', () => {
  /** boardWidth = viewport minus the side rail where one exists, capped by the board max-width (05 §3.3). */
  function boardWidthFor(viewport: number): number {
    const rail = viewport >= 2560 ? 420 : viewport >= 1024 ? 320 : 0;
    const cap = viewport >= 2560 ? 2400 : viewport >= 1440 ? 1600 : Number.POSITIVE_INFINITY;
    return Math.min(viewport - rail, cap);
  }

  for (const width of [360, 768, 1024, 1440, 3840]) {
    it(`at ${String(width)} px`, async () => {
      await page.viewport(width, 900);
      const board = await show(fixtureResult('openai-o200k_base', 'ja-paragraph'));
      await frames(2);
      const expected = columnsFor(boardWidthFor(width), cellPx());
      expect(Number(board.grid.getAttribute('aria-colcount'))).toBe(expected);
      const tier = cell(board, '[role="row"]');
      expect(getComputedStyle(tier).gridTemplateColumns.split(' ')).toHaveLength(expected);
      expect(document.documentElement.scrollWidth).toBeLessThanOrEqual(width);
    });
  }
});

describe('APG layout grid ARIA (05 §8)', () => {
  it('indexes mounted rows and cells; fragments describe themselves', async () => {
    await page.viewport(360, 780);
    const result = fixtureResult('openai-o200k_base', 'mixed-hello-taiwan-tokyo');
    const board = await show(result);
    const tiers = 3; // stage 6: char, hex, token
    const rowCount = board.grid.querySelectorAll('.bd-row').length;
    expect(board.grid.getAttribute('aria-rowcount')).toBe(String(rowCount * tiers));
    expect(board.grid.getAttribute('aria-colcount')).toBe('9');
    const ariaRows = cells(board, '[role="row"]');
    ariaRows.forEach((row, i) => {
      expect(row.getAttribute('aria-rowindex')).toBe(String(i + 1));
    });
    for (const gridcell of cells(board, '[role="gridcell"]')) {
      const start = Number(/\bc(\d+)\b/.exec(gridcell.className)?.[1]);
      const span = Number(/\bs(\d+)\b/.exec(gridcell.className)?.[1]);
      expect(gridcell.getAttribute('aria-colindex')).toBe(String(start));
      expect(gridcell.getAttribute('aria-colspan')).toBe(String(span));
    }
    const fragments = cells(board, '[data-tier="token"][data-index="4"]');
    expect(fragments).toHaveLength(2);
    expect(fragments.map((f) => f.getAttribute('aria-describedby'))).toEqual(['frag-token-4', 'frag-token-4-2']);
    expect(document.getElementById('frag-token-4')?.textContent).toBe(
      'token 5, continued (part 1 of 2), continues on the next row',
    );
    expect(fragments[0]?.hasAttribute('data-first')).toBe(true);
    expect(fragments[1]?.hasAttribute('data-first')).toBe(false);
    expect(cells(board, '[tabindex="0"]')).toHaveLength(1);
  });
});

describe('virtualization (AD-27)', () => {
  it('renders ≤ 15 rows of a 60k-byte result and keeps the focused row mounted while scrolling', async () => {
    await page.viewport(1440, 900);
    const text = Array.from({ length: 20_000 }, (_, i) => String.fromCodePoint(0x4e00 + (i % 2000))).join('');
    const result = syntheticResult(text);
    expect(result.utf8.length).toBe(60_000);
    const board = await show(result, { stage: 6 });
    const rows = (): number => board.grid.querySelectorAll('.bd-row').length;
    expect(rows()).toBeLessThanOrEqual(15);
    const first = cell(board, '[tabindex="0"]');
    first.focus();
    const frameTimes: number[] = [];
    let last = performance.now();
    for (let i = 0; i < 90; i++) {
      window.scrollBy(0, 150);
      await frames(1);
      const now = performance.now();
      frameTimes.push(now - last);
      last = now;
      expect(rows()).toBeLessThanOrEqual(15);
    }
    frameTimes.sort((a, b) => a - b);
    const median = frameTimes[Math.floor(frameTimes.length / 2)] ?? 0;
    expect(median).toBeLessThan(20);
    expect(board.grid.querySelector('[data-row="0"]')).not.toBeNull();
    expect(document.activeElement).toBe(first);
    const height = board.grid.getBoundingClientRect().height;
    const rowHeight = board.grid.querySelector<HTMLElement>('.bd-row')?.getBoundingClientRect().height ?? 0;
    const total = Number(board.grid.getAttribute('aria-rowcount')) / 3;
    expect(height).toBeCloseTo(total * rowHeight, -1);
    window.scrollTo(0, 0);
  });

  it('restores focus to the same byte anchor after a remount (new K)', async () => {
    await page.viewport(1440, 900);
    const board = await show(fixtureResult('openai-o200k_base', 'ja-paragraph'));
    const target = cell(board, '[data-tier="char"][data-index="40"]');
    target.focus();
    target.dispatchEvent(new FocusEvent('focusin', { bubbles: true }));
    await page.viewport(800, 900);
    await frames(4);
    const active = document.activeElement as HTMLElement | null;
    expect(active?.dataset['tier']).toBe('char');
    expect(active?.dataset['index']).toBe('40');
    expect(active?.getAttribute('tabindex')).toBe('0');
  });
});

describe('CSP and accessibility', () => {
  it('sets no style attribute except CSSOM custom properties and geometry from style: directives', async () => {
    await page.viewport(1440, 900);
    const board = await show(fixtureResult('openai-cl100k_base', 'zh-tw-tainan'));
    for (const element of board.target.querySelectorAll<HTMLElement>('[style]')) {
      for (const property of Array.from(element.style)) expect(property).toMatch(/^(--[a-z-]+|height|width)$/);
    }
  });

  for (const [tokenizer, name, stage, width] of [
    ['openai-cl100k_base', 'zh-tw-tainan', 6, 1440],
    ['openai-o200k_base', 'ja-text', 5, 1024],
    ['xai-grok1', 'zh-tw-tainan', 6, 360],
    ['xai-grok2', 'ja-shibuya-ramen', 6, 1440],
    ['openai-o200k_base', 'emoji-family-zwj', 6, 1440],
    ['openai-o200k_base', 'katakana-decomposed', 4, 768],
    ['openai-o200k_base', 'en-hello-world', 5, 1440],
  ] as const) {
    it(`is axe clean: ${tokenizer} ${name} at stop ${String(stage)}, ${String(width)} px`, async () => {
      await page.viewport(width, 900);
      const board = await show(fixtureResult(tokenizer, name), { stage, step: 2 });
      const results = await axe.run(board.target, {
        runOnly: { type: 'tag', values: ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa'] },
      });
      expect(results.violations.map((v) => `${v.id}: ${v.nodes.map((n) => n.target.join(' ')).join(', ')}`)).toEqual(
        [],
      );
    });
  }
});
