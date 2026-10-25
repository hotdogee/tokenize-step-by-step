/**
 * Builds the page's AppState: the precomputed default example on screen (AD-16) — WP03's inlined
 * `generated/examples-default.json` expanded by WP01's `fromFixtureCase` — and the tokenizer client, which is the
 * precomputed-examples `ExamplesClient` (WP01's `MockTokenizerClient`) until WP07's Worker `TokenizerClient` replaces it.
 * The client's code is imported on its first use, after first paint (`deferred-client.ts`, 06 §3).
 */
import type { TokenizationResult, TokenizerClientLike } from '@tsbs/core';
import type { ExamplesWire } from '@tsbs/core/fixture/examples-wire';
import { fromFixtureCase } from '@tsbs/core/fixture/from-fixture-case';
import examplesDefault from '../generated/examples-default.json';
import { AppState } from './app-state.svelte.ts';
import { DeferredClient } from './deferred-client.ts';
import { probeFeatures } from './features.ts';
import { EXAMPLES_INDEX, TOKENIZERS, tokenizerEntry } from './registry.ts';

/** The precomputed default example (OD-1: 台灣台南 on o200k_base), as the first paint shows it. */
export function defaultResult(seq = 0): TokenizationResult {
  const { tokenizer, case: caseName } = EXAMPLES_INDEX.default;
  return fromFixtureCase(examplesDefault as unknown as ExamplesWire, caseName, tokenizerEntry(tokenizer), { seq });
}

/** The client of the page: precomputed examples, fetched per tokenizer on first load (the code with the first call). */
export function createClient(fetchImpl?: (url: string) => Promise<Response>): TokenizerClientLike {
  return new DeferredClient(async () => {
    const { ExamplesClient } = await import('./examples-client.ts');
    return new ExamplesClient({
      refs: TOKENIZERS,
      files: EXAMPLES_INDEX.files,
      features: probeFeatures(),
      ...(fetchImpl === undefined ? {} : { fetch: fetchImpl }),
    });
  });
}

export function createAppState(): AppState {
  return new AppState(createClient(), defaultResult());
}
