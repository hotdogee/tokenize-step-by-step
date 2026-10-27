/**
 * The page's tokenizer clients (PA-8, PA-19): the Worker `TokenizerClient` — `new TokenizerClient(() => new TokWorker({
 * name: WORKER_NAME }))` over the Vite worker import of `@tsbs/worker/entry` — or, under `?mock=1`, the
 * precomputed-examples `ExamplesClient` (WP01's `MockTokenizerClient`) for deterministic results without a Worker (e2e
 * specs that pin precomputed examples, offline debugging; docs/dev.md). The pool (`tokenizer-pool.ts`) spawns one per
 * tokenizer on screen.
 *
 * Only the hub's engine (`result-hub-engine.ts`) imports this module, and the engine is imported with the first load,
 * after first paint (06 §3): the Worker client's code arrives in the engine's lazy chunk, the examples client's in a
 * chunk of its own on its first call (`DeferredClient`).
 */
import type { TokenizerClientLike } from '@tsbs/core';
import { TokenizerClient, WORKER_NAME } from '@tsbs/worker/client';
import TokWorker from '@tsbs/worker/entry?worker';
import { DeferredClient } from './deferred-client.ts';
import { EXAMPLES_INDEX, TOKENIZERS } from './registry.ts';

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

/** One Worker client (PA-8): its Worker starts now. */
export function createWorkerClient(): TokenizerClientLike {
  return new TokenizerClient(() => new TokWorker({ name: WORKER_NAME }));
}

/** One client of the page's pool: a Worker, or the precomputed examples under `?mock=1`. */
export function createClient(): TokenizerClientLike {
  return wantsMockClient() ? createExamplesClient() : createWorkerClient();
}
