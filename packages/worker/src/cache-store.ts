/**
 * The Cache API storage both the Worker's loader and the main thread read (03 §C.6): one cache named `tsbs-tok-v1`
 * keyed by the asset's ABSOLUTE URL (`new URL(entry.path, origin)` — a root-relative manifest path resolved against
 * the origin, never against the Worker script's `/assets/` URL), plus a JSON index entry at `/__tsbs-index` for the
 * LRU. The structural types let tests pass in-memory fakes; the browser's `CacheStorage` / `Cache` satisfy them.
 */
import type { TokenizerId } from '@tsbs/core/model/result';

/** The cache of this asset-format version; startup cleanup deletes every other `tsbs-tok-*` cache. */
export const CACHE_NAME = 'tsbs-tok-v1';
/** Prefix of every cache this site has ever written. */
export const CACHE_PREFIX = 'tsbs-tok-';
/** Root-relative path of the LRU index entry inside {@link CACHE_NAME}. */
export const INDEX_PATH = '/__tsbs-index';

/** The subset of `Cache` the loader uses. */
export interface CacheLike {
  match(url: string): Promise<Response | undefined>;
  put(url: string, response: Response): Promise<void>;
  delete(url: string): Promise<boolean>;
  keys(): Promise<ReadonlyArray<{ readonly url: string }>>;
}

/** The subset of `CacheStorage` the loader and the picker probe use. */
export interface CacheStorageLike {
  open(name: string): Promise<CacheLike>;
  has(name: string): Promise<boolean>;
  keys(): Promise<string[]>;
  delete(name: string): Promise<boolean>;
}

/** The absolute URL of a root-relative manifest path: the fetch URL and the Cache API key (AD-11, AD-37). */
export function assetUrl(path: string, origin: string): string {
  return new URL(path, origin).href;
}

/**
 * Tokenizers whose asset is in the cache right now (the picker's "downloaded ✓", 03 §C.6). It reads `cache.keys()`
 * every time and never trusts the index alone: iOS Safari evicts script-writable storage after 7 days without a visit.
 * Resolves `[]` when the Cache API is unavailable (Safari private mode, insecure context) or the cache does not exist.
 */
export async function cachedTokenizerIds(
  storage: CacheStorageLike | null,
  paths: Readonly<Partial<Record<TokenizerId, { readonly path: string }>>>,
  origin: string,
): Promise<TokenizerId[]> {
  if (storage === null) return [];
  try {
    if (!(await storage.has(CACHE_NAME))) return [];
    const cache = await storage.open(CACHE_NAME);
    const urls = new Set((await cache.keys()).map((request) => request.url));
    const ids = Object.keys(paths) as TokenizerId[];
    return ids.filter((id) => {
      const path = paths[id]?.path;
      return path !== undefined && urls.has(assetUrl(path, origin));
    });
  } catch {
    return [];
  }
}
