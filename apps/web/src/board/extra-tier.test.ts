/** The board's extra-tier hook (WP10): drawn only at stop 6 for a real result of the slot's tokenizer and exact text. */
import { describe, expect, it } from 'vitest';
import type { Component } from 'svelte';
import type { TokenizationResult } from '@tsbs/core';
import { fromFixtureCase } from '@tsbs/core/fixture/from-fixture-case';
import { SHIPPING_FIXTURES } from '../app/fixtures.test-helper.ts';
import { tokenizerEntry } from '../app/registry.ts';
import { extraTierFor, type ExtraTier, type ExtraTierProps } from './extra-tier.svelte.ts';

const component = (() => undefined) as unknown as Component<ExtraTierProps>;

function grok2(caseName: string): TokenizationResult {
  const fixture = SHIPPING_FIXTURES.get('xai-grok2');
  if (fixture === undefined) throw new Error('no Grok-2 fixture');
  return fromFixtureCase(fixture, caseName, tokenizerEntry('xai-grok2'));
}

describe('extraTierFor', () => {
  const result = grok2('zh-tw-tainan');
  const slot: ExtraTier = { tokenizer: 'xai-grok2', text: '台灣台南', component };

  it('applies at stop 6 to a result of the slot tokenizer for the same text', () => {
    expect(extraTierFor(slot, result, 6, false)).toBe(slot);
  });

  it('draws nothing at other stops, while pending, or without a slot', () => {
    for (const stage of [1, 2, 3, 4, 5] as const) expect(extraTierFor(slot, result, stage, false)).toBeNull();
    expect(extraTierFor(slot, result, 6, true)).toBeNull();
    expect(extraTierFor(null, result, 6, false)).toBeNull();
  });

  it('draws nothing for another tokenizer or another text', () => {
    expect(extraTierFor({ ...slot, tokenizer: 'openai-o200k_base' }, result, 6, false)).toBeNull();
    expect(extraTierFor({ ...slot, text: '台灣' }, result, 6, false)).toBeNull();
  });
});
