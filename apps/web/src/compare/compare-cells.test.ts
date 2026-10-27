/**
 * The comparison table's descriptors (PA-19): the header box over the input's UTF-8 in a column window, each row's chips
 * (spans, the hatched cut edges, ids and their two-line rule, the zero-width marker column, byte-fallback pieces) and
 * the labels in all three locales.
 */
import { analyzeText } from '@tsbs/core/text/analyze';
import { describe, expect, it } from 'vitest';
import { tokenizerEntry } from '../app/registry.ts';
import { caseResult, translator } from '../board/fixture-results.test-helper.ts';
import { LOCALES } from '../i18n/types.ts';
import { fusesDummy, hasLeadingMarker, headerCells, rowChips, tokenAtByte } from './compare-cells.ts';

const t = translator('en');
const TAINAN = analyzeText('台灣台南', { segmenter: null });

describe('headerCells', () => {
  it('draws the characters over their byte columns, with U+ labels, and every byte with its lead flag', () => {
    const { chars, bytes } = headerCells(TAINAN, { window: { start: 0, end: 12 }, marker: 0, t });
    expect(chars.map((cell) => [cell.col, cell.span, cell.glyph, cell.uLabel])).toEqual([
      [0, 3, '台', 'U+53F0'],
      [3, 3, '灣', 'U+7063'],
      [6, 3, '台', 'U+53F0'],
      [9, 3, '南', 'U+5357'],
    ]);
    expect(chars[1]?.label).toBe('character 2 of 4: 灣, U+7063, 3 bytes');
    expect(bytes.map((cell) => cell.hex).join(' ')).toBe('E5 8F B0 E7 81 A3 E5 8F B0 E5 8D 97');
    expect(bytes.filter((cell) => cell.lead).map((cell) => cell.col)).toEqual([0, 3, 6, 9]);
    expect(bytes[4]?.label).toBe('byte 5 of 12: 81, decimal 129, byte 2 of 3 of 灣');
  });

  it('keeps the cells of a window only (a character the window cuts stays whole, the component clips it)', () => {
    const { chars, bytes } = headerCells(TAINAN, { window: { start: 4, end: 10 }, marker: 0, t });
    expect(chars.map((cell) => cell.col)).toEqual([3, 6, 9]);
    expect(bytes.map((cell) => cell.col)).toEqual([4, 5, 6, 7, 8, 9]);
  });

  it('shifts every column by the marker column, which holds no header cell', () => {
    const { chars, bytes } = headerCells(TAINAN, { window: { start: 0, end: 13 }, marker: 1, t });
    expect(chars[0]?.col).toBe(1);
    expect(bytes[0]?.col).toBe(1);
    expect(bytes.at(-1)?.col).toBe(12);
  });

  it('draws stand-ins and leaves a 1-byte character without a U+ label', () => {
    const { chars } = headerCells(analyzeText('a b\n', { segmenter: null }), {
      window: { start: 0, end: 4 },
      marker: 0,
      t,
    });
    expect(chars.map((cell) => [cell.glyph, cell.standIn, cell.uLabel])).toEqual([
      ['a', false, null],
      ['␠', true, null],
      ['b', false, null],
      ['⏎', true, null],
    ]);
    expect(chars[1]?.label).toBe('character 2 of 4: space, U+0020, 1 byte');
  });

  it('is empty for an empty text', () => {
    expect(headerCells(analyzeText('', { segmenter: null }), { window: { start: 0, end: 0 }, marker: 0, t })).toEqual({
      chars: [],
      bytes: [],
    });
  });
});

describe('rowChips', () => {
  it('places each token over its bytes with its id, tint and name (o200k: 4 tokens)', () => {
    const chips = rowChips(caseResult('openai-o200k_base', 'zh-tw-tainan'), {
      window: { start: 0, end: 12 },
      marker: 0,
      t,
    });
    expect(chips.map((chip) => [chip.col, chip.span, chip.id, chip.tint])).toEqual([
      [0, 3, 3735, 0],
      [3, 3, 133072, 1],
      [6, 3, 3735, 2],
      [9, 3, 14609, 3],
    ]);
    expect(chips[1]?.label).toBe('token 2 of 4, id 133072, 灣, 3 bytes');
    expect(chips.every((chip) => chip.text === null && !chip.partial)).toBe(true);
  });

  it('hatches the cut edges of a partial token pair (cl100k 灣 = E7 81 + A3)', () => {
    const chips = rowChips(caseResult('openai-cl100k_base', 'zh-tw-tainan'), {
      window: { start: 0, end: 12 },
      marker: 0,
      t,
    });
    expect(chips.map((chip) => [chip.col, chip.span, chip.partial, chip.hatchStart, chip.hatchEnd])).toEqual([
      [0, 3, false, false, false],
      [3, 2, true, false, true],
      [5, 1, true, true, false],
      [6, 3, false, false, false],
      [9, 3, false, false, false],
    ]);
    expect(chips[2]?.label).toBe(
      'token 3 of 5, id 96, 1 byte, partial: last 1 of 3 bytes of 灣, splits a character on this tokenizer',
    );
  });

  it('sets a bare 1-column id of ≥ 5 digits on two lines, unless the partial mark shares the chip (PA-17)', () => {
    const gemma = rowChips(caseResult('google-gemma4', 'mixed-hello-taiwan-tokyo'), {
      window: { start: 0, end: 23 },
      marker: 0,
      t,
    });
    expect(gemma.find((chip) => chip.id === 236743)?.idLines).toEqual(['236', '743']);
    const grok1 = caseResult('xai-grok1', 'zh-tw-tainan');
    const byteFallback = rowChips(grok1, { window: { start: 0, end: 13 }, marker: 1, t }).find(
      (chip) => chip.bytePiece !== null,
    );
    expect(byteFallback).toMatchObject({ bytePiece: '<0xE7>', idLines: null, hatchStart: false, hatchEnd: false });
  });

  it('shows the text from 4 columns and names it in every label', () => {
    const chips = rowChips(caseResult('google-gemma4', 'zh-tw-tainan'), {
      window: { start: 0, end: 12 },
      marker: 0,
      t,
    });
    expect(chips.map((chip) => chip.text)).toEqual(['台灣', null, null]);
    expect(chips[1]?.label).toBe('token 2 of 3, id 237838, 台, 3 bytes');
  });

  it('puts a leading zero-width token in the marker column and shifts the rest (Grok-1’s dummy prefix)', () => {
    const grok1 = caseResult('xai-grok1', 'zh-tw-tainan');
    expect(hasLeadingMarker(grok1)).toBe(true);
    expect(hasLeadingMarker(caseResult('xai-grok2', 'zh-tw-tainan'))).toBe(false);
    const chips = rowChips(grok1, { window: { start: 0, end: 13 }, marker: 1, t });
    expect(chips[0]).toMatchObject({ col: 0, span: 1, marker: 'dummy', markerText: '▁', idLines: ['130', '089'] });
    expect(chips[0]?.label).toBe('dummy prefix, 0 bytes, id 130089');
    expect(chips[1]).toMatchObject({ col: 1, span: 3, id: 130876 });
    // Another row of the same table leaves the marker column empty and starts at column 1.
    const o200k = rowChips(caseResult('openai-o200k_base', 'zh-tw-tainan'), {
      window: { start: 0, end: 13 },
      marker: 1,
      t,
    });
    expect(o200k[0]?.col).toBe(1);
  });

  it('fuses the dummy prefix into the first piece when no bare ▁ exists (Grok-1 on Hello)', () => {
    const result = caseResult('xai-grok1', 'mixed-hello-taiwan-tokyo');
    const fusedDummy = fusesDummy(result, tokenizerEntry('xai-grok1'));
    expect(fusedDummy).toBe(true);
    const [first] = rowChips(result, { window: { start: 0, end: 20 }, marker: 0, t, fusedDummy });
    expect(first?.text).toBe('▁Hello');
    expect(first?.label).toContain('includes the dummy prefix (0 bytes)');
  });

  it('keeps the chips of a window only, a chip crossing its edges included', () => {
    const result = caseResult('openai-o200k_base', 'zh-tw-paragraph');
    const all = rowChips(result, { window: { start: 0, end: result.utf8.length }, marker: 0, t });
    const some = rowChips(result, { window: { start: 100, end: 228 }, marker: 0, t });
    expect(some.length).toBeLessThan(all.length);
    expect(some[0]?.col).toBeLessThanOrEqual(100);
    expect((some[0]?.col ?? 0) + (some[0]?.span ?? 0)).toBeGreaterThan(100);
    expect(some.at(-1)?.col).toBeLessThan(228);
    expect(some.every((chip) => chip.col + chip.span > 100 && chip.col < 228)).toBe(true);
    expect(all.filter((chip) => chip.col + chip.span > 100 && chip.col < 228)).toEqual(some);
  });

  it('names its chips in every locale', () => {
    for (const locale of LOCALES) {
      const [chip] = rowChips(caseResult('openai-o200k_base', 'zh-tw-tainan'), {
        window: { start: 0, end: 12 },
        marker: 0,
        t: translator(locale),
      });
      expect(chip?.label, locale).toContain('3735');
      expect(chip?.label, locale).toContain('台');
    }
  });
});

describe('tokenAtByte', () => {
  it('finds the token of a byte, and the marker for the marker column', () => {
    const cl100k = caseResult('openai-cl100k_base', 'zh-tw-tainan');
    expect([0, 3, 4, 5, 11].map((byte) => tokenAtByte(cl100k, byte))).toEqual([0, 1, 1, 2, 4]);
    expect(tokenAtByte(cl100k, -1)).toBe(-1);
    expect(tokenAtByte(cl100k, 12)).toBe(-1);
    expect(tokenAtByte(caseResult('xai-grok1', 'zh-tw-tainan'), -1)).toBe(0);
  });
});
