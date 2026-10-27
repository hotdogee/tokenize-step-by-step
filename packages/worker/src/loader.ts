/**
 * The vocabulary loader inside the Worker (03 §C.6, AD-10, AD-11, AD-37): bundled manifest → absolute URL → Cache API
 * (`tsbs-tok-v1`, keyed by that URL) or `fetch` with a counting reader → CONTENT SNIFFING (`1F 8B` = our gzip file,
 * `TSBV` = a transparently decoded body, anything else = `format`) → SHA-256 of exactly those bytes against `sha256` /
 * `sha256Raw` (skipped, with `features.subtleCrypto = false`, when `crypto.subtle` is absent) → `DecompressionStream`
 * for the gzip layer. Headers are never trusted for the layer: a visible `Content-Encoding` only means the
 * `Content-Length` is not the size of the bytes we read, so the progress denominator falls back to the manifest.
 *
 * The verified bytes reach the cache only through {@link FetchedAsset.commit}, which the host calls once the container
 * decoded (so a bad asset is never stored), with a quota fallback (`navigator.storage.estimate()` must show 2× the asset
 * free, and a failing `put` just leaves the load memory-only). An index entry at `/__tsbs-index` keeps at most nine
 * tokenizers / 12 MiB (LRU). Every cache operation runs on one serial queue, so a load right after a commit sees it. The
 * queue is per loader, i.e. per Worker: with one Worker per tokenizer (PA-19) the index is advisory, and two Workers
 * committing at once may lose a row of it (03 §C.6).
 */
import type { VocabAssetEntry, VocabManifest } from '@tsbs/core/format/types';
import { TSBV1_MAGIC } from '@tsbs/core/format/tsbv1';
import type { TokenizerId } from '@tsbs/core/model/result';
import type { Progress } from '@tsbs/core/protocol';
import {
  assetUrl,
  CACHE_NAME,
  CACHE_PREFIX,
  cachedTokenizerIds,
  INDEX_PATH,
  type CacheLike,
  type CacheStorageLike,
} from './cache-store.ts';
import { TokenizerError } from './errors.ts';

/** `crypto.subtle`'s digest, the only primitive the loader needs. */
export interface DigestLike {
  digest(algorithm: 'SHA-256', data: Uint8Array<ArrayBuffer>): Promise<ArrayBuffer>;
}

/** What the loader touches outside itself (the defaults read the Worker's globals; tests pass fakes). */
export interface LoaderEnv {
  /** `self.location.origin`: root-relative manifest paths resolve against it, never against the script URL. */
  readonly origin: string;
  readonly fetch: (
    url: string,
    init: { readonly cache: 'force-cache'; readonly signal?: AbortSignal },
  ) => Promise<Response>;
  /** `caches`, or null when the Cache API is unavailable (then every load is memory-only). */
  readonly caches: CacheStorageLike | null;
  /** `crypto.subtle`, or null in insecure contexts (verification is skipped, 03 §C.6 step 2). */
  readonly subtle: DigestLike | null;
  /** `navigator.storage.estimate`, or null where it does not exist (Safari < 17: the put is attempted). */
  readonly estimate: (() => Promise<{ readonly quota?: number; readonly usage?: number }>) | null;
  /** Wall clock for the LRU index and the progress throttle. */
  readonly now: () => number;
}

/** LRU bounds of the cached vocabularies (03 §C.6 step 9). */
export interface LoaderLimits {
  readonly maxEntries: number;
  readonly maxBytes: number;
}

/**
 * Nine entries: every local tokenizer (PA-19's table keeps five Workers loading side by side, so a smaller count would
 * evict a row's vocabulary on every visit); the byte bound still caps the cache.
 */
export const DEFAULT_LIMITS: LoaderLimits = { maxEntries: 9, maxBytes: 12 * 1024 * 1024 };

/** Progress callback: one of the loader's phases, bytes done, denominator (null when unknown). */
export type LoaderProgress = (phase: Progress['phase'], loaded: number, total: number | null) => void;

/** A downloaded (or cached) and verified asset, decompressed to its TSBV1 container. */
export interface FetchedAsset {
  readonly container: ArrayBuffer;
  readonly layer: 'gzip' | 'raw';
  readonly fromCache: boolean;
  /** Bytes read from the network (every attempt), 0 for a cache hit. */
  readonly bytesTransferred: number;
  /** The response's `Content-Encoding` (logged only, AD-37); null for a cache hit or when absent. */
  readonly contentEncoding: string | null;
  /** Stores the verified bytes (network) or refreshes the LRU entry (cache hit). Never rejects. */
  commit(): Promise<void>;
  /** Removes this asset from the cache (a cached container that failed to decode). Never rejects. */
  evict(): Promise<void>;
}

export interface LoadOptions {
  readonly signal?: AbortSignal;
  /** Skip the cache lookup (the retry after a cached container failed to decode). */
  readonly network?: boolean;
}

export interface Loader {
  /** Steps 1–6 of 03 §C.6. Rejects with `TokenizerError` (`fetch`, `integrity`, `format`, `decompress`). */
  load(id: TokenizerId, onProgress: LoaderProgress, options?: LoadOptions): Promise<FetchedAsset>;
  /** Steps 3–5 + 8 (download, verify, cache; no decompression, no build). Resolves the stored byte count. */
  prefetch(id: TokenizerId, onProgress: LoaderProgress, signal?: AbortSignal): Promise<number>;
  /** Step 10: deletes other `tsbs-tok-*` caches and entries whose URL is not in the manifest. Never rejects. */
  cleanup(): Promise<void>;
  /** The `cache.keys()` probe (03 §C.6): tokenizers whose asset is cached now. */
  cachedIds(): Promise<TokenizerId[]>;
}

/** Progress events are throttled to one per 64 KiB or 100 ms (the final one always fires). */
const PROGRESS_BYTES = 64 * 1024;
const PROGRESS_MS = 100;

/** One LRU index row. */
interface IndexEntry {
  readonly url: string;
  readonly bytes: number;
  readonly lastUsed: number;
}

/** The Worker's globals as the loader needs them (each may be missing: private mode, insecure context, old Safari). */
interface WorkerGlobals {
  readonly location: { readonly origin: string };
  readonly caches?: CacheStorageLike;
  readonly crypto?: { readonly subtle?: DigestLike };
  readonly navigator?: { readonly storage?: { estimate?: () => Promise<{ quota?: number; usage?: number }> } };
}

/** The loader environment of a real Worker. */
export function defaultLoaderEnv(): LoaderEnv {
  const scope = globalThis as unknown as WorkerGlobals;
  const storage = scope.navigator?.storage;
  const estimate = storage?.estimate;
  return {
    origin: scope.location.origin,
    fetch: (url, init) => fetch(url, init),
    caches: scope.caches ?? null,
    subtle: scope.crypto?.subtle ?? null,
    estimate: estimate === undefined ? null : () => estimate.call(storage),
    now: () => Date.now(),
  };
}

/** Lower-case hex of a digest. */
function hex(buffer: ArrayBuffer): string {
  return Array.from(new Uint8Array(buffer), (b) => b.toString(16).padStart(2, '0')).join('');
}

/** The layer the bytes ARE (never what a header says): our gzip file, the raw TSBV1 container, or neither. */
export function sniffLayer(bytes: Uint8Array): 'gzip' | 'raw' | null {
  if (bytes[0] === 0x1f && bytes[1] === 0x8b) return 'gzip';
  if (bytes.length >= 4 && TSBV1_MAGIC.every((b, i) => bytes[i] === b)) return 'raw';
  return null;
}

/** Concatenates a byte stream into one exactly-sized buffer, reporting the running count. */
async function readStream(
  stream: ReadableStream<Uint8Array>,
  expected: number | null,
  report: (loaded: number) => void,
): Promise<Uint8Array<ArrayBuffer>> {
  let buffer = new Uint8Array(expected !== null && expected > 0 ? expected : 64 * 1024);
  let length = 0;
  const reader = stream.getReader();
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    if (length + value.length > buffer.length) {
      const grown = new Uint8Array(Math.max(buffer.length * 2, length + value.length));
      grown.set(buffer.subarray(0, length));
      buffer = grown;
    }
    buffer.set(value, length);
    length += value.length;
    report(length);
  }
  return length === buffer.length ? buffer : buffer.slice(0, length);
}

/** A throttled progress reporter for one phase; `done(n)` always reports. */
function throttled(
  onProgress: LoaderProgress,
  phase: Progress['phase'],
  total: () => number | null,
  now: () => number,
): { tick(loaded: number): void; done(loaded: number): void } {
  let lastBytes = 0;
  let lastTime = now();
  return {
    tick(loaded) {
      const t = now();
      if (loaded - lastBytes < PROGRESS_BYTES && t - lastTime < PROGRESS_MS) return;
      lastBytes = loaded;
      lastTime = t;
      onProgress(phase, loaded, total());
    },
    done(loaded) {
      onProgress(phase, loaded, total());
    },
  };
}

function isAbort(error: unknown, signal: AbortSignal | undefined): boolean {
  return signal?.aborted === true || (error instanceof Error && error.name === 'AbortError');
}

/** Creates the loader over the bundled manifest (AD-11). */
export function createLoader(manifest: VocabManifest, env: LoaderEnv, limits: LoaderLimits = DEFAULT_LIMITS): Loader {
  const indexUrl = assetUrl(INDEX_PATH, env.origin);
  let queue: Promise<unknown> = Promise.resolve();
  let opened: Promise<CacheLike | null> | null = null;

  /** Runs cache operations one at a time, in call order. */
  const serial = <T>(op: () => Promise<T>): Promise<T> => {
    const run = queue.then(op, op);
    queue = run.catch(() => undefined);
    return run;
  };

  /** The cache, or null (no Cache API, or `open` throws: Safari private mode → memory-only path). */
  const openCache = (): Promise<CacheLike | null> => {
    const storage = env.caches;
    if (storage === null) return Promise.resolve(null);
    opened ??= storage.open(CACHE_NAME).catch(() => null);
    return opened;
  };

  const entryOf = (id: TokenizerId): VocabAssetEntry => {
    const entry = manifest.assets[id];
    if (entry === undefined) throw new TokenizerError('fetch', `no vocabulary asset for ${id} in this build`, false);
    return entry;
  };

  const readIndex = async (cache: CacheLike): Promise<IndexEntry[]> => {
    const response = await cache.match(indexUrl);
    if (response === undefined) return [];
    try {
      const value: unknown = await response.json();
      const entries = (value as { entries?: unknown }).entries;
      if (!Array.isArray(entries)) return [];
      return entries.filter(
        (e): e is IndexEntry =>
          typeof e === 'object' &&
          e !== null &&
          typeof (e as IndexEntry).url === 'string' &&
          typeof (e as IndexEntry).bytes === 'number' &&
          typeof (e as IndexEntry).lastUsed === 'number',
      );
    } catch {
      return [];
    }
  };

  const writeIndex = (cache: CacheLike, entries: readonly IndexEntry[]): Promise<void> =>
    cache.put(
      indexUrl,
      new Response(JSON.stringify({ schema: 1, entries }), { headers: { 'content-type': 'application/json' } }),
    );

  /** Marks `url` most recently used and evicts the least recently used beyond the limits (never `url` itself). */
  const touchNow = async (cache: CacheLike, url: string, bytes: number): Promise<void> => {
    const rows = (await readIndex(cache)).filter((e) => e.url !== url);
    const newest = rows.reduce((max, e) => Math.max(max, e.lastUsed), 0);
    rows.sort((a, b) => a.lastUsed - b.lastUsed);
    rows.push({ url, bytes, lastUsed: Math.max(env.now(), newest + 1) });
    let total = rows.reduce((sum, e) => sum + e.bytes, 0);
    while (rows.length > 1 && (rows.length > limits.maxEntries || total > limits.maxBytes)) {
      const oldest = rows.shift();
      if (oldest === undefined) break;
      total -= oldest.bytes;
      await cache.delete(oldest.url);
    }
    await writeIndex(cache, rows);
  };

  /** {@link touchNow} on the serial queue. */
  const touch = (url: string, bytes: number): Promise<void> =>
    serial(async () => {
      const cache = await openCache();
      if (cache !== null) await touchNow(cache, url, bytes);
    }).catch(() => undefined);

  /** Deletes `url` and its index row. */
  const remove = (url: string): Promise<void> =>
    serial(async () => {
      const cache = await openCache();
      if (cache === null) return;
      await cache.delete(url);
      const rows = await readIndex(cache);
      if (rows.some((e) => e.url === url)) {
        await writeIndex(
          cache,
          rows.filter((e) => e.url !== url),
        );
      }
    }).catch(() => undefined);

  /** True unless the storage estimate shows less than twice `bytes` free (03 §C.6 step 8). */
  const hasRoom = async (bytes: number): Promise<boolean> => {
    if (env.estimate === null) return true;
    try {
      const { quota, usage } = await env.estimate();
      return quota === undefined || usage === undefined || quota - usage >= 2 * bytes;
    } catch {
      return true;
    }
  };

  /**
   * Step 8: stores exactly the verified bytes, then updates the index; memory-only when the estimate or `put` says no
   * (quota fallback). Queued synchronously, so a load issued after `commit()` waits for the stored body.
   */
  const store = (url: string, bytes: Uint8Array<ArrayBuffer>, layer: 'gzip' | 'raw'): Promise<void> =>
    serial(async () => {
      const cache = await openCache();
      if (cache === null || !(await hasRoom(bytes.length))) return;
      const response = new Response(bytes, {
        headers: { 'content-type': 'application/octet-stream', 'x-tsbs-layer': layer },
      });
      const stored = await cache.put(url, response).then(
        () => true,
        () => false,
      );
      if (stored) await touchNow(cache, url, bytes.length);
    }).catch(() => undefined);

  /** Step 3 (miss): one GET with a counting reader. */
  const download = async (
    url: string,
    entry: VocabAssetEntry,
    onProgress: LoaderProgress,
    signal: AbortSignal | undefined,
  ): Promise<{ bytes: Uint8Array<ArrayBuffer>; contentEncoding: string | null }> => {
    let response: Response;
    try {
      response = await env.fetch(
        url,
        signal === undefined ? { cache: 'force-cache' } : { cache: 'force-cache', signal },
      );
    } catch (error) {
      if (isAbort(error, signal)) throw error;
      throw new TokenizerError('fetch', `could not download ${url}`, true, { cause: error });
    }
    if (!response.ok) {
      throw new TokenizerError('fetch', `HTTP ${String(response.status)} for ${url}`, response.status >= 500);
    }
    const contentEncoding = response.headers.get('content-encoding');
    const length = contentEncoding === null ? Number(response.headers.get('content-length') ?? Number.NaN) : Number.NaN;
    const announced = Number.isSafeInteger(length) && length > 0 ? length : entry.bytesCompressed;
    const denominator: { value: number | null } = { value: announced };
    const progress = throttled(onProgress, 'download', () => denominator.value, env.now);
    onProgress('download', 0, announced);
    let bytes: Uint8Array<ArrayBuffer>;
    try {
      bytes =
        response.body === null
          ? new Uint8Array(await response.arrayBuffer())
          : await readStream(response.body, announced, (loaded) => {
              // A transparently decoded body is larger than announced: the denominator becomes unknown.
              if (denominator.value !== null && loaded > denominator.value) denominator.value = null;
              progress.tick(loaded);
            });
    } catch (error) {
      if (isAbort(error, signal)) throw error;
      throw new TokenizerError('fetch', `download of ${url} failed`, true, { cause: error });
    }
    denominator.value ??= bytes.length;
    progress.done(bytes.length);
    return { bytes, contentEncoding };
  };

  /** Steps 3–5 from the network, with one automatic refetch after an integrity mismatch. */
  const fromNetwork = async (
    url: string,
    entry: VocabAssetEntry,
    onProgress: LoaderProgress,
    signal: AbortSignal | undefined,
  ): Promise<{
    bytes: Uint8Array<ArrayBuffer>;
    layer: 'gzip' | 'raw';
    contentEncoding: string | null;
    transferred: number;
  }> => {
    let transferred = 0;
    for (let attempt = 1; ; attempt++) {
      const { bytes, contentEncoding } = await download(url, entry, onProgress, signal);
      transferred += bytes.length;
      const layer = sniffLayer(bytes);
      if (layer === null) {
        throw new TokenizerError('format', `${url} is neither a gzip file nor a TSBV1 container`, false);
      }
      if (env.subtle !== null) {
        onProgress('verify', 0, 1);
        const actual = hex(await env.subtle.digest('SHA-256', bytes));
        onProgress('verify', 1, 1);
        if (actual !== (layer === 'gzip' ? entry.sha256 : entry.sha256Raw)) {
          await remove(url);
          if (attempt < 2) continue;
          throw new TokenizerError('integrity', `${url} failed its SHA-256 check (${layer} layer)`, true);
        }
      }
      return { bytes, layer, contentEncoding, transferred };
    }
  };

  /** Step 6: gunzips through `DecompressionStream`, reporting against `bytesRaw`. */
  const gunzip = async (
    bytes: Uint8Array<ArrayBuffer>,
    entry: VocabAssetEntry,
    onProgress: LoaderProgress,
  ): Promise<ArrayBuffer> => {
    if (typeof DecompressionStream !== 'function') {
      throw new TokenizerError('decompress', 'DecompressionStream is not available in this browser', false);
    }
    const progress = throttled(onProgress, 'decompress', () => entry.bytesRaw, env.now);
    onProgress('decompress', 0, entry.bytesRaw);
    try {
      const stream = new Blob([bytes]).stream().pipeThrough(new DecompressionStream('gzip'));
      const out = await readStream(stream, entry.bytesRaw, (n) => {
        progress.tick(n);
      });
      progress.done(out.length);
      return out.buffer;
    } catch (error) {
      throw new TokenizerError('decompress', `could not decompress ${entry.path}`, false, { cause: error });
    }
  };

  /** A cache hit's container, or null when the stored body is unusable (it is evicted; the caller refetches). */
  const fromCache = async (
    url: string,
    entry: VocabAssetEntry,
    onProgress: LoaderProgress,
  ): Promise<FetchedAsset | null> => {
    const cache = await openCache();
    if (cache === null) return null;
    const bytes = await serial(async () => {
      const hit = await cache.match(url);
      return hit === undefined ? null : new Uint8Array(await hit.arrayBuffer());
    }).catch(() => null);
    if (bytes === null) return null;
    onProgress('cache', bytes.length, bytes.length);
    const layer = sniffLayer(bytes);
    let container: ArrayBuffer | null = null;
    if (layer === 'raw') container = bytes.buffer;
    else if (layer === 'gzip') container = await gunzip(bytes, entry, onProgress).catch(() => null);
    if (layer === null || container === null) {
      await remove(url);
      return null;
    }
    return {
      container,
      layer,
      fromCache: true,
      bytesTransferred: 0,
      contentEncoding: null,
      commit: () => touch(url, bytes.length),
      evict: () => remove(url),
    };
  };

  return {
    async load(id, onProgress, options = {}) {
      const entry = entryOf(id);
      const url = assetUrl(entry.path, env.origin);
      if (options.network !== true) {
        const hit = await fromCache(url, entry, onProgress);
        if (hit !== null) return hit;
      }
      const net = await fromNetwork(url, entry, onProgress, options.signal);
      const container = net.layer === 'gzip' ? await gunzip(net.bytes, entry, onProgress) : net.bytes.buffer;
      return {
        container,
        layer: net.layer,
        fromCache: false,
        bytesTransferred: net.transferred,
        contentEncoding: net.contentEncoding,
        commit: () => store(url, net.bytes, net.layer),
        evict: () => remove(url),
      };
    },

    async prefetch(id, onProgress, signal) {
      const entry = entryOf(id);
      const url = assetUrl(entry.path, env.origin);
      const cache = await openCache();
      if (cache !== null) {
        const size = await serial(async () => {
          const hit = await cache.match(url);
          return hit === undefined ? null : (await hit.arrayBuffer()).byteLength;
        }).catch(() => null);
        if (size !== null) {
          await touch(url, size);
          return size;
        }
      }
      const net = await fromNetwork(url, entry, onProgress, signal);
      await store(url, net.bytes, net.layer);
      return net.bytes.length;
    },

    cleanup() {
      return serial(async () => {
        const storage = env.caches;
        if (storage === null) return;
        for (const name of await storage.keys()) {
          if (name.startsWith(CACHE_PREFIX) && name !== CACHE_NAME) await storage.delete(name);
        }
        const cache = await openCache();
        if (cache === null) return;
        const known = new Set(Object.values(manifest.assets).map((entry) => assetUrl(entry.path, env.origin)));
        const present = new Set<string>();
        for (const request of await cache.keys()) {
          if (request.url === indexUrl) continue;
          if (known.has(request.url)) present.add(request.url);
          else await cache.delete(request.url);
        }
        const rows = await readIndex(cache);
        const kept = rows.filter((e) => present.has(e.url));
        if (kept.length !== rows.length) await writeIndex(cache, kept);
      }).catch(() => undefined);
    },

    cachedIds() {
      return cachedTokenizerIds(env.caches, manifest.assets, env.origin);
    },
  };
}
