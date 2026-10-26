/**
 * Board component tests in chromium (06 §1 "Component"): the 05 §4.1 hard cases rendered from fixture results with DOM
 * assertions, K from the 05 §3.3 formula at 360/768/1024/1440/3840 px (never literals), the per-breakpoint tracks
 * (≥ 2560 px scaling from --cell) with every token id inside its chip (PA-17: narrowed, then shrunk, never clipped), the
 * APG grid's ARIA indices, arithmetic virtualization of a 60k-byte synthetic result (≤ 15 rows in the DOM, every row in
 * view mounted while scrolling), CSP-safe styling and axe.
 */
import '../theme/base.css';
import axe from 'axe-core';
import { afterEach, describe, expect, it } from 'vitest';
import { page } from 'vitest/browser';
import { packRows } from '@tsbs/core/layout/pack-rows';
import {
  appWith,
  boardWidthFor,
  cellPx,
  expectedColumns,
  fixtureResult,
  frames,
  mountBoard,
  syntheticResult,
  type MountedBoard,
} from './board.test-helper.ts';
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

describe('05 §4.1 hard cases', () => {
  it('partial-character token: sliced background, hatched cuts, aria-label (cl100k 灣)', async () => {
    await page.viewport(1440, 900);
    const board = await show(fixtureResult('openai-cl100k_base', 'zh-tw-tainan'));
    const wan = cell(board, '[data-tier="char"][data-index="1"]');
    const slices = [...wan.querySelectorAll<HTMLElement>('.bd-slice')];
    expect(slices.map((slice) => /bd-t\d/.exec(slice.className)?.[0])).toEqual(['bd-t1', 'bd-t1', 'bd-t2']);
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

  it('whole char in one token: one tint at 25 % over all its slices, a 3-column chip with the id inside (o200k 台)', async () => {
    await page.viewport(1440, 900);
    const board = await show(fixtureResult('openai-o200k_base', 'zh-tw-tainan'));
    const tai = cell(board, '[data-tier="char"][data-index="0"]');
    const slices = [...tai.querySelectorAll<HTMLElement>('.bd-slice')];
    expect(slices).toHaveLength(3);
    const tints = slices.map((slice) => /bd-t\d/.exec(slice.className)?.[0]);
    expect(new Set(tints).size).toBe(1);
    expect(slices.some((slice) => slice.classList.contains('bd-cut'))).toBe(false);
    // The slice background is the token tint mixed 25 % into the surface (05 §11): compare with a probe in the same tint.
    const probe = document.createElement('span');
    probe.style.setProperty('background-color', 'color-mix(in oklch, var(--tint) 25%, var(--surface))');
    slices[0]?.append(probe);
    const expected = getComputedStyle(probe).backgroundColor;
    probe.remove();
    for (const slice of slices) expect(getComputedStyle(slice).backgroundColor).toBe(expected);
    const chip = cell(board, '[data-tier="token"][data-index="0"]');
    expect(chip.getAttribute('aria-colspan')).toBe('3');
    expect(chip.hasAttribute('data-partial')).toBe(false);
    expect(chip.querySelector('.bd-chip')?.classList.contains(tints[0] ?? '')).toBe(true);
    expect(chip.querySelector('.bd-id')?.textContent).toBe('3735');
    expect(chip.getAttribute('aria-label')).toContain('token 1 of 4, id 3735, 3 bytes');
    expect(chip.getAttribute('aria-label')).not.toContain('partial');
  });

  it('fused dummy prefix: the first chip reads ▁Hello and its label says so (Grok-1 Hello)', async () => {
    await page.viewport(1440, 900);
    const board = await show(fixtureResult('xai-grok1', 'en-hello-world'));
    expect(cells(board, '[data-variant="marker"]')).toHaveLength(0);
    const chip = cell(board, '[data-tier="token"][data-index="0"]');
    expect(chip.querySelector('.bd-chip-text')?.textContent).toBe('▁Hello');
    const label = chip.getAttribute('aria-label') ?? '';
    expect(label).toContain('▁ escaped space Hello');
    expect(label).toContain('includes the dummy prefix');
    const world = cell(board, '[data-tier="token"][data-index="2"]');
    expect(world.querySelector('.bd-chip-text')?.textContent).toBe('▁world');
    expect(world.getAttribute('aria-label')).not.toContain('includes the dummy prefix');
  });

  it('whitespace and control stand-ins ␠ ⏎ in the subset font, named in the labels (o200k code)', async () => {
    await page.viewport(1440, 900);
    const board = await show(fixtureResult('openai-o200k_base', 'en-contraction-code'));
    for (const [index, glyph, name] of [
      [3, '␠', 'space'],
      [8, '⏎', 'line feed'],
      [9, '⏎', 'line feed'],
    ] as const) {
      const char = cell(board, `[data-tier="char"][data-index="${String(index)}"]`);
      const shown = char.querySelector<HTMLElement>('.bd-glyph');
      expect(shown?.textContent).toBe(glyph);
      expect(shown?.classList.contains('standin')).toBe(true);
      expect(getComputedStyle(shown ?? char).fontFamily).toContain('TSBS Stand-ins');
      expect(char.getAttribute('aria-label')).toContain(`character ${String(index + 1)} of 18: ${name}, U+`);
    }
    const here = cell(board, '[data-tier="token"][data-index="1"]');
    expect(here.querySelector('.bd-chip-text')?.textContent).toBe('␠here');
    expect(here.getAttribute('aria-label')).toContain('␠ space here');
    const code = cell(board, '[data-tier="token"][data-index="3"]');
    expect(code.querySelector('.bd-chip-text')?.textContent).toBe('␠code');
    expect(code.getAttribute('aria-label')).toContain('␠ space code');
    // The 2-column ⏎⏎ chip has room for its id only: its glyphs are the char tier's above it.
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

describe('row tracks by breakpoint (05 §3.3)', () => {
  /** Rect of the first element matching `selector` inside the first packed row. */
  const rectIn = (board: MountedBoard, selector: string): DOMRect | undefined =>
    board.grid.querySelector('.bd-row')?.querySelector(selector)?.getBoundingClientRect();

  for (const width of [600, 1440]) {
    it(`fits the token tier in the fixed row height with no id line at ${String(width)} px (PA-17)`, async () => {
      await page.viewport(width, 900);
      const board = await show(fixtureResult('openai-cl100k_base', 'zh-tw-tainan'));
      expect(board.target.querySelector('.bd-ids, .bd-idl')).toBeNull();
      const row = board.grid.querySelector('.bd-row')?.getBoundingClientRect();
      const rowHeight = Number.parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--row-h'));
      expect(row?.height).toBe(rowHeight);
      expect(rectIn(board, '.bd-cell-token')?.bottom ?? Number.POSITIVE_INFINITY).toBeLessThanOrEqual(row?.bottom ?? 0);
    });
  }

  it('scales the tracks, the cells and the type from --cell at ≥ 2560 px', async () => {
    await page.viewport(3840, 900);
    const board = await show(fixtureResult('openai-cl100k_base', 'zh-tw-tainan'));
    const cell = cellPx();
    expect(cell).toBeGreaterThan(40);
    const row = board.grid.querySelector('.bd-row')?.getBoundingClientRect();
    expect(row?.height).toBeCloseTo(cell * 3.5 + 44, 0);
    expect(rectIn(board, '.bd-cell-char')?.height).toBeCloseTo(cell + 21, 0);
    expect(rectIn(board, '.bd-cell-token')?.height).toBeCloseTo(cell * 0.75 + 5, 0);
    expect(rectIn(board, '.bd-cell-token')?.bottom ?? Number.POSITIVE_INFINITY).toBeLessThanOrEqual(row?.bottom ?? 0);
    const glyph = board.grid.querySelector('.bd-glyph.cjk');
    expect(Number.parseFloat(getComputedStyle(glyph ?? board.grid).fontSize)).toBeGreaterThan(22);
  });
});

describe('token ids inside every chip (PA-17)', () => {
  /** The digits subset is `font-display: block`: wait for it so the rects measure its glyphs, not a fallback's. */
  const digitsLoaded = async (): Promise<void> => {
    await document.fonts.load('12px "TSBS Digits"', '0123456789');
    await frames(2);
  };

  /** `font-stretch` as computed (`fontStretch` is typed deprecated: CSS Fonts 4 renames it `font-width`). */
  const fontStretch = (element: Element): string => getComputedStyle(element).getPropertyValue('font-stretch');

  /** Every token-tier id lies inside its chip's box (1 px border tolerance) and is whole. */
  const expectIdsInside = (board: MountedBoard, ids: readonly string[]): void => {
    const shown = cells(board, '[data-tier="token"] .bd-id');
    expect(shown.map((id) => id.textContent)).toEqual(ids);
    for (const id of shown) {
      const chip = id.closest('.bd-chip')?.getBoundingClientRect();
      const box = id.getBoundingClientRect();
      expect(box.left, `${id.textContent} left`).toBeGreaterThanOrEqual((chip?.left ?? 0) + 1 - 0.01);
      expect(box.right, `${id.textContent} right`).toBeLessThanOrEqual((chip?.right ?? 0) - 1 + 0.01);
      expect(box.top, `${id.textContent} top`).toBeGreaterThanOrEqual((chip?.top ?? 0) + 1 - 0.01);
      expect(box.bottom, `${id.textContent} bottom`).toBeLessThanOrEqual((chip?.bottom ?? 0) - 1 + 0.01);
      expect(id.scrollWidth, `${id.textContent} whole`).toBeLessThanOrEqual(Math.ceil(box.width));
    }
  };

  for (const width of [360, 600, 1440]) {
    it(`puts every id of cl100k 台灣台南 inside its chip at ${String(width)} px, in the digits subset`, async () => {
      await page.viewport(width, width === 360 ? 780 : 900);
      const board = await show(fixtureResult('openai-cl100k_base', 'zh-tw-tainan'));
      await digitsLoaded();
      expectIdsInside(board, ['55038', '66285', '96', '55038', '59563']);
      const id = cell(board, '[data-tier="token"][data-index="2"] .bd-id');
      expect(getComputedStyle(id).fontFamily).toContain('TSBS Digits');
      expect(document.fonts.check('12px "TSBS Digits"', '96')).toBe(true);
    });
  }

  it('narrows the width axis first, then shrinks the size (1-column chips with 1-, 4- and 6-digit ids)', async () => {
    await page.viewport(1440, 900);
    const { buildResult } = await import('@tsbs/core/model/build-result');
    const { analyzeText } = await import('@tsbs/core/text/analyze');
    const result = buildResult({
      tokenizer: 'openai-o200k_base',
      family: 'bytelevel-bpe',
      analysis: analyzeText('abc'),
      chunks: { byteStart: [0, 3], kind: [0] },
      tokens: { id: [7, 4321, 654321], byteStart: [0, 1, 2, 3], kind: [0, 0, 0] },
      timeline: null,
    });
    const board = await show(result);
    await digitsLoaded();
    expectIdsInside(board, ['7', '4321', '654321']);
    const cell = cellPx();
    const room = cell - 8; // 1 px inset + 1 px border + 2 px padding on each side, no marks
    const style = (index: number): CSSStyleDeclaration =>
      getComputedStyle(cells(board, `[data-tier="token"][data-index="${String(index)}"] .bd-id`)[0] ?? board.grid);
    const stretch = (index: number): number => Number.parseFloat(style(index).getPropertyValue('font-stretch'));
    const size = (index: number): number => Number.parseFloat(style(index).fontSize);
    // w = 262.2 · room / (digits · em) − 50, clamped to the axis; below 62.5 % the size gives way instead.
    expect(stretch(0)).toBe(100);
    expect(size(0)).toBe(12);
    expect(stretch(1)).toBeCloseTo(Math.min(100, (262.2 * room) / (4 * 12) - 50), 0);
    expect(stretch(1)).toBeLessThan(100);
    expect(stretch(1)).toBeGreaterThan(62.5);
    expect(size(1)).toBe(12);
    expect(stretch(2)).toBe(62.5);
    expect(size(2)).toBeCloseTo(room / (6 * 0.429), 1);
  });

  it('fits a 6-digit id in a 1-column chip (Gemma 4 “I” in I’m here) and keeps 100 % where there is room', async () => {
    await page.viewport(1440, 900);
    let board = await show(fixtureResult('google-gemma4', 'en-contraction-code'));
    await digitsLoaded();
    const chip = cell(board, '[data-tier="token"][data-index="0"]');
    expect(chip.getAttribute('aria-colspan')).toBe('1');
    const id = chip.querySelector<HTMLElement>('.bd-id');
    expect(id?.textContent).toBe('236777');
    expect(fontStretch(id ?? chip)).toBe('62.5%');
    const chipSize = Number.parseFloat(getComputedStyle(chip.querySelector('.bd-chip') ?? chip).fontSize);
    expect(Number.parseFloat(getComputedStyle(id ?? chip).fontSize)).toBeLessThan(chipSize);
    expectIdsInside(
      board,
      cells(board, '[data-tier="token"] .bd-id').map((el) => el.textContent),
    );
    mounted?.destroy();
    // cl100k 66285: 2 columns at the 32 px cell, a hatched end: 52 px of room for 5 digits needs no narrowing.
    board = await show(fixtureResult('openai-cl100k_base', 'zh-tw-tainan'));
    await digitsLoaded();
    expect(cellPx()).toBe(32);
    const wide = cell(board, '[data-tier="token"][data-index="1"] .bd-id');
    expect(wide.textContent).toBe('66285');
    expect(fontStretch(wide)).toBe('100%');
    expect(getComputedStyle(wide).fontSize).toBe('12px');
  });

  it('stacks a narrow chip’s marks under its id (cl100k 96, 1 column, hatch mark)', async () => {
    await page.viewport(1440, 900);
    const board = await show(fixtureResult('openai-cl100k_base', 'zh-tw-tainan'));
    await digitsLoaded();
    const chip = cell(board, '[data-tier="token"][data-index="2"]');
    expect(chip.getAttribute('aria-colspan')).toBe('1');
    expect(chip.querySelector('.bd-chip')?.classList.contains('stacked')).toBe(true);
    const id = chip.querySelector('.bd-id')?.getBoundingClientRect();
    const mark = chip.querySelector('svg.bd-icon')?.getBoundingClientRect();
    expect(mark?.top ?? 0).toBeGreaterThanOrEqual(id?.bottom ?? Number.POSITIVE_INFINITY);
    const vis = chip.querySelector('.bd-chip')?.getBoundingClientRect();
    expect(mark?.bottom ?? Number.POSITIVE_INFINITY).toBeLessThanOrEqual((vis?.bottom ?? 0) - 1);
  });

  it('shows the id on every fragment of a token split over rows (o200k token 5 at 360 px)', async () => {
    await page.viewport(360, 780);
    const board = await show(fixtureResult('openai-o200k_base', 'mixed-hello-taiwan-tokyo'));
    await digitsLoaded();
    const fragments = cells(board, '[data-tier="token"][data-index="4"]');
    expect(fragments).toHaveLength(2);
    const ids = fragments.map((fragment) => fragment.querySelector('.bd-id')?.textContent);
    expect(ids[0]).toMatch(/^\d+$/);
    expect(ids[1]).toBe(ids[0]);
    expectIdsInside(
      board,
      cells(board, '[data-tier="token"] .bd-id').map((el) => el.textContent),
    );
  });

  it('puts a live part’s hex under its id at stops 4–5, wide or narrow (o200k Hello, stop 5)', async () => {
    await page.viewport(1440, 900);
    const board = await show(fixtureResult('openai-o200k_base', 'en-hello-world'), { stage: 5, step: 2 });
    await digitsLoaded();
    const parts = cells(board, '[data-tier="token"][data-variant="part"]');
    expect(parts.map((part) => Number(part.getAttribute('aria-colspan')))).toContain(1);
    expect(Math.max(...parts.map((part) => Number(part.getAttribute('aria-colspan'))))).toBeGreaterThan(2);
    for (const part of parts) {
      const id = part.querySelector('.bd-id')?.getBoundingClientRect();
      const hex = part.querySelector('.bd-part-text')?.getBoundingClientRect();
      expect(hex?.top ?? 0).toBeGreaterThanOrEqual(id?.bottom ?? Number.POSITIVE_INFINITY);
      expect(part.getAttribute('aria-label')).toMatch(/^part \d+ of \d+, id \d+, [0-9A-F]{2}/);
    }
    expectIdsInside(
      board,
      parts.map((part) => part.querySelector('.bd-id')?.textContent ?? ''),
    );
  });

  it('keeps byte-fallback chips to <0xNN> (Gemma 4 𰻝): the label and the inspector carry their ids', async () => {
    await page.viewport(1440, 900);
    const board = await show(fixtureResult('google-gemma4', 'cjk-ext-g-biang'), { stage: 4 });
    expect(cells(board, '[data-tier="token"] .bd-piece')).toHaveLength(4);
    expect(cells(board, '[data-tier="token"] .bd-id')).toHaveLength(0);
  });
});

describe('APG layout grid ARIA (05 §8)', () => {
  it('indexes mounted rows and cells; fragments describe themselves', async () => {
    await page.viewport(360, 780);
    const result = fixtureResult('openai-o200k_base', 'mixed-hello-taiwan-tokyo');
    const board = await show(result);
    const tiers = 3; // stage 6: char, hex, token
    const K = expectedColumns(360);
    expect(board.grid.getAttribute('aria-colcount')).toBe(String(K));
    const rowCount = board.grid.querySelectorAll('.bd-row').length;
    expect(rowCount).toBe(packRows(result, K).length);
    expect(board.grid.getAttribute('aria-rowcount')).toBe(String(rowCount * tiers));
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
  // 90 scroll steps over a 60k-byte board take ~10 s on a workstation and longer on a 2-core CI runner.
  it(
    'renders ≤ 15 rows of a 60k-byte result and keeps the focused row mounted while scrolling',
    { timeout: 60_000 },
    async () => {
      await page.viewport(1440, 900);
      const text = Array.from({ length: 20_000 }, (_, i) => String.fromCodePoint(0x4e00 + (i % 2000))).join('');
      const result = syntheticResult(text);
      expect(result.utf8.length).toBe(60_000);
      const board = await show(result, { stage: 6 });
      const rows = (): number => board.grid.querySelectorAll('.bd-row').length;
      expect(rows()).toBeLessThanOrEqual(15);
      const first = cell(board, '[tabindex="0"]');
      first.focus();
      const rowHeight = board.grid.querySelector<HTMLElement>('.bd-row')?.getBoundingClientRect().height ?? 0;
      expect(rowHeight).toBeGreaterThan(0);
      const total = Number(board.grid.getAttribute('aria-rowcount')) / 3;
      /** Every packed row that intersects the viewport (from the grid top and the fixed row height) is in the DOM. */
      const expectWindowFollowsScroll = (step: number): void => {
        const top = board.grid.getBoundingClientRect().top;
        const firstInView = Math.max(0, Math.floor(-top / rowHeight));
        const lastInView = Math.min(total - 1, Math.ceil((innerHeight - top) / rowHeight) - 1);
        expect(lastInView).toBeGreaterThanOrEqual(firstInView);
        for (let r = firstInView; r <= lastInView; r++)
          expect(
            board.grid.querySelector(`[data-row="${String(r)}"]`),
            `row ${String(r)} at step ${String(step)}`,
          ).not.toBeNull();
      };
      const frameTimes: number[] = [];
      for (let i = 0; i < 90; i++) {
        const start = performance.now();
        window.scrollBy(0, 150);
        await frames(1);
        frameTimes.push(performance.now() - start);
        await frames(1); // the board's scroll handler runs in a frame of its own (rAF), then the window re-renders
        expect(rows()).toBeLessThanOrEqual(15);
        expectWindowFollowsScroll(i);
      }
      frameTimes.sort((a, b) => a - b);
      const median = frameTimes[Math.floor(frameTimes.length / 2)] ?? 0;
      expect(median).toBeLessThan(20);
      expect(board.grid.querySelector('[data-row="0"]')).not.toBeNull();
      expect(document.activeElement).toBe(first);
      const height = board.grid.getBoundingClientRect().height;
      expect(height).toBeCloseTo(total * rowHeight, -1);
      window.scrollTo(0, 0);
    },
  );

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
