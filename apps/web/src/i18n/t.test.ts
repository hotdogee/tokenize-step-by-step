import { describe, expect, it } from 'vitest';
import { LocaleStore, toLocale } from './locale.svelte.ts';
import { fill, formatCount, formatPercent, formatSize, templateOf, translate } from './t.ts';
import { resolveTextLang } from './text-lang.ts';

describe('translate()', () => {
  it('selects English plural forms with Intl.PluralRules on n', () => {
    expect(translate('en', 'counts.bytes', { n: 1 })).toBe('1 byte');
    expect(translate('en', 'counts.bytes', { n: 12 })).toBe('12 bytes');
    expect(translate('zh-TW', 'counts.bytes', { n: 12 })).toBe('12 位元組');
    expect(translate('ja', 'counts.bytes', { n: 1 })).toBe('1 バイト');
  });

  it('lets each locale reorder named placeholders', () => {
    expect(translate('en', 'a11y.progress', { phase: 'downloading', name: 'o200k_base', percent: '64%' })).toBe(
      'downloading o200k_base, 64%',
    );
    expect(translate('zh-TW', 'a11y.progress', { phase: '下載中', name: 'o200k_base', percent: '64%' })).toBe(
      'o200k_base：下載中，64%',
    );
  });

  it('leaves an unknown placeholder visible instead of hiding the bug', () => {
    expect(fill('{a} and {b}', { a: 'x' }, 'en')).toBe('x and {b}');
  });

  it('falls back to "other" without a numeric n', () => {
    expect(templateOf({ one: 'one', other: 'many' }, undefined, 'en')).toBe('many');
  });
});

describe('number rules (05 §10)', () => {
  it('groups counts, sizes and durations', () => {
    expect(translate('en', 'counts.tokens', { n: 133072 })).toBe('133,072 tokens');
    expect(translate('zh-TW', 'picker.vocab', { n: 200019 })).toBe('200,019 個詞元');
    expect(formatCount(1025, 'ja')).toBe('1,025');
  });

  it('prints ids, ranks, offsets, steps and byte values as raw ASCII digits', () => {
    expect(translate('en', 'board.cell.token', { id: 133072 })).toBe('token id 133072');
    expect(
      translate('en', 'step.sentence', {
        step: 1200,
        stepCount: 1814,
        left: 'E7',
        right: '81',
        id: 66285,
        chars: '灣',
      }),
    ).toBe('step 1200 / 1814 · E7 + 81 → 66285 (灣)');
    expect(translate('ja', 'status.pinned', { index: 2, count: 5, id: 133072 })).toContain('ID 133072');
  });

  it('formats sizes with KB = 1024 B', () => {
    expect(formatSize(908, 'en')).toBe('908 B');
    expect(formatSize(443 * 1024, 'en')).toBe('443 KB');
    expect(formatSize(1025 * 1024, 'en')).toBe('1.0 MB');
    expect(formatSize(1620 * 1024, 'zh-TW')).toBe('1.6 MB');
  });

  it('formats percentages per locale', () => {
    expect(formatPercent(0.64, 'en')).toBe('64%');
  });
});

describe('locale resolution', () => {
  it('maps tags like boot.ts does', () => {
    expect(toLocale('zh-Hant-HK')).toBe('zh-TW');
    expect(toLocale('zh')).toBe('zh-TW');
    expect(toLocale('ja-JP')).toBe('ja');
    expect(toLocale('en-GB')).toBe('en');
    expect(toLocale('fr')).toBeNull();
    expect(toLocale(null)).toBeNull();
  });

  it('switches the store at runtime without a DOM', () => {
    const store = new LocaleStore('en');
    expect(store.t('stage.3')).toBe('UTF-8 bytes');
    store.set('zh-TW');
    expect(store.t('stage.3')).toBe('UTF-8 位元組');
    store.set('ja');
    expect(store.t('stage.3')).toBe('UTF-8 バイト');
  });
});

describe('resolveTextLang (05 §10)', () => {
  it('resolves explicit choices', () => {
    expect(resolveTextLang('zh-Hant', 'abc', 'en')).toBe('zh-Hant-TW');
    expect(resolveTextLang('ja', '台灣', 'en')).toBe('ja');
    expect(resolveTextLang('en', '台灣', 'ja')).toBe('en');
  });

  it('detects kana, Hangul, Han and Latin under auto', () => {
    expect(resolveTextLang('auto', 'Hello 台灣! 東京タワー', 'zh-TW')).toBe('ja');
    expect(resolveTextLang('auto', '한국어', 'en')).toBe('ko');
    expect(resolveTextLang('auto', '台灣台南', 'en')).toBe('zh-Hant-TW');
    expect(resolveTextLang('auto', '台灣台南', 'ja')).toBe('ja');
    expect(resolveTextLang('auto', 'ㄅㄆㄇㄈ', 'en')).toBe('zh-Hant-TW');
    expect(resolveTextLang('auto', '𰻝', 'en')).toBe('zh-Hant-TW');
    expect(resolveTextLang('auto', "I'm here", 'zh-TW')).toBe('und');
    expect(resolveTextLang('auto', '👩‍👩‍👧', 'en')).toBe('und');
  });
});
