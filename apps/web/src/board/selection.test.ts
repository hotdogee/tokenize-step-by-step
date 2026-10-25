/** Selection sync (05 §6): a textarea UTF-16 selection maps to the byte range of the code points it touches. */
import { describe, expect, it } from 'vitest';
import { caseResult } from './fixture-results.test-helper.ts';
import { byteRangeOfSelection, highlightSelection } from './selection.ts';

describe('byteRangeOfSelection', () => {
  const tainan = caseResult('openai-cl100k_base', 'zh-tw-tainan');

  it('maps whole and partly selected code points to their bytes', () => {
    expect(byteRangeOfSelection(tainan, 1, 2)).toEqual({ start: 3, end: 6 });
    expect(byteRangeOfSelection(tainan, 0, 4)).toEqual({ start: 0, end: 12 });
    expect(byteRangeOfSelection(tainan, 2, 2)).toBeNull();
  });

  it('keeps surrogate pairs whole (𰻝 is two UTF-16 units, four bytes)', () => {
    const biang = caseResult('google-gemma4', 'cjk-ext-g-biang');
    expect(byteRangeOfSelection(biang, 1, 2)).toEqual({ start: 0, end: 4 });
  });

  it('maps input offsets through the NFKC run table (ﾀﾞ → ダ)', () => {
    const dakuten = caseResult('anthropic-claude-legacy', 'halfwidth-katakana-dakuten', { normalize: 'NFKC' });
    expect(byteRangeOfSelection(dakuten, 1, 2)).toEqual({ start: 0, end: 3 });
  });

  it('is a no-op without the CSS Custom Highlight API (Node)', () => {
    expect(() => {
      highlightSelection(undefined, null);
    }).not.toThrow();
  });
});
