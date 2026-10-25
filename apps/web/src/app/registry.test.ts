/**
 * The shell's registry view (registry.ts, registry-details.ts) over WP04's data and WP03's examples index: the facts the shell depends on,
 * asserted against the committed fixtures and the oracle manifest (`registry:check` enforces the full 03 §B.7 rules).
 */
import type { TokenizerId } from '@tsbs/core';
import { describe, expect, it } from 'vitest';
import { MANIFEST_ASSETS, SHIPPING_FIXTURES } from './fixtures.test-helper.ts';
import { LICENCE_TAGS, MODELS } from './registry-details.ts';
import { CHIP_SPLITS, DEFAULT_TOKENIZER, EXAMPLES, notice, noticeText, TOKENIZERS } from './registry.ts';

describe('registry view (03 §B.7 rules)', () => {
  it('lists the nine shipped tokenizers with exactly one default (o200k_base)', () => {
    expect(TOKENIZERS).toHaveLength(9);
    expect(TOKENIZERS.filter((entry) => entry.default === true).map((entry) => entry.id)).toEqual([
      'openai-o200k_base',
    ]);
    expect(DEFAULT_TOKENIZER).toBe('openai-o200k_base');
  });

  it('maps every manifest ship asset to exactly one tokenizer and vice versa', () => {
    const shipped = MANIFEST_ASSETS.filter((asset) => asset.shipIntent === 'ship').map((asset) => asset.id);
    expect(shipped).toHaveLength(9);
    expect(TOKENIZERS.map((entry) => entry.asset.manifestId).sort()).toEqual([...shipped].sort());
  });

  it('has a licence tag for every tokenizer’s licence key', () => {
    for (const entry of TOKENIZERS) expect(LICENCE_TAGS[entry.licence], entry.id).toBeDefined();
  });

  it('points every tokenizer at its fixture', () => {
    for (const entry of TOKENIZERS) {
      expect(entry.fixture).toBe(`fixtures/${entry.id}.json`);
      expect(SHIPPING_FIXTURES.has(entry.id), entry.id).toBe(true);
    }
  });

  it('lists the 19 chips of 05 §6 and chip.text === case.text byte-for-byte in every shipping fixture', () => {
    expect(EXAMPLES).toHaveLength(19);
    expect(EXAMPLES[0]?.fixtureCase).toBe('zh-tw-tainan');
    for (const chip of EXAMPLES) {
      for (const [tokenizer, fixture] of SHIPPING_FIXTURES) {
        const found = fixture.cases.find((fixtureCase) => fixtureCase.name === chip.fixtureCase);
        expect(found?.text, `${tokenizer} ${chip.key}`).toBe(chip.text);
      }
    }
    expect(EXAMPLES.filter((chip) => chip.label !== undefined).map((chip) => chip.key)).toEqual([
      'zh-tw-paragraph',
      'ja-paragraph',
      'en-paragraph',
    ]);
  });

  it('flags exactly the chips whose fixture result has a partial-character token', () => {
    for (const [tokenizer, fixture] of SHIPPING_FIXTURES) {
      const expected = EXAMPLES.filter((chip) =>
        fixture.cases.find((c) => c.name === chip.fixtureCase)?.tokens.some((token) => token.partial),
      ).map((chip) => chip.key);
      expect([...CHIP_SPLITS[tokenizer as TokenizerId]], tokenizer).toEqual(expected);
    }
    expect(CHIP_SPLITS['openai-cl100k_base']).toContain('zh-tw-tainan'); // 灣 = E7 81 + A3 (05 §4.1)
    expect(CHIP_SPLITS['openai-o200k_base']).not.toContain('zh-tw-tainan');
  });

  it('gives null-tokenizer model rows a live-check panel and the unavailable fidelity', () => {
    for (const row of MODELS) {
      expect(row.tokenizer === null, row.model).toBe(row.fidelity === 'unavailable');
      if (row.tokenizer === null) expect(row.byok, row.model).toBeDefined();
      expect(row.checkedOn).toMatch(/^\d{4}-\d{2}-\d{2}$/);
      expect(row.evidenceUrl).toMatch(/^https:\/\//);
    }
    for (const entry of TOKENIZERS)
      expect(
        MODELS.some((row) => row.tokenizer === entry.id && row.fidelity !== 'inferred'),
        entry.id,
      ).toBe(true);
  });

  it('has strings in all three locales for every notice a tokenizer requires; legal ones are verbatim', () => {
    const locales = ['en', 'zh-TW', 'ja'] as const;
    for (const entry of TOKENIZERS) {
      for (const key of entry.requiredNotices) {
        const found = notice(key);
        for (const locale of locales) expect(noticeText(found, locale).length, key).toBeGreaterThan(0);
        if (found.kind === 'legal')
          expect(new Set(locales.map((locale) => noticeText(found, locale))).size, key).toBe(1);
      }
    }
    expect(noticeText(notice('powered-by-xai'), 'ja')).toBe('Powered by xAI');
    expect(noticeText(notice('xai-materials-notice'), 'zh-TW')).toBe(
      'This product includes materials licensed under the xAI Community License. All rights reserved. Copyright © xAI 2026.',
    );
    expect(notice('powered-by-xai').prominent).toBe(true);
    expect(notice('built-with-meta-llama-3').prominent).toBe(true);
  });

  it('requires "Powered by xAI" for Grok-2 only and "Built with Meta Llama 3" for Llama 3 only (05 §15)', () => {
    const requiring = (key: string): string[] =>
      TOKENIZERS.filter((entry) => (entry.requiredNotices as readonly string[]).includes(key)).map((entry) => entry.id);
    expect(requiring('powered-by-xai')).toEqual(['xai-grok2']);
    expect(requiring('built-with-meta-llama-3')).toEqual(['meta-llama3']);
  });
});
