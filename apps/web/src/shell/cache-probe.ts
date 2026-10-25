/**
 * Cache API probes for the picker's "downloaded ✓" state and About › Diagnostics (03 §C.6, 05 §14). The Worker caches
 * each `.bin` under its absolute URL in a cache named `tsbs-tok-v<n>`; the main thread only lists and deletes — it never
 * trusts the index entry alone, because Safari evicts the cache after 7 days without a visit.
 */
import type { TokenizerId } from '@tsbs/core';

/** Caches written by the Worker's loader (`tsbs-tok-v1`, 03 §C.6). */
export const VOCAB_CACHE_PREFIX = 'tsbs-tok-';

/** Every URL cached by the loader, or null when the Cache API is unavailable (private mode, insecure context). */
export async function cachedVocabUrls(): Promise<string[] | null> {
  if (typeof caches === 'undefined') return null;
  try {
    const urls: string[] = [];
    for (const name of await caches.keys()) {
      if (!name.startsWith(VOCAB_CACHE_PREFIX)) continue;
      const cache = await caches.open(name);
      for (const request of await cache.keys()) urls.push(request.url);
    }
    return urls;
  } catch {
    return null;
  }
}

/** The tokenizers with a cached `/tok/<id>/….bin`. */
export function cachedTokenizers(urls: readonly string[], ids: readonly TokenizerId[]): Set<TokenizerId> {
  const out = new Set<TokenizerId>();
  for (const url of urls) {
    const path = new URL(url, 'https://local.invalid').pathname;
    for (const id of ids) if (path.startsWith(`/tok/${id}/`) && path.endsWith('.bin')) out.add(id);
  }
  return out;
}

/** Deletes every loader cache; resolves false when the Cache API is unavailable. */
export async function clearVocabCaches(): Promise<boolean> {
  if (typeof caches === 'undefined') return false;
  try {
    for (const name of await caches.keys()) if (name.startsWith(VOCAB_CACHE_PREFIX)) await caches.delete(name);
    return true;
  } catch {
    return false;
  }
}
