/**
 * Builds the page's AppState: the result hub (PA-19), seeded with the precomputed default rows (AD-16) — WP03's inlined
 * `generated/examples-default.json` (台灣台南 on each lab's primary tokenizer) expanded by WP01's `fromFixtureCase`.
 *
 * The hub's Worker side (`result-hub-engine.ts`) and the clients it spawns — one per tokenizer on screen (`clients.ts`:
 * WP07's Worker `TokenizerClient`, PA-8, or one precomputed-examples `ExamplesClient` per tokenizer under `?mock=1`) —
 * are imported with the first load, after first paint (06 §3), so typing tokenizes live with the real engines.
 *
 * While a tokenizer loads, the example chips answer from the precomputed examples (`precomputed.ts`, imported on the first
 * lookup — the seeded default rows need none: the inlined wires, the lazy per-tokenizer files), and the page URL's state
 * (`url-state.ts`) is read once, here.
 */
import type { TokenizationResult, TokenizerId } from '@tsbs/core';
import type { ExamplesWire } from '@tsbs/core/fixture/examples-wire';
import { fromFixtureCase } from '@tsbs/core/fixture/from-fixture-case';
import examplesDefault from '../generated/examples-default.json';
import { AppState } from './app-state.svelte.ts';
import type { PrecomputedSource } from './precomputed.ts';
import { EXAMPLES_INDEX, TOKENIZERS, tokenizerEntry } from './registry.ts';
import { ResultHub } from './result-hub.svelte.ts';
import { ROW_CHOICES } from '../compare/rows.svelte.ts';
import { parseUrlState, type UrlState } from './url-state.ts';

/** The inlined default rows: one wire per lab's primary tokenizer, each with the default chip only (PA-19). */
const DEFAULT_WIRES = examplesDefault as unknown as readonly ExamplesWire[];

/** The inlined precomputed result of `caseName` on `tokenizer`. */
function inlined(tokenizer: TokenizerId, caseName: string, seq = 0): TokenizationResult {
  const wire = DEFAULT_WIRES.find((candidate) => candidate.tokenizer === tokenizer);
  if (wire === undefined) throw new Error(`examples-default.json has no ${tokenizer}`);
  return fromFixtureCase(wire, caseName, tokenizerEntry(tokenizer), { seq });
}

/** The precomputed default example (OD-1: 台灣台南 on o200k_base), as the board's first paint shows it. */
export function defaultResult(seq = 0): TokenizationResult {
  const { tokenizer, case: caseName } = EXAMPLES_INDEX.default;
  return inlined(tokenizer, caseName, seq);
}

/** The precomputed default rows (PA-19): 台灣台南 on each lab's primary tokenizer, as the table's first paint shows them. */
export function defaultResults(): Partial<Record<TokenizerId, TokenizationResult>> {
  const results: Partial<Record<TokenizerId, TokenizationResult>> = {};
  for (const { tokenizer, case: caseName } of EXAMPLES_INDEX.defaults)
    results[tokenizer] = inlined(tokenizer, caseName);
  return results;
}

/** The page URL's state (read once at load), among the tokenizers the picker offers and the table rows' choices. */
export function initialUrlState(search: string = 'location' in globalThis ? globalThis.location.search : ''): UrlState {
  return parseUrlState(
    search,
    TOKENIZERS.filter((entry) => entry.withdrawn !== true).map((entry) => entry.id),
    ROW_CHOICES,
  );
}

/** The precomputed examples, imported on the first lookup (a failed import is retried on the next one). */
function lazyPrecomputed(): PrecomputedSource {
  let source: Promise<PrecomputedSource> | null = null;
  return {
    find: (ref, text, options) => {
      source ??= import('./precomputed.ts').then(
        (module) => new module.PrecomputedExamples(EXAMPLES_INDEX.files, DEFAULT_WIRES),
        (error: unknown) => {
          source = null;
          throw error;
        },
      );
      return source.then((examples) => examples.find(ref, text, options));
    },
  };
}

/** The page's AppState over a result hub seeded with the default rows. */
export function createAppState(): AppState {
  const hub = new ResultHub({ precomputed: lazyPrecomputed(), seeds: Object.values(defaultResults()) });
  return new AppState(hub, initialUrlState());
}
