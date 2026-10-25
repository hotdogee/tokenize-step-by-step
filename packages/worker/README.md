# @tsbs/worker

The tokenizer Web Worker (WP07): the host that speaks the FROZEN protocol of `@tsbs/core/protocol` (04 §6), the
vocabulary loader (03 §C.6) and the main-thread `TokenizerClient`. It depends on `@tsbs/core` only, by subpath, so no
engine code reaches the host chunk (02 §2.1).

| Module                           | Runs in       | Does                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                               |
| -------------------------------- | ------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `src/entry.ts`                   | Worker        | The entry Vite bundles as `assets/entry-[hash].js`. The **only** module that imports `src/generated/vocab-manifest.json` and `src/generated/engine-config.json` (PA-8); imports the engines lazily: `import('./engines/bytelevel.ts')` / `import('./engines/spm.ts')` → `assets/bytelevel-[hash].js` / `assets/spm-[hash].js`.                                                                                                                                                                                                                                                     |
| `src/host.ts`                    | Worker        | `createHost({ manifest, engineConfig, importEngine, post })`: one running + one pending encode, `seq`, `cancel.target` (pending and in flight), encodes queued across a load, `not-loaded` only when nothing is resident or loading, load supersession, strict one-resident (tables released before a load starts; `hooks.onLoadStart` for tests), lazy engines, encode `progress` every slice, `prefetch` no-op ack, `pong.heapHint = null`. `startHost(self, deps)` wires it to a Worker scope.                                                                                  |
| `src/loader.ts`                  | Worker        | Root-relative manifest paths → `new URL(path, self.location.origin)`; Cache API `tsbs-tok-v1` keyed by that URL; `fetch` with a counting reader (progress every 64 KiB / 100 ms, exact total from `Content-Length`); content sniffing `1F 8B` → `DecompressionStream('gzip')` + `sha256`, `TSBV` → as-is + `sha256Raw`, else `format`; no `crypto.subtle` → no verification; one automatic refetch after an integrity mismatch; `cache.put` only after the container decoded, with a quota fallback; LRU index (≤ 3 tokenizers / ≤ 12 MiB); startup cleanup; `cache.keys()` probe. |
| `src/client.ts`                  | main thread   | `TokenizerClient implements TokenizerClientLike`, `WORKER_NAME`, `CancelledError` / `isCancelled` (re-exported from `@tsbs/core/fixture/mock-client`, so the real and the mock client throw the same class), `TokenizerError` (`code`, `retryable`), `shouldPrefetch` (AD-19), `probeCachedTokenizers` (picker / About).                                                                                                                                                                                                                                                           |
| `src/engines/{bytelevel,spm}.ts` | Worker (lazy) | The engine chunks. **TODO(WP-integration):** today stand-ins (`mock-engine.ts`) with the real factory names; replace the bodies with `export { createByteLevelTokenizer } from '@tsbs/core/engines/bytelevel/index'` / `export { createSpmTokenizer } from '@tsbs/core/engines/spm/index'` and delete `mock-engine.ts`.                                                                                                                                                                                                                                                            |

## Using it from `apps/web`

```ts
import TokWorker from '@tsbs/worker/entry?worker'; // Vite worker import (worker.format: 'es'); never new URL('@tsbs/…')
import { TokenizerClient, WORKER_NAME } from '@tsbs/worker/client';

const client = new TokenizerClient(() => new TokWorker({ name: WORKER_NAME }));
```

The factory is called for the first Worker and for the single respawn (a crash or two silent watchdog periods replay
the last `load`; a second failure on the same tokenizer rejects with `code: 'oom'`). `client.features` and
`client.assets` resolve from the Worker's `ready`; `client.cachedTokenizers()` is the picker's "downloaded ✓" probe;
`client.prefetchWhenIdle(id)` applies the AD-19 rule for the lab's secondary tokenizer.

Wiring notes for the integrator: the `?worker` import needs Vite's client types (`vite/client`) in `apps/web`'s
tsconfig, and the `apps/web` ESLint pattern that allows only `@tsbs/worker/client` needs an exception for
`@tsbs/worker/entry?worker` (it is a Worker constructor, not module code in the main bundle).

## Generated files (gitignored)

`src/generated/vocab-manifest.json` (the converter's `vocab-manifest.generated.json`, or an empty `{ schema: 1, assets: {} }`
shell when `data/vocab/dist` is absent) and `src/generated/engine-config.json` (per tokenizer: `id`, `family`,
`vocabSize`, `rankCount`, `engine`, `defaults`, `toggles` from `packages/registry/data/tokenizers.json`) are written by
`pnpm generate` (before lint, typecheck and test) and by the `vocabAssets()` Vite plugin.

## Tests

- `pnpm exec vitest run --project worker` — Node: host rules, client rules (scripted and in-process Workers, fake
  timers for the watchdog), loader (fake `fetch`, in-memory Cache API), the built o200k asset end to end, the host-chunk
  size (esbuild, engines external, brotli ≤ 12 KiB).
- `pnpm exec vitest run --project worker-browser` — chromium (Vitest browser mode): the production entry loads the
  built `.bin`, cache hit, integrity failure, lazy engine chunks, tables released before `load`, cancellation. Skips
  without chromium (`pnpm exec playwright install chromium`) or without `data/vocab/dist`.
- `TSBS_PERF=1 NODE_OPTIONS=--expose-gc pnpm exec vitest run --project worker` — also prints the cancel latency, the
  host-chunk size and the Node heap delta of a resident o200k.
