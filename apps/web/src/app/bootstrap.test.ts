/**
 * The page's first paint (AD-16): the inlined default example, expanded by `fromFixtureCase`, is the committed fixture's
 * 台灣台南 on o200k_base with its full merge timeline, and the AppState starts on it.
 */
import type { TiktokenFixture } from '@tsbs/core';
import { checkInvariants } from '@tsbs/core/model/invariants';
import { describe, expect, it } from 'vitest';
import { createAppState, defaultResult } from './bootstrap.ts';
import { DEFAULT_EXAMPLE } from './constants.ts';
import { SHIPPING_FIXTURES } from './fixtures.test-helper.ts';
import { DEFAULT_TOKENIZER, EXAMPLES, EXAMPLES_INDEX } from './registry.ts';

const o200k = SHIPPING_FIXTURES.get('openai-o200k_base') as TiktokenFixture;
const tainan = o200k.cases.find((c) => c.name === 'zh-tw-tainan');

describe('default example (examples-default.json → fromFixtureCase)', () => {
  it('is the default chip on the default tokenizer', () => {
    expect(EXAMPLES_INDEX.default).toEqual({ tokenizer: DEFAULT_TOKENIZER, case: EXAMPLES[0]?.fixtureCase });
    expect(EXAMPLES[0]?.text).toBe(DEFAULT_EXAMPLE);
  });

  it('reproduces fixtures/openai-o200k_base.json › zh-tw-tainan (4 cp, 12 B, 4 tokens, 8 merges)', () => {
    const result = defaultResult(7);
    expect(checkInvariants(result)).toEqual([]);
    expect(result.seq).toBe(7);
    expect(result.text).toBe(tainan?.text);
    expect([...result.tokens.id]).toEqual(tainan?.ids);
    expect(result.stats).toMatchObject({ codePoints: 4, bytes: 12, tokens: 4, partialTokens: 0, mergeSteps: 8 });
    expect([...(result.timeline?.stepResultId ?? [])]).toEqual([948, 948, 2166, 3735, 3735, 13864, 14609, 133072]);
  });

  it('is on screen before any tokenizer loads', () => {
    const app = createAppState();
    expect(app.resultSource).toBe('precomputed');
    expect(app.currentResult?.stats.tokens).toBe(4);
    expect(app.resident).toBeNull();
  });
});
