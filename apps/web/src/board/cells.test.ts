/**
 * Render descriptors for the 05 §4.1 hard cases, from fixture results (and a synthetic special-token match): sliced char
 * backgrounds and hatched cuts, a partial token crossing a char boundary, full-column marker cells, the fused dummy
 * prefix, byte-fallback chips, USER_DEFINED locks, the SPECIAL badge, direct hits, grapheme brackets, stand-ins,
 * combining marks, the NFKC source row and the `aria-label` templates in all three locales.
 */
import { buildResult } from '@tsbs/core/model/build-result';
import { ChunkKind, TokenKind } from '@tsbs/core/model/result';
import { analyzeText } from '@tsbs/core/text/analyze';
import { describe, expect, it } from 'vitest';
import { LOCALES } from '../i18n/types.ts';
import { rowCells, type RowCells } from './cells.ts';
import { boardContext, caseResult, type ContextOptions } from './fixture-results.test-helper.ts';
import type { TokenizationResult } from '@tsbs/core';

function cellsOf(result: TokenizationResult, options: ContextOptions): RowCells[] {
  const ctx = boardContext(result, options);
  return ctx.units.rows.map((row) => rowCells(row, ctx));
}

describe('partial-character token (cl100k 灣 = E7 81 + A3)', () => {
  const [row] = cellsOf(caseResult('openai-cl100k_base', 'zh-tw-tainan'), { K: 34 });

  it('slices 灣’s background per byte column into the owning tokens’ tints with a cut before A3', () => {
    const wan = row?.chars[1];
    expect(wan?.slices).toEqual([
      { tint: 1, cut: false },
      { tint: 1, cut: false },
      { tint: 2, cut: true },
    ]);
    expect(wan?.label).toBe('character 2 of 4: 灣, U+7063, 3 bytes, split across 2 tokens');
    expect(row?.bytes[5]).toMatchObject({ hex: 'A3', cut: true, lead: false });
    expect(row?.bytes[5]?.label).toContain('token boundary inside this character');
  });

  it('hatches the cut edges of both chips, labels them partial and counts their id digits (PA-17)', () => {
    const [, first, second] = row?.tokens ?? [];
    expect(first).toMatchObject({ id: 66285, digits: 5, hatchStart: false, hatchEnd: true, partial: true, span: 2 });
    expect(second).toMatchObject({ id: 96, digits: 2, hatchStart: true, hatchEnd: false, partial: true, span: 1 });
    expect(first?.label).toBe(
      'token 2 of 5, id 66285, 2 bytes, partial: first 2 of 3 bytes of 灣, splits a character on this tokenizer',
    );
    // Every id sits inside its chip: the row has no id line (PA-17).
    expect(row).not.toHaveProperty('ids');
    expect(row?.tokens.map((cell) => cell.digits)).toEqual([5, 5, 2, 5, 5]);
  });

  it('labels the byte cells (05 §8 example)', () => {
    expect(row?.bytes[3]?.label).toBe(
      'byte 4 of 12: E7, decimal 231, first byte of 灣, in token 2 of 5 (id 66285, partial)',
    );
  });
});

describe('partial token crossing a char boundary (Grok-2 4242 = ー + 2 bytes of メ)', () => {
  const rows = cellsOf(caseResult('xai-grok2', 'ja-shibuya-ramen'), { K: 34 });

  it('is one chip over five columns with only its right edge hatched', () => {
    const chip = rows[0]?.tokens.find((cell) => cell.id === 4242);
    expect(chip).toMatchObject({ span: 5, hatchStart: false, hatchEnd: true, partial: true, digits: 4 });
    expect(chip?.label).toContain('partial: ー, first 2 of 3 bytes of メ');
    expect(rows.map((row) => row.chars.length)).toEqual([11, 3]);
  });
});

describe('zero-width tokens get full marker columns (AD-25)', () => {
  it('Grok-1 dummy prefix: a marker cell at column 0 with its label', () => {
    const [row] = cellsOf(caseResult('xai-grok1', 'zh-tw-tainan'), { K: 9 });
    const marker = row?.tokens[0];
    expect(marker).toMatchObject({ variant: 'marker', marker: 'dummy', markerText: '▁', col: 0, span: 1 });
    expect(marker?.label).toBe('dummy prefix, 0 bytes, id 130089');
    expect(row?.chars[0]?.col).toBe(1);
  });

  it('Grok-1 + addBos: two markers before code point 0', () => {
    const [row] = cellsOf(caseResult('xai-grok1', 'zh-tw-tainan', { addBos: true }), { K: 9 });
    expect(row?.tokens.slice(0, 2).map((cell) => [cell.marker, cell.col])).toEqual([
      ['bos', 0],
      ['dummy', 1],
    ]);
    expect(row?.tokens[0]?.label).toBe('BOS, beginning-of-sequence token, 0 bytes, id 1');
  });

  it('Llama 3 + addBos on empty text: a trailing marker and an empty char tier', () => {
    const rows = cellsOf(caseResult('meta-llama3', 'empty', { addBos: true }), { K: 9 });
    expect(rows).toHaveLength(1);
    expect(rows[0]?.chars).toEqual([]);
    expect(rows[0]?.tokens).toMatchObject([{ variant: 'marker', marker: 'bos', col: 0 }]);
  });
});

describe('spm specifics', () => {
  it('a fused dummy prefix (`▁Hello`) is said and shown', () => {
    const [row] = cellsOf(caseResult('xai-grok1', 'en-hello-world'), { K: 34, fusedDummy: true });
    expect(row?.tokens[0]?.label).toContain('includes the dummy prefix (0 bytes)');
    expect(row?.tokens[0]?.text).toBe('▁Hello');
    expect(row?.tokens[0]?.label).toContain(', ▁ escaped space Hello, ');
    expect(row?.tokens[2]?.text).toBe('▁world');
  });

  it('byte-fallback pieces are one chip per byte with the <0xF0> label (Gemma 4 𰻝 already shattered at stop 4)', () => {
    const [row] = cellsOf(caseResult('google-gemma4', 'cjk-ext-g-biang'), { K: 9, stage: 4 });
    expect(row?.tokens.map((cell) => cell.bytePiece)).toEqual(['<0xF0>', '<0xB0>', '<0xBB>', '<0x9D>']);
    expect(row?.tokens.every((cell) => cell.variant === 'part' && !cell.hatchStart && !cell.hatchEnd)).toBe(true);
    const [final] = cellsOf(caseResult('google-gemma2', 'cjk-ext-g-biang'), { K: 9 });
    expect(final?.tokens[0]?.label).toContain('byte-fallback piece <0xF0>');
  });

  it('USER_DEFINED symbols are locked (Grok-1 digits, Gemma 2 <start_of_turn>)', () => {
    const [row] = cellsOf(caseResult('xai-grok1', 'zh-date'), { K: 34 });
    const digits = row?.tokens.filter((cell) => cell.userDefined).map((cell) => cell.id);
    expect(digits).toEqual([16, 14, 16, 18, 15, 14]);
    expect(row?.tokens[1]?.label).toContain('pre-matched symbol, never merges');
    const [gemma] = cellsOf(caseResult('google-gemma2', 'special-start-of-turn'), { K: 34 });
    expect(gemma?.tokens[0]).toMatchObject({ userDefined: true, id: 106 });
  });
});

describe('special-token match, direct hits, graphemes, stand-ins, combining marks', () => {
  it('a matched special gets the SPECIAL badge flag', () => {
    const analysis = analyzeText('<|endoftext|>hi');
    const result = buildResult({
      tokenizer: 'openai-o200k_base',
      family: 'bytelevel-bpe',
      options: { specialTokens: 'match' },
      analysis,
      chunks: { byteStart: [0, 13, 15], kind: [ChunkKind.SpecialString, ChunkKind.Regex] },
      tokens: { id: [199999, 3686], byteStart: [0, 13, 15], kind: [TokenKind.Special, TokenKind.Normal] },
      timeline: null,
    });
    const [row] = cellsOf(result, { K: 34 });
    expect(row?.tokens[0]).toMatchObject({ special: true, id: 199999 });
    expect(row?.tokens[0]?.label).toContain('special token');
    expect(row?.tokens[1]?.special).toBe(false);
  });

  it('a direct-hit chunk shows “no merges” at stop 5 and marks its chip', () => {
    const result = caseResult('openai-o200k_base', 'en-hello-world');
    const [replay] = cellsOf(result, { K: 34, stage: 5, step: 0 });
    expect(replay?.chunks[0]?.text).toBe('chunk 1 · no merges');
    expect(replay?.chunks[0]?.label).toBe('chunk 1 · no merges, chunk 1 of 4, 5 bytes');
    const [final] = cellsOf(result, { K: 34 });
    expect(final?.tokens[0]?.directHit).toBe(true);
  });

  it('brackets a grapheme cluster of five code points and shows ZWJ stand-ins', () => {
    const [row] = cellsOf(caseResult('openai-o200k_base', 'emoji-family-zwj'), { K: 34 });
    expect(row?.brackets).toEqual([{ key: 0, col: 0, span: 18, first: true, last: true }]);
    expect(row?.chars[1]).toMatchObject({ glyph: 'ZWJ', standIn: true });
    expect(row?.chars[1]?.label).toContain('zero-width joiner');
    expect(row?.tokens.filter((cell) => cell.partial)).toHaveLength(6);
  });

  it('draws whitespace stand-ins and names them', () => {
    const [tab] = cellsOf(caseResult('openai-o200k_base', 'tab-between'), { K: 34 });
    expect(tab?.chars[1]).toMatchObject({ glyph: '⇥', standIn: true });
    expect(tab?.chars[1]?.label).toBe('character 2 of 3: tab, U+0009, 1 byte');
    const [space] = cellsOf(caseResult('openai-o200k_base', 'en-hello-world'), { K: 34 });
    expect(space?.chars[6]?.glyph).toBe('␠');
  });

  it('chip text shows the char tier’s stand-ins (ZWJ, BOM, ⟨U+0085⟩) and the label names each glyph', () => {
    // One 10-byte token (≥ 4 columns, so its text is shown): a ZWJ b BOM NEL.
    const text = 'a\u200Db\uFEFF\u0085';
    const analysis = analyzeText(text);
    const result = buildResult({
      tokenizer: 'openai-o200k_base',
      family: 'bytelevel-bpe',
      analysis,
      chunks: { byteStart: [0, 10], kind: [ChunkKind.Regex] },
      tokens: { id: [4242], byteStart: [0, 10], kind: [TokenKind.Normal] },
      timeline: null,
    });
    const [row] = cellsOf(result, { K: 34 });
    expect(row?.chars.map((cell) => cell.glyph)).toEqual(['a', 'ZWJ', 'b', 'BOM', '⟨U+0085⟩']);
    const chip = row?.tokens[0];
    expect(chip).toMatchObject({ span: 10, text: 'aZWJbBOM⟨U+0085⟩' });
    expect(chip?.label).toBe(
      'token 1 of 1, id 4242, a ZWJ zero-width joiner b BOM byte order mark ⟨U+0085⟩ control character U+0085, 10 bytes',
    );
    const [hello] = cellsOf(caseResult('openai-o200k_base', 'en-hello-world'), { K: 34 });
    const world = hello?.tokens.find((cell) => cell.text === '␠world');
    expect(world?.label).toContain(', ␠ space world, ');
  });

  it('draws combining marks and variation selectors on a dotted circle', () => {
    const [kana] = cellsOf(caseResult('openai-o200k_base', 'katakana-decomposed'), { K: 34 });
    expect(kana?.chars[1]).toMatchObject({ glyph: '◌゙', combining: true });
    expect(kana?.chars[1]?.label).toBe(
      'character 2 of 2: combining mark U+3099 attached to カ, 3 bytes, split across 2 tokens',
    );
    const [heart] = cellsOf(caseResult('openai-o200k_base', 'emoji-heart-vs16'), { K: 34 });
    expect(heart?.chars[1]?.label).toContain('variation selector U+FE0F attached to ❤');
  });
});

describe('NFKC normalized-text row (Claude legacy)', () => {
  it('underlines changed runs and says where each char came from', () => {
    const [row] = cellsOf(caseResult('anthropic-claude-legacy', 'halfwidth-katakana-dakuten', { normalize: 'NFKC' }), {
      K: 34,
    });
    expect(row?.sources).toEqual([{ key: 0, col: 0, span: 3, text: 'ﾀﾞ', changed: true }]);
    expect(row?.chars[0]?.label).toContain('normalized from ﾀﾞ');
    const [latin] = cellsOf(caseResult('anthropic-claude-legacy', 'fullwidth-latin', { normalize: 'NFKC' }), { K: 64 });
    // fromFixtureCase without the Unicode tables builds one coarse run for the whole text (exact, 03 §B.4).
    expect(latin?.sources).toEqual([
      { key: 0, col: 0, span: 16, text: 'ｆｕｌｌｗｉｄｔｈ ＡＢＣ１２３', changed: true },
    ]);
  });
});

describe('fragments of a span over rows (05 §8)', () => {
  it('reference one visually hidden description per fragment, frag-<tier>-<spanId>[-part]', () => {
    const rows = cellsOf(caseResult('openai-o200k_base', 'mixed-hello-taiwan-tokyo'), { K: 9 });
    const first = rows[1]?.tokens.find((cell) => cell.index === 4);
    const second = rows[2]?.tokens.find((cell) => cell.index === 4);
    expect(first).toMatchObject({ first: true, last: false, describedBy: 'frag-token-4' });
    expect(second).toMatchObject({ first: false, last: true, describedBy: 'frag-token-4-2' });
    expect(rows[1]?.descriptions).toContainEqual({
      id: 'frag-token-4',
      text: 'token 5, continued (part 1 of 2), continues on the next row',
    });
    expect(rows[2]?.descriptions).toContainEqual({
      id: 'frag-token-4-2',
      text: 'token 5, continued (part 2 of 2), continued from the previous row',
    });
  });

  it('left-packs uniform char boxes at stops 1–2 (AD-17)', () => {
    const [row] = cellsOf(caseResult('openai-o200k_base', 'zh-tw-tainan'), { K: 34, stage: 1 });
    expect(row?.chars.map((cell) => [cell.dx, cell.w])).toEqual([
      [0, 1],
      [-2, 1],
      [-4, 1],
      [-6, 1],
    ]);
    expect(row?.chars[0]?.uLabel).toBeNull();
    const [stage3] = cellsOf(caseResult('openai-o200k_base', 'zh-tw-tainan'), { K: 34, stage: 3 });
    expect(stage3?.chars.map((cell) => [cell.dx, cell.w, cell.uLabel])).toEqual([
      [0, 3, 'U+53F0'],
      [0, 3, 'U+7063'],
      [0, 3, 'U+53F0'],
      [0, 3, 'U+5357'],
    ]);
  });
});

describe('aria-label templates render in all three locales', () => {
  for (const locale of LOCALES) {
    it(`has no leftover placeholders in ${locale}`, () => {
      for (const [tokenizer, name] of [
        ['openai-cl100k_base', 'zh-tw-tainan'],
        ['xai-grok1', 'zh-tw-tainan'],
        ['xai-grok2', 'ja-shibuya-ramen'],
        ['openai-o200k_base', 'emoji-family-zwj'],
      ] as const) {
        for (const stage of [5, 6] as const) {
          for (const row of cellsOf(caseResult(tokenizer, name), { K: 9, stage, locale })) {
            const labels = [
              ...row.chars.map((cell) => cell.label),
              ...row.bytes.map((cell) => cell.label),
              ...row.chunks.map((cell) => cell.label),
              ...row.tokens.map((cell) => cell.label),
              ...row.descriptions.map((description) => description.text),
            ];
            for (const label of labels) {
              expect(label.length, `${locale} ${tokenizer} ${name}`).toBeGreaterThan(0);
              expect(label).not.toMatch(/[{}]/);
            }
          }
        }
      }
    });
  }
});
