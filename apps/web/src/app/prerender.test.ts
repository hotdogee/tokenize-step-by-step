/**
 * The static first paint's server entry (PA-15, prerender.ts): what the build writes into index.html for each locale
 * (the hydration itself is first-paint.browser.test.ts; the assembly plugins/first-paint.test.ts). PA-19: the page with
 * the comparison table's five precomputed default rows and the Advanced disclosure closed, one render per locale.
 */
import { describe, expect, it } from 'vitest';
import { i18n } from '../i18n/locale.svelte.ts';
import { LOCALES } from '../i18n/types.ts';
import { firstPaintKeep, renderFirstPaint } from './prerender.ts';

describe('renderFirstPaint', () => {
  for (const locale of LOCALES)
    it(`renders ${locale} with no inline style or script, one comparison table and no board`, () => {
      const markup = renderFirstPaint(locale);
      expect(markup).not.toMatch(/<script|<style|\sstyle=/);
      expect(markup.match(/<section id="compare"/g)).toHaveLength(1);
      expect(markup).not.toContain('board-region');
      expect(markup).not.toContain('data-testid="board-grid"');
      expect(markup).toMatch(/<details class="advanced[^"]*" id="advanced"/);
      expect(markup).not.toMatch(/<details[^>]*id="advanced"[^>]*\sopen/);
      expect(markup.startsWith('<!--[-->')).toBe(true);
      expect(markup).toContain(`>${translateIn(locale)}</label>`);
      expect(i18n.current).toBe('en'); // restored
    });

  it('renders the five precomputed default rows of 台灣台南 with their counts and the precomputed badge', () => {
    const markup = renderFirstPaint('en');
    expect(markup).toContain('>台灣台南</textarea>');
    expect(markup).toMatch(/<textarea[^>]*lang="zh-Hant-TW"/);
    for (const [lab, tokenizer, tokens] of [
      ['openai', 'openai-o200k_base', 4],
      ['anthropic', 'anthropic-claude-legacy', 5],
      ['google', 'google-gemma4', 3],
      ['meta', 'meta-llama4-muse', 3],
      ['xai', 'xai-grok2', 5],
    ] as const) {
      const row = new RegExp(`data-row="${lab}" data-tokenizer="${tokenizer}"[\\s\\S]*?${String(tokens)} tokens`);
      expect(markup, lab).toMatch(row);
    }
    const table = markup.slice(markup.indexOf('<section id="compare"'), markup.indexOf('id="advanced"'));
    expect(table.match(/data-source="precomputed"/g)).toHaveLength(5);
    expect(table.match(/role="gridcell"/g)).toHaveLength(4 + 5 + 3 + 3 + 5);
    expect(table.match(/role="columnheader"/g)).toHaveLength(4 + 12);
    expect(table.match(/tabindex="0"/g)).toHaveLength(1);
    expect(markup).toContain('class="cmp k12');
  });
});

describe('firstPaintKeep', () => {
  it('names the URL parameters and stored preferences that keep the first render, at their default values', () => {
    const keep = new URLSearchParams(firstPaintKeep());
    expect(Object.fromEntries(keep)).toEqual({
      t: '',
      q: '台灣台南',
      r: '',
      s: '',
      b: 'hex',
      tl: 'auto',
      'tsbs:byteView': 'hex',
      'tsbs:cellSize': 'M',
      'tsbs:rows': '',
      'tsbs:chipText': 'false',
      'tsbs:chipHatch': 'false',
    });
  });
});

/** The input label in `locale` (the catalogs are the source; read through the store, then restored). */
function translateIn(locale: (typeof LOCALES)[number]): string {
  const previous = i18n.current;
  i18n.current = locale;
  const label = i18n.t('input.label');
  i18n.current = previous;
  return label;
}
