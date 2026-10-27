/**
 * The page's first paint (AD-16): the inlined default example, expanded by `fromFixtureCase`, is the committed fixture's
 * 台灣台南 on o200k_base with its full merge timeline, and the AppState starts on it; the other default rows (PA-19) are
 * inlined beside it and seed the result hub.
 */
import type { TiktokenFixture } from '@tsbs/core';
import { checkInvariants } from '@tsbs/core/model/invariants';
import { describe, expect, it } from 'vitest';
import { createAppState, defaultResults } from './bootstrap.ts';
import { wantsMockClient } from './clients.ts';
import { DEFAULT_EXAMPLE } from './constants.ts';
import { SHIPPING_FIXTURES } from './fixtures.test-helper.ts';
import { DEFAULT_TOKENIZER, EXAMPLES, EXAMPLES_INDEX, TOKENIZERS } from './registry.ts';
import { ROW_OPTIONS } from './result-hub.svelte.ts';

const o200k = SHIPPING_FIXTURES.get('openai-o200k_base') as TiktokenFixture;
const tainan = o200k.cases.find((c) => c.name === 'zh-tw-tainan');

describe('default example (examples-default.json → fromFixtureCase)', () => {
  it('is the default chip on the default tokenizer', () => {
    expect(EXAMPLES_INDEX.default).toEqual({ tokenizer: DEFAULT_TOKENIZER, case: EXAMPLES[0]?.fixtureCase });
    expect(EXAMPLES[0]?.text).toBe(DEFAULT_EXAMPLE);
  });

  it('reproduces fixtures/openai-o200k_base.json › zh-tw-tainan (4 cp, 12 B, 4 tokens, 8 merges)', () => {
    const result = defaultResults()[DEFAULT_TOKENIZER]!;
    expect(checkInvariants(result)).toEqual([]);
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

describe('default rows (PA-19: examples-default.json → five inlined wires)', () => {
  const primary = TOKENIZERS.filter((entry) => entry.tier === 'primary').map((entry) => entry.id);

  it('name the default chip on each lab’s primary tokenizer, in the registry’s order', () => {
    expect(EXAMPLES_INDEX.defaults).toEqual(
      primary.map((tokenizer) => ({ tokenizer, case: EXAMPLES[0]?.fixtureCase })),
    );
    expect(EXAMPLES_INDEX.defaults[0]).toEqual(EXAMPLES_INDEX.default);
  });

  it('reproduce each fixture’s zh-tw-tainan case under the rows’ options', () => {
    const results = defaultResults();
    expect(Object.keys(results)).toEqual(primary);
    for (const id of primary) {
      const result = results[id];
      const expected = SHIPPING_FIXTURES.get(id)?.cases.find((c) => c.name === 'zh-tw-tainan');
      expect(result && checkInvariants(result), id).toEqual([]);
      expect(result?.input.text, id).toBe(DEFAULT_EXAMPLE);
      expect([...(result?.tokens.id ?? [])], id).toEqual(expected?.ids);
      expect(result?.options, id).toMatchObject(ROW_OPTIONS);
    }
  });

  it('seed the hub, so every default row is on screen before any tokenizer loads', () => {
    const app = createAppState();
    for (const id of primary) expect(app.hub.entry(id), id).toMatchObject({ source: 'precomputed', pending: false });
    expect(app.hub.entry('meta-llama4-muse').result?.stats.tokens).toBe(3);
    expect(app.hub.loaded('openai-o200k_base')).toBe(false);
  });
});

describe('client choice', () => {
  it('uses the Worker client unless the URL asks for the precomputed examples with ?mock=1', () => {
    expect(wantsMockClient('?mock=1')).toBe(true);
    expect(wantsMockClient('?lang=ja&mock=1')).toBe(true);
    expect(wantsMockClient('?mock=0')).toBe(false);
    expect(wantsMockClient('')).toBe(false);
    expect(wantsMockClient()).toBe(false); // no location in Node
  });
});
