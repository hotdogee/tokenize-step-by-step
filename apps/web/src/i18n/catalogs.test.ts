/**
 * The 06 §1 i18n gate, for the shell catalogs (en.ts, zh-TW.ts, ja.ts) and the About-page catalogs (about/*.ts):
 * catalogs complete (same keys in every locale, no extra keys), named placeholders only and the same placeholders in
 * every locale, every template rendered in all three locales with sample params (no leftover `{…}`), no unused key, and
 * the 05 §10 glossary.
 */
import { describe, expect, it } from 'vitest';
import { ABOUT_CATALOGS, translateAbout } from './about/t.ts';
import type { AboutMessageKey } from './about/en.ts';
import type { MessageKey } from './en.ts';
import { RESERVED_KEYS } from './reserved.ts';
import { CATALOGS, placeholdersOf, translate } from './t.ts';
import { LOCALES, type Locale, type Message, type Params } from './types.ts';

interface CatalogSet {
  readonly name: string;
  readonly catalogs: Readonly<Record<Locale, Readonly<Record<string, Message>>>>;
  readonly render: (locale: Locale, key: string, params: Params) => string;
}

const SETS: readonly CatalogSet[] = [
  { name: 'shell', catalogs: CATALOGS, render: (l, k, p) => translate(l, k as MessageKey, p) },
  { name: 'about', catalogs: ABOUT_CATALOGS, render: (l, k, p) => translateAbout(l, k as AboutMessageKey, p) },
];

/** Sample values per placeholder name; `n` is numeric so plural forms are exercised. */
function sampleParams(message: Message): Record<string, string | number> {
  const params: Record<string, string | number> = {};
  for (const name of placeholdersOf(message)) params[name] = name === 'n' ? 2 : `‹${name}›`;
  return params;
}

const templatesOf = (message: Message): string[] => (typeof message === 'string' ? [message] : Object.values(message));

for (const set of SETS) {
  const en = set.catalogs.en;
  const keys = Object.keys(en);

  describe(`${set.name} catalogs: completeness`, () => {
    it('has the same keys in every locale (no missing, no extra)', () => {
      for (const locale of LOCALES) expect(Object.keys(set.catalogs[locale]).sort(), locale).toEqual([...keys].sort());
    });

    it('uses the same named placeholders in every locale, never positional ones', () => {
      for (const key of keys) {
        const expected = [...placeholdersOf(en[key] ?? '')].sort();
        for (const locale of LOCALES) {
          const message = set.catalogs[locale][key] ?? '';
          expect([...placeholdersOf(message)].sort(), `${locale} ${key}`).toEqual(expected);
          for (const template of templatesOf(message)) expect(template, `${locale} ${key}`).not.toMatch(/\{\d+\}/);
        }
      }
    });

    it('gives English plurals a "one" and "other" form and the CJK locales an "other" form', () => {
      for (const key of keys) {
        const message = en[key] ?? '';
        if (typeof message === 'string') continue;
        expect(Object.keys(message).sort(), key).toEqual(['one', 'other']);
        for (const locale of ['zh-TW', 'ja'] as const) {
          const cjk = set.catalogs[locale][key] ?? '';
          expect(typeof cjk === 'string' || Object.keys(cjk).join() === 'other', `${locale} ${key}`).toBe(true);
        }
      }
    });
  });

  describe(`${set.name} catalogs: every template renders in all three locales`, () => {
    for (const locale of LOCALES) {
      it(`renders every key in ${locale} without leftover braces`, () => {
        for (const key of keys) {
          const message = en[key] ?? '';
          const rendered = set.render(locale, key, sampleParams(message));
          expect(rendered.trim(), `${locale} ${key}`).not.toBe('');
          expect(rendered, `${locale} ${key}`).not.toMatch(/[{}]/);
          for (const name of placeholdersOf(message)) if (name !== 'n') expect(rendered).toContain(`‹${name}›`);
        }
      });
    }
  });
}

describe('catalog size (05 §10: ≈ 190 strings)', () => {
  it('has at least 190 strings per locale across the shell and About catalogs', () => {
    expect(Object.keys(CATALOGS.en).length + Object.keys(ABOUT_CATALOGS.en).length).toBeGreaterThanOrEqual(190);
  });
});

describe('no unused keys', () => {
  // Every app source file except the catalogs themselves and tests, read as raw text (no Node APIs in web tests).
  const sources = import.meta.glob<string>(
    [
      '../**/*.ts',
      '../**/*.svelte',
      '!../i18n/en.ts',
      '!../i18n/zh-TW.ts',
      '!../i18n/ja.ts',
      '!../i18n/about/en.ts',
      '!../i18n/about/zh-TW.ts',
      '!../i18n/about/ja.ts',
      '!../i18n/reserved.ts',
      '!../**/*.test.ts',
    ],
    { query: '?raw', import: 'default', eager: true },
  );
  const corpus = Object.values(sources).join('\n');

  it('scans the shell, app and about sources', () => {
    expect(Object.keys(sources).some((path) => path.endsWith('App.svelte'))).toBe(true);
    expect(Object.keys(sources).some((path) => path.endsWith('About.svelte'))).toBe(true);
  });

  it('references every non-reserved key from the app source as a string literal', () => {
    const shellUnused = (Object.keys(CATALOGS.en) as MessageKey[]).filter(
      (key) => RESERVED_KEYS[key] === undefined && !corpus.includes(`'${key}'`),
    );
    const aboutUnused = Object.keys(ABOUT_CATALOGS.en).filter((key) => !corpus.includes(`'${key}'`));
    expect([...shellUnused, ...aboutUnused]).toEqual([]);
  });

  it('keeps reserved keys out of the shell until their owner wires them', () => {
    const early = (Object.keys(RESERVED_KEYS) as MessageKey[]).filter((key) => corpus.includes(`'${key}'`));
    expect(early).toEqual([]);
  });
});

describe('glossary (05 §10)', () => {
  const all = (locale: Locale): string =>
    SETS.flatMap((set) => Object.values(set.catalogs[locale]).flatMap(templatesOf)).join('\n');

  it('never translates "token" as 標記 in zh-TW', () => {
    expect(all('zh-TW')).not.toContain('標記');
  });

  it('uses the binding terms in the counts line, stage names and badges', () => {
    const zh = (key: MessageKey): string => translate('zh-TW', key, { n: 2 });
    const jp = (key: MessageKey): string => translate('ja', key, { n: 2 });
    const pairs: Array<[MessageKey, string, string]> = [
      ['counts.codePoints', '碼位', 'コードポイント'],
      ['counts.graphemes', '字位簇', '書記素クラスタ'],
      ['counts.bytes', '位元組', 'バイト'],
      ['counts.tokens', '詞元', 'トークン'],
      ['counts.partial', '部分字元詞元', '部分文字トークン'],
      ['counts.chunks', '切塊', 'チャンク'],
      ['counts.symbols', '符號', 'シンボル'],
      ['counts.steps', '步', 'ステップ'],
      ['stage.4.chunks', '切塊', 'チャンク'],
      ['stage.5', '合併', 'マージ'],
      ['picker.title', '分詞器', 'トークナイザー'],
      ['fidelity.confirmed', '已確認', '確認済み'],
      ['fidelity.inferred', '推定', '推定'],
      ['fidelity.legacy', '舊版', 'レガシー'],
      ['a11y.marker.zeroWidthDummy', '位元組', 'バイト'],
      ['a11y.marker.byteFallback', '位元組回退', 'バイトフォールバック'],
    ];
    for (const [key, zhTerm, jaTerm] of pairs) {
      expect(zh(key), key).toContain(zhTerm);
      expect(jp(key), key).toContain(jaTerm);
    }
  });

  it('uses fullwidth punctuation in CJK sentences (no ASCII comma or full stop after CJK text)', () => {
    for (const locale of ['zh-TW', 'ja'] as const) expect(all(locale)).not.toMatch(/[぀-ヿ一-鿿][,.](?:\s|$)/m);
  });
});
