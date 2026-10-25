/**
 * `TokenizerClient` rules (04 §6, AD-19, AD-21) against a scripted fake Worker, and end to end against the real host
 * running in-process (fake fetch + in-memory Cache API + test engine).
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { CancelledError as CoreCancelledError, DEFAULT_OPTIONS, type TokenizerId } from '@tsbs/core';
import type { LoadedInfo, Progress } from '@tsbs/core/protocol';
import { cachedTokenizerIds } from '../src/cache-store.ts';
import {
  CancelledError,
  isCancelled,
  probeCachedTokenizers,
  shouldPrefetch,
  TokenizerClient,
  TokenizerError,
  WORKER_NAME,
} from '../src/client.ts';
import { createLoader } from '../src/loader.ts';
import {
  ENGINE_CONFIG,
  FakeCacheStorage,
  fakeFetch,
  HostWorker,
  loaderEnv,
  makeAsset,
  manifestOf,
  respond,
  ScriptedWorker,
  testEngine,
  tick,
  waitFor,
  type TestEngineOptions,
} from './helpers/fakes.ts';

const O200K: TokenizerId = 'openai-o200k_base';
const CL100K: TokenizerId = 'openai-cl100k_base';

function loadedInfo(id: TokenizerId): LoadedInfo {
  return {
    info: {
      id,
      family: 'bytelevel-bpe',
      vocabSize: 1,
      rankCount: 1,
      specials: [],
      bosId: null,
      unicodeVersion: '16.0.0',
      sourceSha256: '',
      supports: { nfkc: false, bos: false, specialsToggle: true },
    },
    fromCache: false,
    ms: 1,
    bytesTransferred: 1,
    contentEncoding: null,
    layer: 'gzip',
  };
}

/** A client over scripted Workers; `workers[n]` is the n-th spawned. */
function scripted(options: { watchdogMs?: number } = {}): { client: TokenizerClient; workers: ScriptedWorker[] } {
  const workers: ScriptedWorker[] = [];
  const client = new TokenizerClient(() => {
    const worker = new ScriptedWorker();
    workers.push(worker);
    return worker;
  }, options);
  return { client, workers };
}

function current(workers: ScriptedWorker[]): ScriptedWorker {
  const worker = workers.at(-1);
  if (worker === undefined) throw new Error('no worker');
  return worker;
}

/** Captures a promise's rejection. */
async function rejectionOf(promise: Promise<unknown>): Promise<unknown> {
  return promise.then(
    () => {
      throw new Error('expected a rejection');
    },
    (error: unknown) => error,
  );
}

afterEach(() => {
  vi.useRealTimers();
});

describe('TokenizerClient (scripted Worker)', () => {
  it('spawns once, says hello and resolves features and assets from ready', async () => {
    const { client, workers } = scripted();
    expect(workers).toHaveLength(1);
    expect(current(workers).posted).toEqual([{ type: 'hello', reqId: 1 }]);
    current(workers).emit({
      type: 'ready',
      reqId: 1,
      features: { cacheApi: false, segmenter: true, brotli: false, subtleCrypto: false },
      assets: { [O200K]: { path: '/tok/x.bin', bytesCompressed: 1, bytesRaw: 2 } } as never,
    });
    await expect(client.features).resolves.toEqual({
      cacheApi: false,
      segmenter: true,
      brotli: false,
      subtleCrypto: false,
    });
    await expect(client.assets).resolves.toEqual({ [O200K]: { path: '/tok/x.bin', bytesCompressed: 1, bytesRaw: 2 } });
    expect(WORKER_NAME).toBe('tsbs-tokenizer');
    client.terminate();
  });

  it('loads with progress, reports the resident tokenizer, and posts unload before load when switching (AD-19)', async () => {
    const { client, workers } = scripted();
    const worker = current(workers);
    worker.ready();
    const residents: Array<[TokenizerId | null, number]> = [];
    client.onResident((id) => residents.push([id, worker.posted.length]));
    const progress: Progress[] = [];
    const first = client.load(O200K, (p) => progress.push(p));
    const load = worker.last('load');
    worker.emit({
      type: 'progress',
      reqId: load.reqId,
      progress: { tokenizer: O200K, phase: 'download', loaded: 1, total: 2 },
    });
    worker.emit({ type: 'loaded', reqId: load.reqId, loaded: loadedInfo(O200K) });
    await expect(first).resolves.toMatchObject({ info: { id: O200K } });
    expect(progress).toHaveLength(1);
    expect(client.resident).toBe(O200K);

    const second = client.load(CL100K);
    const types = worker.posted.map((m) => m.type);
    expect(types.slice(-2)).toEqual(['unload', 'load']);
    // The resident became null (tables dropped) before `load` was posted.
    expect(residents).toEqual([
      [O200K, 2],
      [null, 3],
    ]);
    worker.emit({ type: 'unloaded', reqId: worker.last('unload').reqId });
    worker.emit({ type: 'loaded', reqId: worker.last('load').reqId, loaded: loadedInfo(CL100K) });
    await second;
    expect(client.resident).toBe(CL100K);
    const reqIds = worker.posted.map((m) => m.reqId);
    expect(reqIds).toEqual([...reqIds].sort((a, b) => a - b));
    expect(new Set(reqIds).size).toBe(reqIds.length);
    client.terminate();
  });

  it('a newer load supersedes an older one, which rejects as cancelled', async () => {
    const { client, workers } = scripted();
    const worker = current(workers);
    worker.ready();
    const first = client.load(O200K);
    const second = client.load(CL100K);
    const error = await rejectionOf(first);
    expect(error).toBeInstanceOf(CancelledError);
    worker.emit({ type: 'loaded', reqId: worker.last('load').reqId, loaded: loadedInfo(CL100K) });
    await expect(second).resolves.toMatchObject({ info: { id: CL100K } });
    client.terminate();
  });

  it('stamps seq, cancels every older encode (cancel.target) before posting the newer, and drops stale results', async () => {
    const { client, workers } = scripted();
    const worker = current(workers);
    worker.ready();
    const first = client.encode('a', DEFAULT_OPTIONS);
    const firstMessage = worker.last('encode');
    const second = client.encode('ab', DEFAULT_OPTIONS);
    const secondMessage = worker.last('encode');
    expect([firstMessage.seq, secondMessage.seq]).toEqual([1, 2]);
    expect(worker.posted.slice(-2)).toEqual([
      { type: 'cancel', reqId: secondMessage.reqId - 1, target: firstMessage.reqId },
      secondMessage,
    ]);
    expect(await rejectionOf(first)).toBeInstanceOf(CancelledError);
    // The Worker had already finished the first encode: its result (seq 1 < latest 2) is dropped.
    worker.emit({ type: 'result', reqId: firstMessage.reqId, seq: 1, result: { seq: 1 } as never });
    worker.emit({ type: 'cancelled', reqId: firstMessage.reqId });
    worker.emit({ type: 'result', reqId: secondMessage.reqId, seq: 2, result: { seq: 2, text: 'ab' } as never });
    await expect(second).resolves.toMatchObject({ seq: 2, text: 'ab' });
    client.terminate();
  });

  it('rejects a result whose seq is older than the latest even on its own reqId', async () => {
    const { client, workers } = scripted();
    const worker = current(workers);
    worker.ready();
    const pending = client.encode('a', DEFAULT_OPTIONS);
    const message = worker.last('encode');
    worker.emit({ type: 'result', reqId: message.reqId, seq: message.seq - 1, result: {} as never });
    expect(isCancelled(await rejectionOf(pending))).toBe(true);
    client.terminate();
  });

  it('an AbortSignal posts cancel with the encode reqId as target; an aborted signal never posts', async () => {
    const { client, workers } = scripted();
    const worker = current(workers);
    worker.ready();
    const controller = new AbortController();
    const pending = client.encode('a', DEFAULT_OPTIONS, undefined, controller.signal);
    const message = worker.last('encode');
    controller.abort();
    expect(worker.last('cancel').target).toBe(message.reqId);
    expect(await rejectionOf(pending)).toBeInstanceOf(CancelledError);
    const before = worker.posted.length;
    expect(await rejectionOf(client.encode('b', DEFAULT_OPTIONS, undefined, AbortSignal.abort()))).toBeInstanceOf(
      CancelledError,
    );
    expect(worker.posted.slice(before).map((m) => m.type)).toEqual([]);
    client.terminate();
  });

  it('`cancelled` is the only name: wire cancellations, supersession, aborts and terminate all reject with it', async () => {
    const { client, workers } = scripted();
    const worker = current(workers);
    worker.ready();
    const errors: unknown[] = [];
    const wire = client.encode('a', DEFAULT_OPTIONS);
    worker.emit({ type: 'cancelled', reqId: worker.last('encode').reqId });
    errors.push(await rejectionOf(wire));
    const superseded = client.encode('b', DEFAULT_OPTIONS);
    void client.encode('c', DEFAULT_OPTIONS).catch(() => undefined);
    errors.push(await rejectionOf(superseded));
    const load = client.load(O200K, undefined, AbortSignal.abort());
    errors.push(await rejectionOf(load));
    const outstanding = client.encode('d', DEFAULT_OPTIONS);
    client.terminate();
    errors.push(await rejectionOf(outstanding));
    for (const error of errors) {
      expect(error).toBeInstanceOf(CoreCancelledError); // the same class MockTokenizerClient throws
      expect((error as Error).name).toBe('cancelled');
      expect((error as Error).message).toBe('cancelled');
    }
    expect(CancelledError).toBe(CoreCancelledError);
  });

  it('maps wire errors to TokenizerError with code and retryable', async () => {
    const { client, workers } = scripted();
    const worker = current(workers);
    worker.ready();
    const pending = client.load(O200K);
    worker.emit({
      type: 'error',
      reqId: worker.last('load').reqId,
      code: 'integrity',
      message: 'bad',
      retryable: true,
    });
    const error = await rejectionOf(pending);
    expect(error).toBeInstanceOf(TokenizerError);
    expect(error).toMatchObject({ code: 'integrity', retryable: true, message: 'bad' });
    const encode = client.encode('x', DEFAULT_OPTIONS);
    worker.emit({
      type: 'error',
      reqId: worker.last('encode').reqId,
      code: 'not-loaded',
      message: 'n',
      retryable: false,
    });
    expect(await rejectionOf(encode)).toMatchObject({ code: 'not-loaded' });
    client.terminate();
  });

  it('lookup, prefetch (acked by a cache-phase progress) and unload', async () => {
    const { client, workers } = scripted();
    const worker = current(workers);
    worker.ready();
    const lookup = client.lookup({ ids: [1], bytes: Uint8Array.of(2) });
    expect(worker.last('lookup')).toMatchObject({ ids: [1], bytes: Uint8Array.of(2) });
    worker.emit({
      type: 'lookupResult',
      reqId: worker.last('lookup').reqId,
      entries: [{ id: 1, bytes: null, piece: null }],
    });
    await expect(lookup).resolves.toEqual([{ id: 1, bytes: null, piece: null }]);
    let prefetched = false;
    const prefetch = client.prefetch(CL100K).then(() => {
      prefetched = true;
    });
    const reqId = worker.last('prefetch').reqId;
    worker.emit({ type: 'progress', reqId, progress: { tokenizer: CL100K, phase: 'download', loaded: 1, total: 9 } });
    await tick();
    expect(prefetched).toBe(false);
    worker.emit({ type: 'progress', reqId, progress: { tokenizer: CL100K, phase: 'cache', loaded: 9, total: 9 } });
    await prefetch;
    const unload = client.unload();
    worker.emit({ type: 'unloaded', reqId: worker.last('unload').reqId });
    await expect(unload).resolves.toBeUndefined();
    expect(client.resident).toBeNull();
    client.terminate();
  });

  it('a Worker that never started (chunk missing after a deploy) fails with fetch, without a respawn loop', async () => {
    const { client, workers } = scripted();
    const pending = client.load(O200K);
    current(workers).crash('404');
    expect(await rejectionOf(pending)).toMatchObject({ code: 'fetch', retryable: false });
    expect(await rejectionOf(client.features)).toMatchObject({ code: 'fetch' });
    expect(workers).toHaveLength(1);
    client.terminate();
  });

  it('respawns once per tokenizer after a crash (replaying load), then surfaces oom', async () => {
    const { client, workers } = scripted();
    const first = current(workers);
    first.ready();
    const pending = client.load('xai-grok1');
    const encode = client.encode('x', DEFAULT_OPTIONS);
    first.crash();
    expect(first.terminated).toBe(true);
    expect(workers).toHaveLength(2);
    expect(await rejectionOf(encode)).toBeInstanceOf(CancelledError);
    const second = current(workers);
    expect(second.posted.map((m) => m.type)).toEqual(['hello', 'load']);
    expect(second.last('load').tokenizer).toBe('xai-grok1');
    second.crash(); // before its `ready`: the replayed load killed it — still a crash, not a failed start
    const error = await rejectionOf(pending);
    expect(error).toBeInstanceOf(TokenizerError);
    expect(error).toMatchObject({ code: 'oom', retryable: false });
    expect(workers).toHaveLength(2); // no loop
    // The back action (load the previous tokenizer) gets a fresh Worker.
    const back = client.load(O200K);
    expect(workers).toHaveLength(3);
    const third = current(workers);
    third.emit({ type: 'loaded', reqId: third.last('load').reqId, loaded: loadedInfo(O200K) });
    await expect(back).resolves.toMatchObject({ info: { id: O200K } });
    client.terminate();
  });

  it('a crash after the load replays it in the background, so the tokenizer becomes resident again', async () => {
    const { client, workers } = scripted();
    current(workers).ready();
    const load = client.load(O200K);
    current(workers).emit({ type: 'loaded', reqId: current(workers).last('load').reqId, loaded: loadedInfo(O200K) });
    await load;
    current(workers).crash();
    expect(client.resident).toBeNull();
    const replay = current(workers).last('load');
    current(workers).emit({ type: 'loaded', reqId: replay.reqId, loaded: loadedInfo(O200K) });
    expect(client.resident).toBe(O200K);
    client.terminate();
  });

  it('watchdog: two silent periods terminate, respawn, replay the load and cancel outstanding encodes', async () => {
    vi.useFakeTimers();
    const { client, workers } = scripted({ watchdogMs: 1000 });
    const worker = current(workers);
    worker.ready();
    const load = client.load(O200K);
    worker.emit({ type: 'loaded', reqId: worker.last('load').reqId, loaded: loadedInfo(O200K) });
    await load;
    const encode = client.encode('x', DEFAULT_OPTIONS);
    const rejected = rejectionOf(encode);
    vi.advanceTimersByTime(1000); // first period: heard recently → ping
    expect(worker.posted.filter((m) => m.type === 'ping')).toHaveLength(1);
    vi.advanceTimersByTime(1000); // no pong: one miss → ping again
    expect(workers).toHaveLength(1);
    vi.advanceTimersByTime(1000); // second miss → respawn
    expect(worker.terminated).toBe(true);
    expect(workers).toHaveLength(2);
    expect(await rejected).toBeInstanceOf(CancelledError);
    expect(current(workers).last('load').tokenizer).toBe(O200K);
    client.terminate();
  });

  it('watchdog: a pong is liveness, and a slow encode that posts progress is never pinged or killed', async () => {
    vi.useFakeTimers();
    const { client, workers } = scripted({ watchdogMs: 1000 });
    const worker = current(workers);
    worker.ready();
    const lookup = client.lookup({ ids: [1] });
    for (let i = 0; i < 5; i++) {
      vi.advanceTimersByTime(1000);
      const ping = worker.last('ping');
      worker.emit({
        type: 'pong',
        reqId: ping.reqId,
        resident: null,
        loading: null,
        encodeInFlight: false,
        heapHint: null,
      });
    }
    expect(workers).toHaveLength(1);
    worker.emit({ type: 'lookupResult', reqId: worker.last('lookup').reqId, entries: [] });
    await lookup;
    const pings = worker.posted.filter((m) => m.type === 'ping').length;
    const encode = client.encode('slow', DEFAULT_OPTIONS);
    const reqId = worker.last('encode').reqId;
    for (let t = 0; t < 60; t++) {
      vi.advanceTimersByTime(500);
      worker.emit({ type: 'progress', reqId, progress: { tokenizer: O200K, phase: 'encode', loaded: t, total: 60 } });
    }
    expect(workers).toHaveLength(1);
    expect(worker.posted.filter((m) => m.type === 'ping')).toHaveLength(pings);
    worker.emit({ type: 'result', reqId, seq: 1, result: { seq: 1 } as never });
    await expect(encode).resolves.toEqual({ seq: 1 });
    client.terminate();
  });

  it('after terminate every call fails fast', async () => {
    const { client } = scripted();
    client.terminate();
    expect(await rejectionOf(client.encode('a', DEFAULT_OPTIONS))).toMatchObject({ code: 'not-loaded' });
    expect(await rejectionOf(client.load(O200K))).toMatchObject({ code: 'not-loaded' });
    await expect(client.unload()).resolves.toBeUndefined();
  });
});

describe('prefetch rule and cache probe', () => {
  it('prefetches without the Network Information API or on 4g, never with saveData (AD-19)', () => {
    expect(shouldPrefetch(undefined)).toBe(true);
    expect(shouldPrefetch({ effectiveType: '4g' })).toBe(true);
    expect(shouldPrefetch({ effectiveType: '3g' })).toBe(false);
    expect(shouldPrefetch({ effectiveType: '4g', saveData: true })).toBe(false);
  });

  it('probes cache.keys() for the picker; no Cache API means nothing is downloaded', async () => {
    const storage = new FakeCacheStorage();
    const assets = { [O200K]: { path: '/tok/a/1.bin' }, [CL100K]: { path: '/tok/b/2.bin' } };
    expect(await cachedTokenizerIds(storage, assets, 'https://x.test')).toEqual([]);
    storage.cache().seed('https://x.test/tok/b/2.bin', Uint8Array.of(1));
    expect(await cachedTokenizerIds(storage, assets, 'https://x.test')).toEqual([CL100K]);
    expect(await cachedTokenizerIds(null, assets, 'https://x.test')).toEqual([]);
    expect(await probeCachedTokenizers(assets as never, 'https://x.test')).toEqual([]); // Node has no `caches`
  });
});

describe('TokenizerClient + host in-process', () => {
  async function stack(engine: TestEngineOptions = {}) {
    const asset = await makeAsset(O200K);
    const server = fakeFetch({ [asset.url]: respond(asset.gz) });
    const env = loaderEnv({ fetch: server.fetch, caches: new FakeCacheStorage() });
    const { factory, log } = testEngine(engine);
    const workers: HostWorker[] = [];
    const client = new TokenizerClient(() => {
      const worker = new HostWorker({
        manifest: manifestOf(asset),
        engineConfig: ENGINE_CONFIG,
        importEngine: () => Promise.resolve(factory),
        loader: createLoader(manifestOf(asset), env),
        features: () => Promise.resolve({ cacheApi: true, segmenter: true, brotli: false, subtleCrypto: true }),
      });
      workers.push(worker);
      return worker;
    });
    return { client, workers, server, log };
  }

  it('loads through the real loader, queues an encode issued during the load, and returns its result', async () => {
    const { client, workers } = await stack();
    const progress: Progress[] = [];
    const load = client.load(O200K, (p) => progress.push(p));
    const encode = client.encode('台灣台南', DEFAULT_OPTIONS);
    const loaded = await load;
    expect(loaded).toMatchObject({ fromCache: false, layer: 'gzip', info: { id: O200K } });
    const result = await encode;
    expect(result.text).toBe('台灣台南');
    expect(result.seq).toBe(1);
    const phases = progress.map((p) => p.phase).filter((p, i, all) => p !== all[i - 1]);
    expect(phases).toEqual(['download', 'verify', 'decompress', 'build']);
    const order = (workers[0]?.received ?? [])
      .map((r) => r.message.type)
      .filter((t) => t === 'loaded' || t === 'result');
    expect(order).toEqual(['loaded', 'result']);
    await client.unload();
    const again = await client.load(O200K);
    expect(again.fromCache).toBe(true);
    client.terminate();
  });

  it('cancel latency ≤ 10 ms on 20k CJK with a slow engine that yields every slice (median of 5)', async () => {
    const { client, workers } = await stack({ sliceMs: 4, charsPerSlice: 500 });
    await client.load(O200K);
    const text = '台灣台南'.repeat(5_000); // 20,000 CJK code points, one chunk
    const latencies: number[] = [];
    for (let trial = 0; trial < 5; trial++) {
      const worker = workers.at(-1);
      if (worker === undefined) throw new Error('no worker');
      const controller = new AbortController();
      const pending = client.encode(text, DEFAULT_OPTIONS, undefined, controller.signal).catch((e: unknown) => e);
      const start = worker.received.length;
      await waitFor(() => worker.received.slice(start).some((r) => r.message.type === 'progress'));
      // The user cancels 2 ms into a 4 ms slice; the timer can only run once the slice yields.
      const issuedAt = performance.now() + 2;
      setTimeout(() => {
        controller.abort();
      }, 2);
      await waitFor(() => worker.received.slice(start).some((r) => r.message.type === 'cancelled'));
      const cancelled = worker.received.slice(start).find((r) => r.message.type === 'cancelled');
      latencies.push((cancelled?.at ?? Number.POSITIVE_INFINITY) - issuedAt);
      expect(isCancelled(await pending)).toBe(true);
      expect(worker.received.slice(start).some((r) => r.message.type === 'result')).toBe(false);
    }
    latencies.sort((a, b) => a - b);
    if (process.env['TSBS_PERF'] === '1')
      console.info(`cancel latency (ms): ${latencies.map((l) => l.toFixed(2)).join(' ')}`);
    expect(latencies[2]).toBeLessThanOrEqual(10);
    client.terminate();
  });
});
