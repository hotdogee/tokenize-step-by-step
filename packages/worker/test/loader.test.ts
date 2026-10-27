/**
 * Loader unit tests with a fake `fetch` and an in-memory Cache API (03 §C.6, AD-37): content sniffing of the gzip and
 * raw layers, both SHA-256 paths, the relative-resolution regression, quota fallbacks, LRU eviction and cleanup.
 */
import { describe, expect, it } from 'vitest';
import type { Progress } from '@tsbs/core/protocol';
import { assetUrl } from '../src/cache-store.ts';
import { TokenizerError } from '../src/errors.ts';
import { createLoader, DEFAULT_LIMITS, sniffLayer, type LoaderProgress } from '../src/loader.ts';
import {
  FakeCacheStorage,
  fakeFetch,
  loaderEnv,
  makeAsset,
  manifestOf,
  ORIGIN,
  respond,
  type TestAsset,
} from './helpers/fakes.ts';

interface Event {
  readonly phase: Progress['phase'];
  readonly loaded: number;
  readonly total: number | null;
}

function recorder(): { events: Event[]; onProgress: LoaderProgress } {
  const events: Event[] = [];
  return { events, onProgress: (phase, loaded, total) => events.push({ phase, loaded, total }) };
}

function flipped(bytes: Uint8Array<ArrayBuffer>, at = Math.floor(bytes.length / 2)): Uint8Array<ArrayBuffer> {
  const copy = bytes.slice();
  copy[at] = (copy[at] ?? 0) ^ 0xff;
  return copy;
}

async function rejection(promise: Promise<unknown>): Promise<TokenizerError> {
  const error: unknown = await promise.then(
    () => null,
    (e: unknown) => e,
  );
  expect(error).toBeInstanceOf(TokenizerError);
  return error as TokenizerError;
}

/** A loader over one asset served by `route` (default: the gzip file). */
async function setup(options: { asset?: TestAsset; route?: ReturnType<typeof respond> } = {}) {
  const asset = options.asset ?? (await makeAsset());
  const server = fakeFetch({ [asset.url]: options.route ?? respond(asset.gz) });
  const storage = new FakeCacheStorage();
  const loader = createLoader(manifestOf(asset), loaderEnv({ fetch: server.fetch, caches: storage }));
  return { asset, server, storage, loader };
}

describe('content sniffing (AD-37)', () => {
  it('classifies the bytes, never a header', async () => {
    const asset = await makeAsset();
    expect(sniffLayer(asset.gz)).toBe('gzip');
    expect(sniffLayer(asset.raw)).toBe('raw');
    expect(sniffLayer(Uint8Array.of(1, 2, 3, 4))).toBeNull();
    expect(sniffLayer(new Uint8Array(0))).toBeNull();
  });

  it('gzip layer: downloads with monotone progress and an exact total, verifies sha256, gunzips', async () => {
    const { asset, server, loader } = await setup();
    const { events, onProgress } = recorder();
    const fetched = await loader.load('openai-o200k_base', onProgress);
    expect(new Uint8Array(fetched.container)).toEqual(asset.raw);
    expect(fetched).toMatchObject({ layer: 'gzip', fromCache: false, contentEncoding: null });
    expect(fetched.bytesTransferred).toBe(asset.gz.length);
    expect(server.calls).toEqual([asset.url]);
    const download = events.filter((e) => e.phase === 'download');
    expect(download.length).toBeGreaterThan(1);
    for (let i = 1; i < download.length; i++) {
      expect(download[i]?.loaded).toBeGreaterThanOrEqual(download[i - 1]?.loaded ?? 0);
    }
    expect(download.every((e) => e.total === asset.gz.length)).toBe(true);
    expect(download.at(-1)?.loaded).toBe(asset.gz.length);
    expect(events.map((e) => e.phase).filter((p, i, all) => p !== all[i - 1])).toEqual([
      'download',
      'verify',
      'decompress',
    ]);
    expect(events.filter((e) => e.phase === 'decompress').at(-1)).toEqual({
      phase: 'decompress',
      loaded: asset.raw.length,
      total: asset.raw.length,
    });
  });

  it('gzip layer under an edge encoding: Content-Length is ignored, the manifest is the denominator', async () => {
    const asset = await makeAsset();
    const { loader } = await setup({
      asset,
      route: respond(asset.gz, { headers: { 'content-encoding': 'br', 'content-length': '17' } }),
    });
    const { events, onProgress } = recorder();
    const fetched = await loader.load('openai-o200k_base', onProgress);
    expect(fetched).toMatchObject({ layer: 'gzip', contentEncoding: 'br' });
    expect(new Uint8Array(fetched.container)).toEqual(asset.raw);
    const download = events.filter((e) => e.phase === 'download');
    expect(download.every((e) => e.total === asset.entry.bytesCompressed)).toBe(true);
  });

  it('raw layer (transparently decoded body): verified against sha256Raw and used as-is', async () => {
    const asset = await makeAsset();
    const { loader } = await setup({
      asset,
      route: respond(asset.raw, { headers: { 'content-encoding': 'gzip', 'content-length': String(asset.gz.length) } }),
    });
    const { events, onProgress } = recorder();
    const fetched = await loader.load('openai-o200k_base', onProgress);
    expect(fetched.layer).toBe('raw');
    expect(new Uint8Array(fetched.container)).toEqual(asset.raw);
    expect(events.some((e) => e.phase === 'decompress')).toBe(false);
    const download = events.filter((e) => e.phase === 'download');
    for (let i = 1; i < download.length; i++) {
      expect(download[i]?.loaded).toBeGreaterThanOrEqual(download[i - 1]?.loaded ?? 0);
    }
    // The body outgrew the announced size, so the denominator ends at what arrived.
    expect(download.at(-1)).toEqual({ phase: 'download', loaded: asset.raw.length, total: asset.raw.length });
  });

  it('bad magic: neither gzip nor TSBV is a non-retryable format error', async () => {
    const asset = await makeAsset();
    const { loader, storage } = await setup({ asset, route: respond(Uint8Array.from([1, 2, 3, 4, 5, 6, 7, 8])) });
    const error = await rejection(loader.load('openai-o200k_base', () => undefined));
    expect(error).toMatchObject({ code: 'format', retryable: false });
    expect(storage.cache().store.size).toBe(0);
  });
});

describe('integrity (both sha paths)', () => {
  it('a corrupted gzip file fails sha256 twice (one automatic refetch) and is never cached', async () => {
    const asset = await makeAsset();
    const { loader, server, storage } = await setup({ asset, route: respond(flipped(asset.gz)) });
    const error = await rejection(loader.load('openai-o200k_base', () => undefined));
    expect(error).toMatchObject({ code: 'integrity', retryable: true });
    expect(error.message).toMatch(/gzip layer/);
    expect(server.calls).toEqual([asset.url, asset.url]);
    expect(storage.cache().store.has(asset.url)).toBe(false);
  });

  it('a corrupted raw container fails sha256Raw', async () => {
    const asset = await makeAsset();
    const { loader } = await setup({ asset, route: respond(flipped(asset.raw, 20)) });
    const error = await rejection(loader.load('openai-o200k_base', () => undefined));
    expect(error).toMatchObject({ code: 'integrity', retryable: true });
    expect(error.message).toMatch(/raw layer/);
  });

  it('the automatic refetch recovers from one bad response', async () => {
    const asset = await makeAsset();
    const { loader, server } = await setup({ asset });
    let first = true;
    server.routes.set(asset.url, () => {
      const route = first ? respond(flipped(asset.gz)) : respond(asset.gz);
      first = false;
      return route();
    });
    const fetched = await loader.load('openai-o200k_base', () => undefined);
    expect(new Uint8Array(fetched.container)).toEqual(asset.raw);
    expect(fetched.bytesTransferred).toBe(2 * asset.gz.length);
  });

  it('without crypto.subtle (insecure context) verification is skipped', async () => {
    const asset = await makeAsset();
    // A gzip file whose sha256 differs from the manifest's but which still decompresses: re-gzip the raw container
    // with a different header byte (mtime) so the bytes differ.
    const other = asset.gz.slice();
    other[4] = 0x7f;
    const server = fakeFetch({ [asset.url]: respond(other) });
    const loader = createLoader(manifestOf(asset), loaderEnv({ fetch: server.fetch, subtle: null }));
    const { events, onProgress } = recorder();
    const fetched = await loader.load('openai-o200k_base', onProgress);
    expect(new Uint8Array(fetched.container)).toEqual(asset.raw);
    expect(events.some((e) => e.phase === 'verify')).toBe(false);
  });
});

describe('URLs and fetch errors', () => {
  it('resolves root-relative manifest paths against the origin: /tok/... never lands under /assets/', async () => {
    const asset = await makeAsset();
    expect(asset.entry.path.startsWith('/tok/')).toBe(true);
    // The Worker script lives at /assets/entry-<hash>.js; a relative resolution against it would give /assets/tok/….
    expect(assetUrl(asset.entry.path, 'https://tsbs.test/assets/entry-abc123.js')).toBe(
      `https://tsbs.test${asset.entry.path}`,
    );
    expect(new URL(asset.entry.path.slice(1), 'https://tsbs.test/assets/entry-abc123.js').href).toContain('/assets/');
    const { loader, server, storage } = await setup({ asset });
    const fetched = await loader.load('openai-o200k_base', () => undefined);
    await fetched.commit();
    expect(server.calls).toEqual([`${ORIGIN}${asset.entry.path}`]);
    expect(server.calls.some((url) => url.includes('/assets/'))).toBe(false);
    expect([...storage.cache().store.keys()]).toContain(`${ORIGIN}${asset.entry.path}`);
  });

  it('maps HTTP and network failures to fetch errors (404 = stale client, not retryable)', async () => {
    const asset = await makeAsset();
    const notFound = await setup({ asset, route: respond(asset.gz, { status: 404 }) });
    expect(await rejection(notFound.loader.load('openai-o200k_base', () => undefined))).toMatchObject({
      code: 'fetch',
      retryable: false,
    });
    const unavailable = await setup({ asset, route: respond(asset.gz, { status: 503 }) });
    expect(await rejection(unavailable.loader.load('openai-o200k_base', () => undefined))).toMatchObject({
      code: 'fetch',
      retryable: true,
    });
    const offline = createLoader(
      manifestOf(asset),
      loaderEnv({ fetch: () => Promise.reject(new TypeError('Failed to fetch')) }),
    );
    expect(await rejection(offline.load('openai-o200k_base', () => undefined))).toMatchObject({
      code: 'fetch',
      retryable: true,
    });
    expect(await rejection(offline.load('xai-grok1', () => undefined))).toMatchObject({
      code: 'fetch',
      retryable: false,
    });
  });
});

describe('Cache API', () => {
  it('commits the verified bytes, then serves the next load from the cache', async () => {
    const { asset, server, storage, loader } = await setup();
    const first = await loader.load('openai-o200k_base', () => undefined);
    void first.commit(); // queued: the next load waits for it
    const { events, onProgress } = recorder();
    const second = await loader.load('openai-o200k_base', onProgress);
    expect(second).toMatchObject({ fromCache: true, bytesTransferred: 0, layer: 'gzip' });
    expect(new Uint8Array(second.container)).toEqual(asset.raw);
    expect(server.calls).toHaveLength(1);
    expect(events[0]).toEqual({ phase: 'cache', loaded: asset.gz.length, total: asset.gz.length });
    expect(events.some((e) => e.phase === 'verify')).toBe(false); // verified when stored
    const stored = storage.cache().store.get(asset.url);
    expect(stored?.body).toEqual(asset.gz);
    expect(stored?.headers['x-tsbs-layer']).toBe('gzip');
    expect((await storage.cache().index()).map((e) => e.url)).toEqual([asset.url]);
    expect(await loader.cachedIds()).toEqual(['openai-o200k_base']);
  });

  it('evicts an unusable cached body and refetches it', async () => {
    const { asset, server, storage, loader } = await setup();
    storage.cache().seed(asset.url, Uint8Array.of(0x1f, 0x8b, 0, 0, 0)); // a truncated gzip file
    const fetched = await loader.load('openai-o200k_base', () => undefined);
    expect(fetched.fromCache).toBe(false);
    expect(server.calls).toHaveLength(1);
    expect(storage.cache().store.has(asset.url)).toBe(false);
    await fetched.commit();
    expect(storage.cache().store.get(asset.url)?.body).toEqual(asset.gz);
  });

  it('quota fallback: a low estimate or a failing put leaves the load memory-only', async () => {
    const asset = await makeAsset();
    const server = fakeFetch({ [asset.url]: respond(asset.gz) });
    const lowStorage = new FakeCacheStorage();
    const low = createLoader(
      manifestOf(asset),
      loaderEnv({
        fetch: server.fetch,
        caches: lowStorage,
        estimate: () => Promise.resolve({ quota: 1_000_000, usage: 1_000_000 - asset.gz.length }),
      }),
    );
    await (await low.load('openai-o200k_base', () => undefined)).commit();
    expect(lowStorage.cache().store.has(asset.url)).toBe(false);

    const fullStorage = new FakeCacheStorage();
    fullStorage.cache().failPuts = true;
    const full = createLoader(manifestOf(asset), loaderEnv({ fetch: server.fetch, caches: fullStorage }));
    const fetched = await full.load('openai-o200k_base', () => undefined);
    await expect(fetched.commit()).resolves.toBeUndefined();
    expect(new Uint8Array(fetched.container)).toEqual(asset.raw);
    expect(fullStorage.cache().store.has(asset.url)).toBe(false);

    const privateMode = new FakeCacheStorage();
    privateMode.failOpen = true;
    const memoryOnly = createLoader(manifestOf(asset), loaderEnv({ fetch: server.fetch, caches: privateMode }));
    const again = await memoryOnly.load('openai-o200k_base', () => undefined);
    await again.commit();
    expect(new Uint8Array(again.container)).toEqual(asset.raw);
    expect(await memoryOnly.cachedIds()).toEqual([]);
  });

  it('keeps every local tokenizer by default: nine entries (PA-19, 03 §C.6 step 9)', async () => {
    const ids = [
      'openai-o200k_base',
      'openai-cl100k_base',
      'anthropic-claude-legacy',
      'google-gemma4',
      'google-gemma2',
      'meta-llama4-muse',
      'meta-llama3',
      'xai-grok2',
      'xai-grok1',
    ] as const;
    expect(DEFAULT_LIMITS.maxEntries).toBe(ids.length);
    const assets = await Promise.all(ids.map((id) => makeAsset(id)));
    const server = fakeFetch(Object.fromEntries(assets.map((a) => [a.url, respond(a.gz)])));
    const storage = new FakeCacheStorage();
    const loader = createLoader(manifestOf(...assets), loaderEnv({ fetch: server.fetch, caches: storage }));
    for (const id of ids) await (await loader.load(id, () => undefined)).commit();
    expect((await storage.cache().index()).map((e) => e.url)).toEqual(assets.map((a) => a.url));
    expect(assets.every((a) => storage.cache().store.has(a.url))).toBe(true);
  });

  it('evicts the least recently used tokenizer beyond the entry limit; a cache hit refreshes recency', async () => {
    const ids = ['openai-o200k_base', 'openai-cl100k_base', 'meta-llama3', 'xai-grok2'] as const;
    const assets = await Promise.all(ids.map((id) => makeAsset(id)));
    const server = fakeFetch(Object.fromEntries(assets.map((a) => [a.url, respond(a.gz)])));
    const storage = new FakeCacheStorage();
    const loader = createLoader(manifestOf(...assets), loaderEnv({ fetch: server.fetch, caches: storage }), {
      ...DEFAULT_LIMITS,
      maxEntries: 3,
    });
    const [a, b, c, d] = assets;
    for (const id of ids.slice(0, 3)) await (await loader.load(id, () => undefined)).commit();
    await (await loader.load('openai-o200k_base', () => undefined)).commit(); // hit: A becomes most recent
    await (await loader.load('xai-grok2', () => undefined)).commit();
    const cached = storage.cache().store;
    expect(cached.has(a?.url ?? '')).toBe(true);
    expect(cached.has(b?.url ?? '')).toBe(false); // least recently used
    expect(cached.has(c?.url ?? '')).toBe(true);
    expect(cached.has(d?.url ?? '')).toBe(true);
    expect((await storage.cache().index()).map((e) => e.url)).toEqual([c?.url, a?.url, d?.url]);
  });

  it('keeps the cached total under the byte limit', async () => {
    const ids = ['openai-o200k_base', 'openai-cl100k_base', 'meta-llama3'] as const;
    const assets = await Promise.all(ids.map((id) => makeAsset(id)));
    const server = fakeFetch(Object.fromEntries(assets.map((x) => [x.url, respond(x.gz)])));
    const storage = new FakeCacheStorage();
    const lastTwo = (assets[1]?.gz.length ?? 0) + (assets[2]?.gz.length ?? 0);
    const loader = createLoader(manifestOf(...assets), loaderEnv({ fetch: server.fetch, caches: storage }), {
      maxEntries: 10,
      maxBytes: lastTwo,
    });
    for (const id of ids) await (await loader.load(id, () => undefined)).commit();
    expect((await storage.cache().index()).map((e) => e.url)).toEqual([assets[1]?.url, assets[2]?.url]);
    expect(storage.cache().store.has(assets[0]?.url ?? '')).toBe(false);
  });

  it('startup cleanup deletes other cache versions and entries this build does not reference', async () => {
    const { asset, storage, loader } = await setup();
    storage.cache('tsbs-tok-v0').seed(`${ORIGIN}/tok/old.bin`, Uint8Array.of(1));
    storage.cache('unrelated').seed(`${ORIGIN}/x`, Uint8Array.of(1));
    storage.cache().seed(`${ORIGIN}/tok/openai-o200k_base/000000000000.bin`, Uint8Array.of(1));
    await (await loader.load('openai-o200k_base', () => undefined)).commit();
    await loader.cleanup();
    expect([...storage.caches.keys()].sort()).toEqual(['tsbs-tok-v1', 'unrelated']);
    expect([...storage.cache().store.keys()].sort()).toEqual([`${ORIGIN}/__tsbs-index`, asset.url].sort());
  });

  it('prefetch downloads, verifies and caches without decompressing; a cached asset is not refetched', async () => {
    const { asset, server, storage, loader } = await setup();
    const { events, onProgress } = recorder();
    expect(await loader.prefetch('openai-o200k_base', onProgress)).toBe(asset.gz.length);
    expect(storage.cache().store.get(asset.url)?.body).toEqual(asset.gz);
    expect(events.some((e) => e.phase === 'decompress')).toBe(false);
    expect(await loader.prefetch('openai-o200k_base', () => undefined)).toBe(asset.gz.length);
    expect(server.calls).toHaveLength(1);
  });
});
