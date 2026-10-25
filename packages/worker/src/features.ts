/**
 * The Worker's `ready.features` (04 §6): the same four flags the main thread probes for About › Diagnostics, measured
 * where the loader runs. `cacheApi` is true only when the cache actually opens (Safari private mode exposes `caches`
 * but throws, 07 WP07 risk); `subtleCrypto` is false in insecure contexts, where the loader skips verification.
 */
import type { Features } from '@tsbs/core/protocol';
import { CACHE_NAME, type CacheStorageLike } from './cache-store.ts';

/** The Worker globals the probe reads (each may be missing). */
interface ProbedGlobals {
  readonly caches?: CacheStorageLike;
  readonly crypto?: { readonly subtle?: { readonly digest?: unknown } };
  readonly Intl: { readonly Segmenter?: unknown };
}

/** True when `DecompressionStream('brotli')` constructs (Firefox 147 / Safari 18.4; absent in Chrome, AD-10). */
function hasBrotli(): boolean {
  if (typeof DecompressionStream !== 'function') return false;
  try {
    new DecompressionStream('brotli' as CompressionFormat);
    return true;
  } catch {
    return false;
  }
}

/** Probes the Worker's capabilities. Never rejects. */
export async function probeWorkerFeatures(): Promise<Features> {
  const scope = globalThis as unknown as ProbedGlobals;
  let cacheApi = false;
  if (scope.caches !== undefined) {
    try {
      await scope.caches.open(CACHE_NAME);
      cacheApi = true;
    } catch {
      cacheApi = false;
    }
  }
  return {
    cacheApi,
    segmenter: typeof scope.Intl.Segmenter === 'function',
    brotli: hasBrotli(),
    subtleCrypto: typeof scope.crypto?.subtle?.digest === 'function',
  };
}
