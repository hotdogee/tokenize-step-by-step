/**
 * The static first paint's server entry (PA-15, prerender.ts): what the build writes into index.html for each locale and
 * board view (the hydration itself is first-paint.browser.test.ts; the assembly plugins/first-paint.test.ts).
 */
import { describe, expect, it } from 'vitest';
import { i18n } from '../i18n/locale.svelte.ts';
import { LOCALES } from '../i18n/types.ts';
import type { FirstPaintView } from './first-paint.ts';
import { firstPaintKeep, renderFirstPaint } from './prerender.ts';

const PHONE: FirstPaintView = { k: 9, wide: false, medium: false, small: false };
const DESKTOP: FirstPaintView = { k: 12, wide: true, medium: true, small: true };

/** The markup without its board section (Board.svelte's root, followed by its component anchor). */
const withoutBoard = (markup: string): string =>
  markup.replace(/<section class="board-region[\s\S]*?<\/section>(?=<!---->)/, '<board>');

describe('renderFirstPaint', () => {
  for (const locale of LOCALES)
    it(`renders ${locale} with no inline style or script, one board laid out for the view, and nothing else view-dependent`, () => {
      const phone = renderFirstPaint(locale, PHONE);
      const desktop = renderFirstPaint(locale, DESKTOP);
      for (const markup of [phone, desktop]) {
        expect(markup).not.toMatch(/<script|<style|\sstyle=/);
        expect(markup.match(/<section class="board-region/g)).toHaveLength(1);
        expect(markup.startsWith('<!--[-->')).toBe(true);
      }
      expect(phone).toContain('data-k="9"');
      expect(phone).toContain('class="host svelte-');
      expect(phone).toMatch(/data-surface="sheet"/);
      expect(phone).not.toContain('bd-ulabel');
      expect(desktop).toContain('data-k="12"');
      expect(desktop).toMatch(/data-surface="rail"/);
      expect(desktop).toContain('bd-ulabel');
      expect(withoutBoard(phone)).toBe(withoutBoard(desktop));
      expect(phone).toContain(`>${translateIn(locale)}</label>`);
      expect(i18n.current).toBe('en'); // restored
    });

  it('renders the precomputed default example at stop 6 with the precomputed badge', () => {
    const markup = renderFirstPaint('en', DESKTOP);
    expect(markup).toContain('>台灣台南</textarea>');
    expect(markup).toContain('data-source="precomputed"');
    expect(markup).toContain('value="6" checked=""');
  });
});

describe('firstPaintKeep', () => {
  it('names the URL parameters and stored preferences that keep the first render, at their default values', () => {
    const keep = new URLSearchParams(firstPaintKeep());
    expect(Object.fromEntries(keep)).toEqual({
      t: 'openai-o200k_base',
      q: '台灣台南',
      s: '6',
      b: 'hex',
      tl: 'zh-Hant',
      'tsbs:byteView': 'hex',
      'tsbs:graphemes': 'true',
      'tsbs:cellSize': 'M',
      'tsbs:boardKeysUsed': 'false',
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
