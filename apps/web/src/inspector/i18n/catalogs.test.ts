/**
 * The 06 §1 i18n gate for the inspector's lazy catalogs (same rules as src/i18n/catalogs.test.ts for the shell): same keys
 * in every locale, the same named placeholders and never positional ones, every template rendered in all three locales
 * with sample params (no leftover braces), every key referenced by the inspector source, the 05 §10 glossary and
 * fullwidth punctuation in CJK sentences.
 */
import { describe, expect, it } from 'vitest';
import { placeholdersOf } from '../../i18n/t.ts';
import { LOCALES, type Message } from '../../i18n/types.ts';
import { INSPECTOR_CATALOGS, translateInspector, type InspectorMessageKey } from './catalogs.ts';

const keys = Object.keys(INSPECTOR_CATALOGS.en) as InspectorMessageKey[];
const templatesOf = (message: Message): string[] => (typeof message === 'string' ? [message] : Object.values(message));

describe('inspector catalogs: completeness', () => {
  it('has the same keys in every locale', () => {
    for (const locale of LOCALES)
      expect(Object.keys(INSPECTOR_CATALOGS[locale]).sort(), locale).toEqual([...keys].sort());
  });

  it('uses the same named placeholders in every locale', () => {
    for (const key of keys) {
      const expected = [...placeholdersOf(INSPECTOR_CATALOGS.en[key])].sort();
      for (const locale of LOCALES) {
        const message = INSPECTOR_CATALOGS[locale][key];
        expect([...placeholdersOf(message)].sort(), `${locale} ${key}`).toEqual(expected);
        for (const template of templatesOf(message)) expect(template).not.toMatch(/\{\d+\}/);
      }
    }
  });

  for (const locale of LOCALES) {
    it(`renders every key in ${locale}`, () => {
      for (const key of keys) {
        const params: Record<string, string | number> = {};
        for (const name of placeholdersOf(INSPECTOR_CATALOGS.en[key])) params[name] = name === 'n' ? 2 : `‹${name}›`;
        const rendered = translateInspector(locale, key, params);
        expect(rendered.trim(), `${locale} ${key}`).not.toBe('');
        expect(rendered, `${locale} ${key}`).not.toMatch(/[{}]/);
      }
    });
  }
});

describe('inspector catalogs: use and glossary', () => {
  const sources = import.meta.glob<string>(['../*.ts', '../*.svelte', '../../board/Board.svelte', '!../*.test.ts'], {
    query: '?raw',
    import: 'default',
    eager: true,
  });
  const corpus = Object.values(sources).join('\n');

  it('references every key from the inspector source as a string literal', () => {
    expect(keys.filter((key) => !corpus.includes(`'${key}'`))).toEqual([]);
  });

  it('keeps the binding terms and fullwidth punctuation', () => {
    expect(translateInspector('zh-TW', 'inspector.kind.byte')).toContain('位元組回退');
    expect(translateInspector('ja', 'inspector.kind.byte')).toContain('バイトフォールバック');
    expect(translateInspector('zh-TW', 'inspector.section.token')).toBe('詞元');
    const cjk = LOCALES.filter((l) => l !== 'en')
      .flatMap((locale) => Object.values(INSPECTOR_CATALOGS[locale]).flatMap(templatesOf))
      .join('\n');
    expect(cjk).not.toContain('標記');
    expect(cjk).not.toMatch(/[぀-ヿ一-鿿][,.](?:\s|$)/m);
  });
});
