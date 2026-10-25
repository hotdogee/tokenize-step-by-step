/**
 * Host rules (04 §6, FROZEN; AD-19, AD-21) with a hand-driven loader and a test engine that yields between slices.
 */
import { describe, expect, it, vi } from 'vitest';
import { DEFAULT_OPTIONS, type TokenizerId } from '@tsbs/core';
import type { FromWorker } from '@tsbs/core/protocol';
import { assetSummary } from '../src/host.ts';
import { TokenizerError } from '../src/errors.ts';
import { fakeAsset, hostWith, testEngine, tick, waitFor } from './helpers/fakes.ts';

const O200K: TokenizerId = 'openai-o200k_base';
const CL100K: TokenizerId = 'openai-cl100k_base';

function encode(reqId: number, text = 'abc', seq = reqId) {
  return { type: 'encode', reqId, seq, text, options: DEFAULT_OPTIONS } as const;
}

function ofType<T extends FromWorker['type']>(posted: FromWorker[], type: T): Array<Extract<FromWorker, { type: T }>> {
  return posted.filter((m): m is Extract<FromWorker, { type: T }> => m.type === type);
}

/** Loads `id` to residency through the fake loader. */
async function loadResident(setup: ReturnType<typeof hostWith>, id: TokenizerId, reqId: number): Promise<void> {
  setup.host.handle({ type: 'load', reqId, tokenizer: id });
  setup.loader.finish(id);
  await waitFor(() => setup.posted.some((m) => m.type === 'loaded' && m.reqId === reqId));
}

describe('hello / ping', () => {
  it('answers hello with features and the asset summary of the bundled manifest; cleans the cache once', async () => {
    const cleanup = vi.fn(() => Promise.resolve());
    const setup = hostWith({
      manifest: {
        schema: 1,
        builtOn: 'x',
        generator: 'x',
        assets: {
          [O200K]: {
            path: '/tok/openai-o200k_base/aaaaaaaaaaaa.bin',
            format: 'tsbv1',
            family: 'bytelevel-bpe',
            encoding: 'gzip',
            bytesCompressed: 10,
            bytesRaw: 20,
            sha256: 's',
            sha256Raw: 'r',
            upstream: { assetId: O200K, file: 'f', sha256: 'u', url: 'u', revision: 'r', retrievedOn: 'd' },
            counts: { pieces: 1, specials: 1 },
          },
        },
      },
    });
    Object.assign(setup.loader, { cleanup });
    setup.host.handle({ type: 'hello', reqId: 1 });
    setup.host.handle({ type: 'hello', reqId: 2 });
    await waitFor(() => setup.posted.length === 2);
    expect(setup.posted[0]).toEqual({
      type: 'ready',
      reqId: 1,
      features: { cacheApi: true, segmenter: true, brotli: false, subtleCrypto: true },
      assets: { [O200K]: { path: '/tok/openai-o200k_base/aaaaaaaaaaaa.bin', bytesCompressed: 10, bytesRaw: 20 } },
    });
    expect(cleanup).toHaveBeenCalledTimes(1);
  });

  it('pong reports resident, loading, encodeInFlight and a null heapHint (browsers, rule 7)', async () => {
    const setup = hostWith();
    setup.host.handle({ type: 'ping', reqId: 1 });
    setup.host.handle({ type: 'load', reqId: 2, tokenizer: O200K });
    setup.host.handle({ type: 'ping', reqId: 3 });
    expect(ofType(setup.posted, 'pong')).toEqual([
      { type: 'pong', reqId: 1, resident: null, loading: null, encodeInFlight: false, heapHint: null },
      { type: 'pong', reqId: 3, resident: null, loading: O200K, encodeInFlight: false, heapHint: null },
    ]);
    setup.loader.finish(O200K);
    await waitFor(() => ofType(setup.posted, 'loaded').length === 1);
    setup.host.handle({ type: 'ping', reqId: 4 });
    expect(ofType(setup.posted, 'pong').at(-1)).toMatchObject({ resident: O200K, loading: null });
  });

  it('assetSummary keeps path and sizes only', () => {
    expect(assetSummary({ schema: 1, builtOn: 'x', generator: 'x', assets: {} })).toEqual({});
  });
});

describe('loading', () => {
  it('imports the engine lazily, per family, on the first load only', async () => {
    const { factory } = testEngine();
    const importEngine = vi.fn(() => Promise.resolve(factory));
    const setup = hostWith({ importEngine });
    setup.host.handle({ type: 'hello', reqId: 1 });
    await tick();
    expect(importEngine).not.toHaveBeenCalled();
    await loadResident(setup, O200K, 2);
    expect(importEngine).toHaveBeenCalledWith('bytelevel-bpe');
    const loaded = ofType(setup.posted, 'loaded')[0];
    expect(loaded?.loaded).toMatchObject({
      fromCache: false,
      bytesTransferred: 1000,
      layer: 'gzip',
      contentEncoding: null,
    });
    expect(loaded?.loaded.info.id).toBe(O200K);
    const phases = ofType(setup.posted, 'progress').map((m) => m.progress.phase);
    expect(phases).toEqual(['build', 'build', 'build']);
  });

  it('a load while another is in flight supersedes it: the older loaded never arrives', async () => {
    const setup = hostWith();
    setup.host.handle({ type: 'load', reqId: 1, tokenizer: O200K });
    setup.host.handle({ type: 'load', reqId: 2, tokenizer: CL100K });
    expect(setup.loader.loads[0]?.signal?.aborted).toBe(true);
    setup.loader.finish(O200K);
    setup.loader.finish(CL100K);
    await waitFor(() => ofType(setup.posted, 'loaded').length === 1);
    await tick();
    expect(ofType(setup.posted, 'loaded').map((m) => [m.reqId, m.loaded.info.id])).toEqual([[2, CL100K]]);
    expect(setup.log.created.map((c) => c.id)).toEqual([CL100K]);
  });

  it('a newer load of the tokenizer already loading takes over the in-flight load', async () => {
    const setup = hostWith();
    setup.host.handle({ type: 'load', reqId: 1, tokenizer: O200K });
    setup.host.handle({ type: 'load', reqId: 2, tokenizer: O200K });
    expect(setup.loader.loads).toHaveLength(1);
    setup.loader.finish(O200K);
    await waitFor(() => ofType(setup.posted, 'loaded').length === 1);
    expect(ofType(setup.posted, 'loaded')[0]?.reqId).toBe(2);
  });

  it('strict one-resident: the old tables are released before the new load starts (test hook)', async () => {
    const events: string[] = [];
    const setup = hostWith({
      hooks: {
        onRelease: (id) => events.push(`release ${id}`),
        onLoadStart: ({ tokenizer, tablesReleased }) =>
          events.push(`load ${tokenizer} released=${String(tablesReleased)}`),
      },
    });
    await loadResident(setup, O200K, 1);
    setup.host.handle({ type: 'load', reqId: 2, tokenizer: CL100K }); // no unload first: the host still releases
    expect(events).toEqual([`load ${O200K} released=true`, `release ${O200K}`, `load ${CL100K} released=true`]);
    expect(setup.log.disposed).toEqual([O200K]);
    setup.host.handle({ type: 'ping', reqId: 3 });
    expect(ofType(setup.posted, 'pong')[0]).toMatchObject({ resident: null, loading: CL100K });
  });

  it('reloading the resident tokenizer answers at once', async () => {
    const setup = hostWith();
    await loadResident(setup, O200K, 1);
    setup.host.handle({ type: 'load', reqId: 2, tokenizer: O200K });
    expect(ofType(setup.posted, 'loaded').at(-1)).toMatchObject({ reqId: 2, loaded: { fromCache: true, ms: 0 } });
    expect(setup.loader.loads).toHaveLength(1);
  });

  it('maps load failures: loader errors keep their code, a RangeError while building is oom, a bad container is format', async () => {
    const setup = hostWith();
    setup.host.handle({ type: 'load', reqId: 1, tokenizer: O200K });
    setup.loader.loads[0]?.reject(new TokenizerError('integrity', 'bad sha', true));
    await waitFor(() => ofType(setup.posted, 'error').length === 1);
    expect(ofType(setup.posted, 'error')[0]).toEqual({
      type: 'error',
      reqId: 1,
      code: 'integrity',
      message: 'bad sha',
      retryable: true,
    });

    const oom = hostWith({
      importEngine: () =>
        Promise.resolve(() => {
          throw new RangeError('Array buffer allocation failed');
        }),
    });
    await loadAndFail(oom, 'oom', true);

    const format = hostWith();
    format.host.handle({ type: 'load', reqId: 1, tokenizer: O200K });
    format.loader.loads[0]?.resolve({ ...fakeAsset(O200K), container: new ArrayBuffer(16) });
    await waitFor(() => ofType(format.posted, 'error').length === 1);
    expect(ofType(format.posted, 'error')[0]).toMatchObject({ code: 'format', retryable: false });

    const missing = hostWith();
    missing.host.handle({ type: 'load', reqId: 1, tokenizer: 'xai-grok1' });
    await waitFor(() => ofType(missing.posted, 'error').length === 1);
    expect(ofType(missing.posted, 'error')[0]).toMatchObject({ code: 'internal' });
  });

  it('refetches once when a cached container no longer decodes', async () => {
    const evict = vi.fn(() => Promise.resolve());
    const setup = hostWith();
    setup.host.handle({ type: 'load', reqId: 1, tokenizer: O200K });
    setup.loader.loads[0]?.resolve({ ...fakeAsset(O200K, true), container: new ArrayBuffer(16), evict });
    await waitFor(() => setup.loader.loads.length === 2);
    expect(evict).toHaveBeenCalledTimes(1);
    setup.loader.finish(O200K);
    await waitFor(() => ofType(setup.posted, 'loaded').length === 1);
    expect(ofType(setup.posted, 'loaded')[0]?.loaded.fromCache).toBe(false);
  });

  it('unload releases the engine, aborts a load in flight and cancels the pending encode', async () => {
    const setup = hostWith();
    await loadResident(setup, O200K, 1);
    setup.host.handle({ type: 'load', reqId: 2, tokenizer: CL100K });
    setup.host.handle(encode(3));
    setup.host.handle({ type: 'unload', reqId: 4 });
    expect(setup.loader.loads[1]?.signal?.aborted).toBe(true);
    expect(setup.posted.slice(-2)).toEqual([
      { type: 'cancelled', reqId: 3 },
      { type: 'unloaded', reqId: 4 },
    ]);
    setup.loader.finish(CL100K);
    await tick();
    await tick();
    expect(ofType(setup.posted, 'loaded')).toHaveLength(1);
    expect(setup.log.disposed).toEqual([O200K]);
  });
});

/** Starts a load whose build fails and checks the wire error. */
async function loadAndFail(setup: ReturnType<typeof hostWith>, code: string, retryable: boolean): Promise<void> {
  setup.host.handle({ type: 'load', reqId: 1, tokenizer: O200K });
  setup.loader.finish(O200K);
  await waitFor(() => ofType(setup.posted, 'error').length === 1);
  expect(ofType(setup.posted, 'error')[0]).toMatchObject({ reqId: 1, code, retryable });
}

describe('encoding', () => {
  it('not-loaded only when nothing is resident and nothing is loading', () => {
    const setup = hostWith();
    setup.host.handle(encode(1));
    expect(setup.posted).toEqual([
      { type: 'error', reqId: 1, code: 'not-loaded', message: 'no tokenizer is loaded', retryable: false },
    ]);
    setup.host.handle({ type: 'load', reqId: 2, tokenizer: O200K });
    setup.host.handle(encode(3));
    expect(ofType(setup.posted, 'error')).toHaveLength(1);
  });

  it('an encode during a load is queued and runs after loaded; a newer one replaces it', async () => {
    const setup = hostWith();
    setup.host.handle({ type: 'load', reqId: 1, tokenizer: O200K });
    setup.host.handle(encode(2, 'first'));
    setup.host.handle(encode(3, 'second'));
    expect(setup.posted).toEqual([{ type: 'cancelled', reqId: 2 }]);
    setup.loader.finish(O200K);
    await waitFor(() => ofType(setup.posted, 'result').length === 1);
    const order = setup.posted.filter((m) => m.type !== 'progress').map((m) => `${m.type}:${String(m.reqId)}`);
    expect(order).toEqual(['cancelled:2', 'loaded:1', 'result:3']);
    const result = ofType(setup.posted, 'result')[0];
    expect(result?.seq).toBe(3);
    expect(result?.result.seq).toBe(3);
    expect(result?.result.text).toBe('second');
  });

  it('a failed load answers the queued encode with not-loaded', async () => {
    const setup = hostWith();
    setup.host.handle({ type: 'load', reqId: 1, tokenizer: O200K });
    setup.host.handle(encode(2));
    setup.loader.loads[0]?.reject(new TokenizerError('fetch', 'offline', true));
    await waitFor(() => ofType(setup.posted, 'error').length === 2);
    expect(ofType(setup.posted, 'error').map((m) => [m.reqId, m.code])).toEqual([
      [1, 'fetch'],
      [2, 'not-loaded'],
    ]);
  });

  it('runs one encode and keeps one pending; posts encode progress every slice', async () => {
    const { factory } = testEngine({ sliceMs: 1, charsPerSlice: 2 });
    const setup = hostWith({ importEngine: () => Promise.resolve(factory) });
    await loadResident(setup, O200K, 1);
    setup.posted.length = 0;
    setup.host.handle(encode(2, 'abcdefghij'));
    setup.host.handle(encode(3, 'xx'));
    setup.host.handle(encode(4, 'yy'));
    expect(setup.posted.filter((m) => m.type !== 'progress')).toEqual([{ type: 'cancelled', reqId: 3 }]);
    await waitFor(() => ofType(setup.posted, 'result').length === 2);
    expect(ofType(setup.posted, 'result').map((m) => m.reqId)).toEqual([2, 4]);
    const progress = ofType(setup.posted, 'progress').filter((m) => m.reqId === 2);
    expect(progress.map((m) => m.progress)).toEqual(
      [2, 4, 6, 8].map((loaded) => ({
        tokenizer: O200K,
        phase: 'encode',
        loaded,
        total: 10,
      })),
    );
  });

  it('cancel.target drops a pending encode at once and stops an in-flight one at its next yield — one cancelled each', async () => {
    const { factory, log } = testEngine({ sliceMs: 1, charsPerSlice: 1 });
    const setup = hostWith({ importEngine: () => Promise.resolve(factory) });
    await loadResident(setup, O200K, 1);
    setup.posted.length = 0;
    setup.host.handle(encode(2, 'a'.repeat(50)));
    setup.host.handle(encode(3));
    setup.host.handle({ type: 'cancel', reqId: 4, target: 3 }); // pending
    expect(setup.posted.filter((m) => m.type !== 'progress')).toEqual([{ type: 'cancelled', reqId: 3 }]);
    setup.host.handle({ type: 'cancel', reqId: 5, target: 2 }); // in flight
    setup.host.handle({ type: 'cancel', reqId: 6, target: 2 }); // twice: still one cancelled
    setup.host.handle({ type: 'cancel', reqId: 7, target: 99 }); // unknown: ignored
    await waitFor(() => ofType(setup.posted, 'cancelled').length === 2);
    await tick();
    expect(ofType(setup.posted, 'cancelled').map((m) => m.reqId)).toEqual([3, 2]);
    expect(ofType(setup.posted, 'result')).toHaveLength(0);
    expect(log.slices).toEqual([]); // the in-flight encode never finished
    setup.host.handle({ type: 'ping', reqId: 8 });
    expect(ofType(setup.posted, 'pong')[0]?.encodeInFlight).toBe(false);
  });

  it('transfers every result buffer and maps engine errors', async () => {
    const transfers: Transferable[][] = [];
    const posted: FromWorker[] = [];
    const base = hostWith();
    const { createHost } = await import('../src/host.ts');
    const host = createHost({
      manifest: { schema: 1, builtOn: 'x', generator: 'x', assets: {} },
      engineConfig: { [O200K]: (await import('./helpers/fakes.ts')).engineEntry(O200K) },
      importEngine: () => Promise.resolve(testEngine().factory),
      loader: base.loader,
      post: (message, transfer) => {
        posted.push(message);
        transfers.push(transfer);
      },
    });
    host.handle({ type: 'load', reqId: 1, tokenizer: O200K });
    base.loader.finish(O200K);
    await waitFor(() => posted.some((m) => m.type === 'loaded'));
    host.handle(encode(2, '台灣'));
    await waitFor(() => posted.some((m) => m.type === 'result'));
    const index = posted.findIndex((m) => m.type === 'result');
    const result = ofType(posted, 'result')[0]?.result;
    const list = transfers[index] ?? [];
    expect(list.length).toBeGreaterThan(10);
    expect(new Set(list).size).toBe(list.length);
    expect(list).toContain(result?.utf8.buffer);
    expect(list).toContain(result?.tokens.id.buffer);

    const failing = hostWith({
      importEngine: () =>
        Promise.resolve(
          testEngine({ error: Object.assign(new Error('no tiling'), { name: 'PretokenizeError' }) }).factory,
        ),
    });
    await loadResident(failing, O200K, 1);
    failing.host.handle(encode(2));
    await waitFor(() => ofType(failing.posted, 'error').length === 1);
    expect(ofType(failing.posted, 'error')[0]).toMatchObject({ reqId: 2, code: 'pretokenize', retryable: false });
  });

  it('switching tokenizers cancels the encode running on the released engine', async () => {
    const { factory } = testEngine({ sliceMs: 1, charsPerSlice: 1 });
    const setup = hostWith({ importEngine: () => Promise.resolve(factory) });
    await loadResident(setup, O200K, 1);
    setup.host.handle(encode(2, 'a'.repeat(40)));
    setup.host.handle({ type: 'load', reqId: 3, tokenizer: CL100K });
    await waitFor(() => ofType(setup.posted, 'cancelled').length === 1);
    expect(ofType(setup.posted, 'cancelled')[0]?.reqId).toBe(2);
  });
});

describe('lookup and prefetch', () => {
  it('lookup answers ids and bytes with copies; not-loaded without an engine', async () => {
    const setup = hostWith();
    setup.host.handle({ type: 'lookup', reqId: 1, ids: [65] });
    expect(ofType(setup.posted, 'error')[0]).toMatchObject({ code: 'not-loaded' });
    await loadResident(setup, O200K, 2);
    setup.host.handle({ type: 'lookup', reqId: 3, ids: [65, 999], bytes: Uint8Array.of(66) });
    expect(ofType(setup.posted, 'lookupResult')[0]).toEqual({
      type: 'lookupResult',
      reqId: 3,
      entries: [
        { id: 65, bytes: Uint8Array.of(65), piece: null },
        { id: 999, bytes: null, piece: null },
        { id: 66, bytes: Uint8Array.of(66), piece: null },
      ],
    });
  });

  it('prefetch is a no-op ack for the tokenizer loading or resident; otherwise downloads and acks with phase cache', async () => {
    const setup = hostWith();
    setup.host.handle({ type: 'load', reqId: 1, tokenizer: O200K });
    setup.host.handle({ type: 'prefetch', reqId: 2, tokenizer: O200K });
    await tick();
    expect(ofType(setup.posted, 'progress')).toEqual([
      { type: 'progress', reqId: 2, progress: { tokenizer: O200K, phase: 'cache', loaded: 0, total: 0 } },
    ]);
    setup.host.handle({ type: 'prefetch', reqId: 3, tokenizer: CL100K });
    await waitFor(() => ofType(setup.posted, 'progress').length === 2);
    expect(setup.loader.prefetches).toEqual([CL100K]);
    expect(ofType(setup.posted, 'progress')[1]).toEqual({
      type: 'progress',
      reqId: 3,
      progress: { tokenizer: CL100K, phase: 'cache', loaded: 123, total: 123 },
    });
  });
});
