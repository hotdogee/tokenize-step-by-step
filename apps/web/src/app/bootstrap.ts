/**
 * Builds the page's AppState: the precomputed default example on screen (AD-16) — WP03's inlined
 * `generated/examples-default.json` expanded by WP01's `fromFixtureCase` — and the tokenizer client.
 *
 * The client is WP07's Worker `TokenizerClient` (PA-8): `new TokenizerClient(() => new TokWorker({ name: WORKER_NAME }))`
 * over the Vite worker import of `@tsbs/worker/entry`, so typing tokenizes live with the real engines. `?mock=1` swaps in
 * the precomputed-examples `ExamplesClient` (WP01's `MockTokenizerClient`) for deterministic results without a Worker
 * (e2e specs that pin precomputed examples, offline debugging; docs/dev.md). Either way the client's code — and the
 * Worker — is imported on its first use, after first paint (`deferred-client.ts`, 06 §3).
 *
 * While a tokenizer loads, the example chips answer from the precomputed examples (`precomputed.ts`: the inlined
 * default rows, the lazy per-tokenizer files), and the page URL's state (`url-state.ts`) is read once, here.
 */
import type { TokenizationResult, TokenizerClientLike } from '@tsbs/core';
import type { ExamplesWire } from '@tsbs/core/fixture/examples-wire';
import { fromFixtureCase } from '@tsbs/core/fixture/from-fixture-case';
import examplesDefault from '../generated/examples-default.json';
import { AppState } from './app-state.svelte.ts';
import { DeferredClient } from './deferred-client.ts';
import { PrecomputedExamples } from './precomputed.ts';
import { EXAMPLES_INDEX, TOKENIZERS, tokenizerEntry } from './registry.ts';
import { parseUrlState, type UrlState } from './url-state.ts';

/** The inlined default rows: one wire per lab's primary tokenizer, each with the default chip only (PA-19). */
const DEFAULT_WIRES = examplesDefault as unknown as readonly ExamplesWire[];

/** The precomputed default example (OD-1: 台灣台南 on o200k_base), as the first paint shows it. */
export function defaultResult(seq = 0): TokenizationResult {
  const { tokenizer, case: caseName } = EXAMPLES_INDEX.default;
  const wire = DEFAULT_WIRES.find((candidate) => candidate.tokenizer === tokenizer);
  if (wire === undefined) throw new Error(`examples-default.json has no ${tokenizer}`);
  return fromFixtureCase(wire, caseName, tokenizerEntry(tokenizer), { seq });
}

/** True when the page URL asks for the precomputed-examples client (`?mock=1`). */
export function wantsMockClient(search: string = 'location' in globalThis ? globalThis.location.search : ''): boolean {
  return new URLSearchParams(search).get('mock') === '1';
}

/**
 * The precomputed-examples client: answers the example chips from the lazy `examples/<id>.<sha8>.json` files and rejects
 * any other text with `NoPrecomputedResultError` (the code arrives with the first call).
 */
export function createExamplesClient(fetchImpl?: (url: string) => Promise<Response>): TokenizerClientLike {
  return new DeferredClient(async () => {
    const [{ ExamplesClient }, { probeFeatures }] = await Promise.all([
      import('./examples-client.ts'),
      import('./features.ts'),
    ]);
    return new ExamplesClient({
      refs: TOKENIZERS,
      files: EXAMPLES_INDEX.files,
      features: probeFeatures(),
      ...(fetchImpl === undefined ? {} : { fetch: fetchImpl }),
    });
  });
}

/** The Worker client (PA-8): the client module and the Worker's entry chunk arrive with the first call. */
export function createWorkerClient(): TokenizerClientLike {
  return new DeferredClient(async () => {
    const [{ TokenizerClient, WORKER_NAME }, { default: TokWorker }] = await Promise.all([
      import('@tsbs/worker/client'),
      import('@tsbs/worker/entry?worker'),
    ]);
    return new TokenizerClient(() => new TokWorker({ name: WORKER_NAME }));
  });
}

/** The client of the page: the Worker, or the precomputed examples under `?mock=1`. */
export function createClient(): TokenizerClientLike {
  return wantsMockClient() ? createExamplesClient() : createWorkerClient();
}

/** The page URL's state (read once at load), among the tokenizers the picker offers. */
export function initialUrlState(search: string = 'location' in globalThis ? globalThis.location.search : ''): UrlState {
  return parseUrlState(
    search,
    TOKENIZERS.filter((entry) => entry.withdrawn !== true).map((entry) => entry.id),
  );
}

export function createAppState(): AppState {
  const precomputed = new PrecomputedExamples(EXAMPLES_INDEX.files, DEFAULT_WIRES);
  return new AppState(createClient(), defaultResult(), precomputed, initialUrlState());
}
