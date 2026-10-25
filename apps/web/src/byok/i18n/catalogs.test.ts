/**
 * The 06 §1 i18n gate for the live-check drawer's lazy catalogs (same rules as src/i18n/catalogs.test.ts for the shell):
 * same keys in every locale, the same named placeholders and never positional ones, English plurals with one/other,
 * every template rendered in all three locales with sample params (no leftover braces), every key referenced by the
 * drawer's source, the 05 §10 glossary and fullwidth punctuation in CJK sentences, and the 05 §13 sentences verbatim.
 */
import { describe, expect, it } from 'vitest';
import { placeholdersOf } from '../../i18n/t.ts';
import { LOCALES, type Message } from '../../i18n/types.ts';
import { BYOK_CATALOGS, translateByok, type ByokMessageKey } from './catalogs.ts';

const keys = Object.keys(BYOK_CATALOGS.en) as ByokMessageKey[];
const templatesOf = (message: Message): string[] => (typeof message === 'string' ? [message] : Object.values(message));

describe('drawer catalogs: completeness', () => {
  it('has the same keys in every locale', () => {
    for (const locale of LOCALES) expect(Object.keys(BYOK_CATALOGS[locale]).sort(), locale).toEqual([...keys].sort());
  });

  it('uses the same named placeholders in every locale', () => {
    for (const key of keys) {
      const expected = [...placeholdersOf(BYOK_CATALOGS.en[key])].sort();
      for (const locale of LOCALES) {
        const message = BYOK_CATALOGS[locale][key];
        expect([...placeholdersOf(message)].sort(), `${locale} ${key}`).toEqual(expected);
        for (const template of templatesOf(message)) expect(template).not.toMatch(/\{\d+\}/);
      }
    }
  });

  it('gives English plurals one/other forms and the CJK locales one form', () => {
    for (const key of keys) {
      const message = BYOK_CATALOGS.en[key];
      if (typeof message === 'string') continue;
      expect(Object.keys(message).sort(), key).toEqual(['one', 'other']);
      for (const locale of ['zh-TW', 'ja'] as const) {
        const cjk = BYOK_CATALOGS[locale][key];
        expect(typeof cjk === 'string' || Object.keys(cjk).join() === 'other', `${locale} ${key}`).toBe(true);
      }
    }
  });

  for (const locale of LOCALES) {
    it(`renders every key in ${locale}`, () => {
      for (const key of keys) {
        const params: Record<string, string | number> = {};
        for (const name of placeholdersOf(BYOK_CATALOGS.en[key])) params[name] = name === 'n' ? 2 : `‹${name}›`;
        const rendered = translateByok(locale, key, params);
        expect(rendered.trim(), `${locale} ${key}`).not.toBe('');
        expect(rendered, `${locale} ${key}`).not.toMatch(/[{}]/);
      }
    });
  }
});

describe('drawer catalogs: use, glossary and the 05 §13 sentences', () => {
  const sources = import.meta.glob<string>(['../*.ts', '../*.svelte', '!../*.test.ts'], {
    query: '?raw',
    import: 'default',
    eager: true,
  });
  const corpus = Object.values(sources).join('\n');

  it('references every key from the drawer source as a string literal', () => {
    expect(keys.filter((key) => !corpus.includes(`'${key}'`))).toEqual([]);
  });

  it('keeps the binding terms and fullwidth punctuation', () => {
    expect(translateByok('zh-TW', 'byok.xai.unaligned', { matched: 5, total: 12 })).toContain('位元組');
    expect(translateByok('ja', 'byok.xai.unaligned', { matched: 5, total: 12 })).toContain('バイト');
    expect(translateByok('zh-TW', 'byok.tokens')).toContain('詞元');
    const cjk = LOCALES.filter((l) => l !== 'en')
      .flatMap((locale) => Object.values(BYOK_CATALOGS[locale]).flatMap(templatesOf))
      .join('\n');
    expect(cjk).not.toContain('標記');
    expect(cjk).not.toMatch(/[぀-ヿ一-鿿][,.](?:\s|$)/m);
  });

  it('renders the 05 §13 output and guard sentences, counts grouped', () => {
    expect(translateByok('en', 'byok.anthropic.result', { total: 1025, frame: 8, content: 1017, legacy: 1210 })).toBe(
      'API total 1,025 (includes ≈ 8 frame tokens → ≈ 1,017 content tokens) vs legacy-vocabulary count 1,210; boundaries are not available',
    );
    expect(translateByok('en', 'byok.xai.matches')).toBe('matches Grok-2 ✓ on this text');
    expect(translateByok('en', 'byok.xai.differ', { k: 2, n: 4 })).toContain('2 of 4 boundaries differ');
    expect(translateByok('en', 'byok.xai.unaligned', { matched: 5, total: 12 })).toBe(
      'could not align the API tokens to your text (5 of 12 bytes matched)',
    );
  });
});
