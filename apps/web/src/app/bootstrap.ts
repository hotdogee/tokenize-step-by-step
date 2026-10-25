/**
 * Builds the page's AppState: the precomputed default example on screen (AD-16) plus the tokenizer client.
 *
 * TODO(WP-integration): construct WP07's `TokenizerClient` (Vite worker import) and use WP03's inlined
 * `generated/examples-default.json` through WP01's `fromFixtureCase` instead of the two stubs.
 */
import { AppState } from './app-state.svelte.ts';
import { StubTokenizerClient } from './stub-client.ts';
import { defaultResult } from './stub-result.ts';

export function createAppState(): AppState {
  return new AppState(new StubTokenizerClient(), defaultResult());
}
