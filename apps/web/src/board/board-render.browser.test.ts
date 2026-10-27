/**
 * Board component tests in chromium (06 §1 "Component"): the 05 §4.1 hard cases rendered from fixture results with DOM
 * assertions, K from the 05 §3.3 formula at 360/768/1024/1440/3840 px (never literals), the per-breakpoint tracks
 * (≥ 2560 px scaling from --cell; the 12 px gap under the token tier) with every token id inside its chip (PA-17: narrowed,
 * then shrunk, never clipped; two lines for a bare 1-column id of ≥ 5 digits; markers and byte-fallback chips; the stop-5
 * star clear of the id), the APG grid's ARIA indices, arithmetic virtualization of a 60k-byte synthetic result (≤ 15 rows in the DOM, every row in
 * view mounted while scrolling), CSP-safe styling and axe.
 */
import '../theme/base.css';
import '../motion/motion.css';
import axe from 'axe-core';
import { flushSync } from 'svelte';
import { afterEach, describe, expect, it } from 'vitest';
import { page } from 'vitest/browser';
import type { TokenizationResult } from '@tsbs/core';
import { packRows } from '@tsbs/core/layout/pack-rows';
import { TokenizationView } from '@tsbs/core/model/view';
import type { AppState } from '../app/app-state.svelte.ts';
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

  it('zero-width token: a full-column marker cell with its id over ▁ and an aria-label (Grok-1 ▁, 360 px)', async () => {
    await page.viewport(360, 780);
    const board = await show(fixtureResult('xai-grok1', 'zh-tw-tainan'));
    const marker = cell(board, '[data-variant="marker"]');
    expect(marker.getAttribute('aria-label')).toBe('dummy prefix, 0 bytes, id 130089');
    expect(marker.getAttribute('aria-colindex')).toBe('1');
    expect(marker.querySelector('.bd-id')?.textContent).toBe('130089');
    expect(marker.querySelector('svg')).toBeNull(); // the dotted border is the zero-width cue (PA-17)
    expect(marker.getBoundingClientRect().width).toBeCloseTo(cellPx(), 0);
    expect(marker.getBoundingClientRect().height).toBeGreaterThanOrEqual(28);
    expect(getComputedStyle(marker.querySelector('.bd-chip') ?? marker).borderTopStyle).toBe('dotted');
  });

  it('byte-fallback chips show their id over <0xF0>, no icon (Gemma 4 𰻝, shattered at stop 4)', async () => {
    await page.viewport(1440, 900);
    const board = await show(fixtureResult('google-gemma4', 'cjk-ext-g-biang'), { stage: 4 });
    const pieces = cells(board, '[data-tier="token"] .bd-piece').map((el) => el.textContent);
    expect(pieces).toEqual(['<0xF0>', '<0xB0>', '<0xBB>', '<0x9D>']);
    expect(cells(board, '[data-tier="token"] .bd-id').map((el) => el.textContent)).toEqual([
      '478',
      '414',
      '425',
      '395',
    ]);
    expect(cells(board, '[data-tier="token"] svg.bd-icon')).toHaveLength(0);
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

  for (const [width, height, gap] of [
    [600, 132, 18],
    [800, 148, 22],
    [1440, 169, 21],
  ] as const) {
    it(`ends the ${String(height)} px row with a 12 px gap under the token tier at ${String(width)} px (PA-17)`, async () => {
      await page.viewport(width, 900);
      const board = await show(fixtureResult('openai-o200k_base', 'ja-paragraph'));
      expect(board.target.querySelector('.bd-ids, .bd-idl')).toBeNull();
      const first = board.grid.querySelector('[data-row="0"]');
      const row = first?.getBoundingClientRect();
      const rowHeight = Number.parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--row-h'));
      expect(rowHeight).toBe(height);
      expect(row?.height).toBe(rowHeight);
      const token = first?.querySelector('.bd-cell-token')?.getBoundingClientRect();
      expect((token?.bottom ?? Number.POSITIVE_INFINITY) + 12).toBeLessThanOrEqual(row?.bottom ?? 0);
      // No id track (ids sit inside the chips); the gap keeps the chips clear of the next row's characters.
      const next = board.grid.querySelector('[data-row="1"] .bd-cell-char')?.getBoundingClientRect();
      expect((next?.top ?? 0) - (token?.bottom ?? 0)).toBeCloseTo(gap, 0);
    });
  }

  it('scales the tracks, the cells and the type from --cell at ≥ 2560 px', async () => {
    await page.viewport(3840, 900);
    const board = await show(fixtureResult('openai-cl100k_base', 'zh-tw-tainan'));
    const cell = cellPx();
    expect(cell).toBeGreaterThan(40);
    const row = board.grid.querySelector('.bd-row')?.getBoundingClientRect();
    expect(row?.height).toBeCloseTo(cell * 3.5 + 56, 0);
    expect(rectIn(board, '.bd-cell-char')?.height).toBeCloseTo(cell + 21, 0);
    expect(rectIn(board, '.bd-cell-token')?.height).toBeCloseTo(cell * 0.75 + 5, 0);
    expect((rectIn(board, '.bd-cell-token')?.bottom ?? Number.POSITIVE_INFINITY) + 12).toBeLessThanOrEqual(
      row?.bottom ?? 0,
    );
    const glyph = board.grid.querySelector('.bd-glyph.cjk');
    expect(Number.parseFloat(getComputedStyle(glyph ?? board.grid).fontSize)).toBeGreaterThan(22);
  });
});

describe('token ids inside every chip (PA-17)', () => {
  afterEach(() => {
    document.documentElement.dataset['cellSize'] = 'M';
  });

  /** The digits subset is `font-display: block`: wait for it so the rects measure its glyphs, not a fallback's. */
  const digitsLoaded = async (): Promise<void> => {
    await document.fonts.load('12px "TSBS Digits"', '0123456789');
    await frames(2);
  };

  /** `font-stretch` as computed (`fontStretch` is typed deprecated: CSS Fonts 4 renames it `font-width`). */
  const fontStretch = (element: Element): string => getComputedStyle(element).getPropertyValue('font-stretch');
  const px = (value: string): number => Number.parseFloat(value);

  interface Box {
    readonly left: number;
    readonly right: number;
    readonly top: number;
    readonly bottom: number;
  }

  /** The chip's padding box: its border box less the border, which an id must not run into. */
  const paddingBox = (chip: Element): Box => {
    const rect = chip.getBoundingClientRect();
    const style = getComputedStyle(chip);
    return {
      left: rect.left + px(style.borderLeftWidth),
      right: rect.right - px(style.borderRightWidth),
      top: rect.top + px(style.borderTopWidth),
      bottom: rect.bottom - px(style.borderBottomWidth),
    };
  };

  /** The chip's content box: its padding box less the inline paddings. */
  const contentBox = (chip: Element): Box => {
    const pad = paddingBox(chip);
    const style = getComputedStyle(chip);
    return { ...pad, left: pad.left + px(style.paddingLeft), right: pad.right - px(style.paddingRight) };
  };

  /**
   * An element's glyph run: across, the extent of its text (a Range over its contents, not the element's box); down, its
   * line box. A text Range is as tall as the font's content area (ascent + descent: 1.362 em in Noto Sans), which pokes
   * past the line-height-1 lines the chip stacks, so its height would put digits outside a chip they sit inside.
   */
  const glyphRun = (element: Element): Box => {
    const range = document.createRange();
    range.selectNodeContents(element);
    const text = range.getBoundingClientRect();
    const box = element.getBoundingClientRect();
    return { left: text.left, right: text.right, top: box.top, bottom: box.bottom };
  };

  /** `inner` lies inside `outer` (0.02 px: layout positions are 1/64 px units). */
  const expectWithin = (inner: Box, outer: Box, what: string): void => {
    expect(inner.left, `${what} left`).toBeGreaterThanOrEqual(outer.left - 0.02);
    expect(inner.right, `${what} right`).toBeLessThanOrEqual(outer.right + 0.02);
    expect(inner.top, `${what} top`).toBeGreaterThanOrEqual(outer.top - 0.02);
    expect(inner.bottom, `${what} bottom`).toBeLessThanOrEqual(outer.bottom + 0.02);
  };

  const intersects = (a: Box, b: Box): boolean =>
    a.left < b.right && b.left < a.right && a.top < b.bottom && b.top < a.bottom;

  /** Every token-tier id's glyph run lies inside its chip's padding box: whole, never clipped. */
  const expectIdsInside = (board: MountedBoard, ids: readonly string[]): void => {
    const shown = cells(board, '[data-tier="token"] .bd-id');
    expect(shown.map((id) => id.textContent)).toEqual(ids);
    for (const id of shown) {
      const chip = id.closest('.bd-chip');
      if (chip === null) throw new Error(`id ${id.textContent} outside a chip`);
      expectWithin(glyphRun(id), paddingBox(chip), id.textContent);
    }
  };

  const shownIds = (board: MountedBoard): string[] =>
    cells(board, '[data-tier="token"] .bd-id').map((id) => id.textContent);

  /** Mounts `app` at cell size `size` (the AppState applies the stored size, M, when it is made: set it after). */
  async function showAt(app: AppState, size: 'S' | 'M' | 'L', width?: number): Promise<MountedBoard> {
    document.documentElement.dataset['cellSize'] = size;
    mounted = await mountBoard(app, width);
    return mounted;
  }

  /**
   * K + 1 ASCII bytes in one-byte tokens (`ids`, then filler ids) but the last, a 2-byte token (`last`) that the row end
   * cuts into two 1-column fragments, each with a continuation mark under its id.
   */
  async function rowEndSplit(k: number, ids: readonly number[], last: number): Promise<TokenizationResult> {
    const { buildResult } = await import('@tsbs/core/model/build-result');
    const { analyzeText } = await import('@tsbs/core/text/analyze');
    const single = Array.from({ length: k - 1 }, (_, i) => ids[i] ?? 10 + i);
    return buildResult({
      tokenizer: 'openai-o200k_base',
      family: 'bytelevel-bpe',
      analysis: analyzeText('a'.repeat(k + 1)),
      chunks: { byteStart: [0, k + 1], kind: [0] },
      tokens: {
        id: [...single, last],
        byteStart: [...single.map((_, i) => i), k - 1, k + 1],
        kind: Array.from({ length: k }, () => 0),
      },
      timeline: null,
    });
  }

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
    const k = expectedColumns(1440);
    const board = await show(await rowEndSplit(k, [7, 4321], 654321));
    await digitsLoaded();
    expect(board.grid.getAttribute('aria-colcount')).toBe(String(k));
    expectIdsInside(board, shownIds(board));
    const room = cellPx() - 6; // 1 px inset, 1 px border and a stacked chip's 1 px padding on each side, no marks beside
    const style = (index: number): CSSStyleDeclaration =>
      getComputedStyle(cells(board, `[data-tier="token"][data-index="${String(index)}"] .bd-id`)[0] ?? board.grid);
    const stretch = (index: number): number => px(style(index).getPropertyValue('font-stretch'));
    const size = (index: number): number => px(style(index).fontSize);
    // w = 262.2 · room / (digits · em) − 50, clamped to the axis; below 62.5 % the size gives way instead.
    expect(stretch(0)).toBe(100);
    expect(size(0)).toBe(12);
    expect(stretch(1)).toBeCloseTo(Math.min(100, (262.2 * room) / (4 * 12) - 50), 0);
    expect(stretch(1)).toBeLessThan(100);
    expect(stretch(1)).toBeGreaterThan(62.5);
    expect(size(1)).toBe(12);
    expect(stretch(k - 1)).toBe(62.5); // the cut 6-digit token: its continuation mark takes the line under it
    expect(size(k - 1)).toBeCloseTo(room / (6 * 0.429), 1);
  });

  it('sets a bare 1-column 6-digit id on two full-size lines (Gemma 4 “I’m here” at 1280 px, cell M)', async () => {
    await page.viewport(1280, 800);
    let board = await show(fixtureResult('google-gemma4', 'en-contraction-code'));
    await digitsLoaded();
    expect(cellPx()).toBe(30);
    for (const [index, lines] of [
      [0, ['236', '777']],
      [1, ['236', '789']],
      [2, ['236', '757']],
    ] as const) {
      const chip = cell(board, `[data-tier="token"][data-index="${String(index)}"]`);
      expect(chip.getAttribute('aria-colspan')).toBe('1');
      const vis = chip.querySelector('.bd-chip') ?? chip;
      expect(vis.querySelector('.bd-chip-line')).toBeNull(); // nothing else shares the chip
      const id = vis.querySelector<HTMLElement>('.bd-id.two');
      if (id === null) throw new Error(`chip ${String(index)} has no two-line id`);
      const [upper, lower] = [...id.children];
      expect([upper?.textContent, lower?.textContent]).toEqual(lines);
      expect(getComputedStyle(id).fontSize).toBe('12px');
      expect(fontStretch(id)).toBe('100%');
      for (const line of [upper, lower])
        if (line !== undefined) expectWithin(glyphRun(line), paddingBox(vis), lines[0]);
      expect(lower?.getBoundingClientRect().top).toBeGreaterThanOrEqual(
        (upper?.getBoundingClientRect().bottom ?? 0) - 0.02,
      );
    }
    expectIdsInside(board, shownIds(board));
    mounted?.destroy();
    // cl100k 66285: 2 columns at the 32 px cell, a hatched end: 54 px of room for 5 digits needs no narrowing.
    await page.viewport(1440, 900);
    board = await show(fixtureResult('openai-cl100k_base', 'zh-tw-tainan'));
    await digitsLoaded();
    expect(cellPx()).toBe(32);
    const wide = cell(board, '[data-tier="token"][data-index="1"] .bd-id');
    expect(wide.textContent).toBe('66285');
    expect(fontStretch(wide)).toBe('100%');
    expect(getComputedStyle(wide).fontSize).toBe('12px');
  });

  for (const [width, size, cellSize, idSize] of [
    [1280, 'S', 27, 8.16],
    [1280, 'M', 30, 9.32],
    [1440, 'M', 32, 10.1],
  ] as const) {
    it(`keeps one line for a 1-column 6-digit id with a mark under it: ${String(idSize)} px at the ${String(cellSize)} px cell`, async () => {
      await page.viewport(width, 900);
      document.documentElement.dataset['cellSize'] = size;
      expect(cellPx()).toBe(cellSize);
      const k = expectedColumns(width);
      const board = await showAt(appWith(await rowEndSplit(k, [], 654321)), size);
      await digitsLoaded();
      expect(board.grid.getAttribute('aria-colcount')).toBe(String(k));
      const fragments = cells(board, `[data-tier="token"][data-index="${String(k - 1)}"]`);
      expect(fragments.map((fragment) => fragment.getAttribute('aria-colspan'))).toEqual(['1', '1']);
      for (const fragment of fragments) {
        const vis = fragment.querySelector('.bd-chip') ?? fragment;
        const id = vis.querySelector('.bd-id') ?? vis;
        expect(vis.classList.contains('stacked')).toBe(true);
        expect([getComputedStyle(vis).paddingLeft, getComputedStyle(vis).paddingRight]).toEqual(['1px', '1px']);
        expect(id.classList.contains('two')).toBe(false);
        expect(fontStretch(id)).toBe('62.5%');
        expect(px(getComputedStyle(id).fontSize)).toBeCloseTo(idSize, 1);
        expectWithin(glyphRun(id), paddingBox(vis), '654321');
        expect(vis.querySelector('.bd-chip-line svg.bd-icon')).not.toBeNull();
      }
    });
  }

  it('stacks a narrow chip’s marks on one line under its id, padded 1 px and 5 px at a hatched edge (cl100k 96, 66285)', async () => {
    await page.viewport(1440, 900);
    const board = await show(fixtureResult('openai-cl100k_base', 'zh-tw-tainan'));
    await digitsLoaded();
    const chip = cell(board, '[data-tier="token"][data-index="2"]');
    expect(chip.getAttribute('aria-colspan')).toBe('1');
    const vis = chip.querySelector('.bd-chip') ?? chip;
    expect(vis.classList.contains('stacked')).toBe(true);
    expect([getComputedStyle(vis).paddingLeft, getComputedStyle(vis).paddingRight]).toEqual(['5px', '1px']);
    const id = vis.querySelector('.bd-id')?.getBoundingClientRect();
    const mark = vis.querySelector('.bd-chip-line > svg.bd-icon')?.getBoundingClientRect();
    expect(mark?.top ?? 0).toBeGreaterThanOrEqual(id?.bottom ?? Number.POSITIVE_INFINITY);
    expect(mark?.bottom ?? Number.POSITIVE_INFINITY).toBeLessThanOrEqual(paddingBox(vis).bottom);
    const wide = cell(board, '[data-tier="token"][data-index="1"] .bd-chip');
    expect([getComputedStyle(wide).paddingLeft, getComputedStyle(wide).paddingRight]).toEqual(['1px', '5px']);
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
    expectIdsInside(board, shownIds(board));
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
      const hex = part.querySelector('.bd-chip-line > .bd-part-text')?.getBoundingClientRect();
      expect(hex?.top ?? 0).toBeGreaterThanOrEqual(id?.bottom ?? Number.POSITIVE_INFINITY);
      expect(part.getAttribute('aria-label')).toMatch(/^part \d+ of \d+, id \d+, [0-9A-F]{2}/);
    }
    expectIdsInside(
      board,
      parts.map((part) => part.querySelector('.bd-id')?.textContent ?? ''),
    );
  });

  for (const [width, size, cellSize] of [
    [768, 'S', 29],
    [1280, 'M', 30],
  ] as const) {
    it(`keeps a 1-column part fragment’s mark and hex on one line under its id at the ${String(cellSize)} px cell`, async () => {
      await page.viewport(width, 900);
      document.documentElement.dataset['cellSize'] = size;
      expect(cellPx()).toBe(cellSize);
      // K = 8: the row end cuts “ 台” (50922) after its space, a 1-column fragment carrying the continues mark.
      const frame = 2 * 16 + (width >= 1024 ? 320 : 0) + 8 * cellSize;
      const board = await showAt(
        appWith(fixtureResult('openai-o200k_base', 'mixed-hello-taiwan-tokyo'), { stage: 5 }),
        size,
        frame,
      );
      await digitsLoaded();
      expect(board.grid.getAttribute('aria-colcount')).toBe('8');
      const fragment = cells(board, '[data-tier="token"][data-variant="part"]').find(
        (part) => part.getAttribute('aria-colspan') === '1' && part.querySelector('.bd-chip.cont-end') !== null,
      );
      const vis = fragment?.querySelector('.bd-chip') ?? null;
      const line = vis?.querySelector('.bd-chip-line') ?? null;
      if (vis === null || line === null) throw new Error('no 1-column part fragment with a continues mark');
      expect(vis.querySelector('.bd-id')?.textContent).toBe('50922');
      expect(line.querySelector('.bd-part-text')?.textContent).toBe('20');
      expect(line.querySelector('svg.bd-icon')).not.toBeNull();
      // One line under the id, inside the chip: no third line overflowing the bottom.
      const lineBox = line.getBoundingClientRect();
      expectWithin(lineBox, contentBox(vis), 'line');
      expect(lineBox.top).toBeGreaterThanOrEqual(
        (vis.querySelector('.bd-id')?.getBoundingClientRect().bottom ?? 0) - 0.02,
      );
      for (const child of line.children)
        expect(child.getBoundingClientRect().bottom).toBeLessThanOrEqual(lineBox.bottom + 0.02);
    });
  }

  it('draws the stop-5 star only on a just-merged part’s fragments of two or more columns, clear of the id (o200k, 360 px, L)', async () => {
    await page.viewport(360, 780);
    const result = fixtureResult('openai-o200k_base', 'mixed-hello-taiwan-tokyo');
    const app = appWith(result, { stage: 5, step: 1 });
    const board = await showAt(app, 'L');
    await digitsLoaded();
    expect(board.grid.getAttribute('aria-colcount')).toBe('8');
    // Step through the merges to the first whose part the row end cuts into a 1-column fragment and a wider one (step 4:
    // 1 | 3 columns), and mark it as the director does at stop 5 (data-just-merged on every fragment of the merged part).
    const view = new TokenizationView(result);
    let merged: HTMLElement[] = [];
    for (let step = 1; step <= view.stepCount && merged.length === 0; step++) {
      app.step = step;
      flushSync();
      await frames(1);
      const parts = cells(board, `[data-tier="token"][data-index="${String(view.partsAt(step).justMerged)}"]`);
      const spans = parts.map((part) => Number(part.getAttribute('aria-colspan')));
      if (spans.includes(1) && spans.some((span) => span >= 2)) merged = parts;
    }
    for (const part of merged) part.dataset['justMerged'] = '';
    await frames(1);
    const narrow = merged.find((part) => part.getAttribute('aria-colspan') === '1');
    const wide = merged.find((part) => Number(part.getAttribute('aria-colspan')) >= 2);
    const vis = wide?.querySelector('.bd-chip') ?? null;
    const id = vis?.querySelector('.bd-id') ?? null;
    const line = vis?.querySelector('.bd-chip-line') ?? null;
    const narrowVis = narrow?.querySelector('.bd-chip') ?? null;
    const narrowLine = narrowVis?.querySelector('.bd-chip-line') ?? null;
    if (vis === null || id === null || line === null || narrowVis === null || narrowLine === null)
      throw new Error('no just-merged part cut into a 1-column and a wider fragment');
    // The 1-column fragment draws no star and keeps its whole line (the pulse outline still marks the cell).
    expect(getComputedStyle(narrowVis, '::after').content).toBe('none');
    expect(getComputedStyle(narrowLine).paddingRight).toBe('0px');
    // The wider one carries the star, absolutely placed in the chip's padding box from its right and bottom.
    const pad = paddingBox(vis);
    const after = getComputedStyle(vis, '::after');
    expect(after.content).not.toBe('none');
    const right = pad.right - px(after.right);
    const bottom = pad.bottom - px(after.bottom);
    const star: Box = { left: right - px(after.width), right, top: bottom - px(after.height), bottom };
    expectWithin(star, pad, 'star');
    expect(intersects(star, glyphRun(id)), 'star over the id').toBe(false);
    // The hex line's content box ends before the star, so its content centres in the room left of it.
    const lineBox = line.getBoundingClientRect();
    expect(lineBox.right - px(getComputedStyle(line).paddingRight)).toBeLessThanOrEqual(star.left);
    expectWithin(glyphRun(id), pad, 'id');
  });

  it('draws no star on just-merged byte-fallback pieces, whose <0xNN> fills their one column (Gemma 4 𰻝, stop 4)', async () => {
    await page.viewport(1440, 900);
    const board = await show(fixtureResult('google-gemma4', 'cjk-ext-g-biang'), { stage: 4 });
    const pieces = cells(board, '[data-tier="token"] .bd-chip.byte-fallback');
    expect(pieces).toHaveLength(4);
    for (const piece of pieces) if (piece.parentElement !== null) piece.parentElement.dataset['justMerged'] = '';
    await frames(1);
    for (const piece of pieces) {
      expect(piece.parentElement?.className).toMatch(/\bs1\b/);
      expect(getComputedStyle(piece, '::after').content).toBe('none');
    }
  });

  it('shows a marker’s id over ▁ and a byte-fallback chip’s over <0xNN>, no icons (Grok-1 台灣台南, 1440 px)', async () => {
    await page.viewport(1440, 900);
    const board = await show(fixtureResult('xai-grok1', 'zh-tw-tainan'));
    await digitsLoaded();
    expectIdsInside(board, ['130089', '130876', '300', '198', '232', '130876', '130899']);
    const marker = cell(board, '[data-variant="marker"] .bd-chip');
    expect(marker.querySelector('svg')).toBeNull();
    expect(getComputedStyle(marker).borderTopStyle).toBe('dotted');
    expect(getComputedStyle(marker).borderTopWidth).toBe('2px');
    const markerId = marker.querySelector('.bd-id');
    const markerText = marker.querySelector('.bd-marker-text');
    expect([markerId?.textContent, markerText?.textContent]).toEqual(['130089', '▁']);
    const pad = paddingBox(marker);
    expectWithin(markerText?.getBoundingClientRect() ?? pad, pad, '▁');
    expect(markerText?.getBoundingClientRect().top).toBeGreaterThanOrEqual(
      (markerId?.getBoundingClientRect().bottom ?? 0) - 0.02,
    );
    const bytes = cells(board, '[data-tier="token"] .bd-chip.byte-fallback');
    expect(
      bytes.map((chip) => [chip.querySelector('.bd-id')?.textContent, chip.querySelector('.bd-piece')?.textContent]),
    ).toEqual([
      ['300', '<0xE7>'],
      ['198', '<0x81>'],
      ['232', '<0xA3>'],
    ]);
    for (const chip of bytes) {
      expect(chip.querySelector('svg')).toBeNull();
      expect(getComputedStyle(chip.querySelector('.bd-id') ?? chip).fontSize).toBe('12px');
      expect(chip.querySelector('.bd-piece')?.getBoundingClientRect().top).toBeGreaterThanOrEqual(
        (chip.querySelector('.bd-id')?.getBoundingClientRect().bottom ?? 0) - 0.02,
      );
    }
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

  // PA-17 puts ids over BOS and over byte-fallback pieces: their names must still contain what the chips show, in order.
  for (const stage of [4, 6] as const) {
    it(`is axe clean with ids over BOS and byte-fallback pieces: google-gemma4 cjk-ext-g-biang + BOS at stop ${String(stage)}`, async () => {
      await page.viewport(1440, 900);
      const board = await show(fixtureResult('google-gemma4', 'cjk-ext-g-biang', { addBos: true }), { stage });
      expect(cells(board, '[data-tier="token"] .bd-piece')).toHaveLength(4);
      const results = await axe.run(board.target, {
        runOnly: { type: 'tag', values: ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa'] },
      });
      expect(results.violations.map((v) => `${v.id}: ${v.nodes.map((n) => n.target.join(' ')).join(', ')}`)).toEqual(
        [],
      );
    });
  }
});
