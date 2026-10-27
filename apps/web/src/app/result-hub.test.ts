/**
 * The result hub (PA-19): precomputed answers first while a tokenizer is not loaded, the load policy (nothing before
 * `start()`, free text and `ensureRows` load), latest-wins encodes where a superseded request is never an error, one
 * traced request shared by the board and a row, entries of other options taking turns on one Worker, errors on the
 * entry, the AD-27 releases and the idle prefetch.
 */
import type { AssetSummary, TokenizerId } from '@tsbs/core';
import { CancelledError } from '@tsbs/core/model/cancelled';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { engineOver, FakeClient, FakeClients, flush, syntheticResult } from './fake-client.test-helper.ts';
import { RELEASE_ABOVE_BYTES } from './long-input.ts';
import { NoPrecomputedResultError } from './no-precomputed.ts';
import type { PrecomputedSource } from './precomputed.ts';
import { ResultHub, ROW_OPTIONS, type HubAnswer, type TokenOptions } from './result-hub.svelte.ts';
import { TokenizerPool } from './tokenizer-pool.ts';

const O200K: TokenizerId = 'openai-o200k_base';
const GROK2: TokenizerId = 'xai-grok2';
const CHIP = '日本語のテキスト';
const WITH_BOS: TokenOptions = { ...ROW_OPTIONS, addBos: true };

/** Answers `CHIP` (and only it) on every tokenizer, counting its lookups. */
function chipSource(): PrecomputedSource & { finds: number } {
  const source = {
    finds: 0,
    find: (ref: { readonly id: TokenizerId }, text: string) => {
      source.finds++;
      return Promise.resolve(text === CHIP ? syntheticResult(text, ref.id, { trace: false }) : null);
    },
  };
  return source;
}

function setup(precomputed: PrecomputedSource | null = chipSource()): {
  hub: ResultHub;
  clients: FakeClients;
  pool: TokenizerPool;
} {
  const clients = new FakeClients();
  const pool = new TokenizerPool(clients.spawn);
  return { hub: new ResultHub({ precomputed, engine: engineOver(pool) }), clients, pool };
}

/** Loads `id` in its own client (the hub must be asked for it first) and returns that client. */
async function loaded(hub: ResultHub, clients: FakeClients, id: TokenizerId): Promise<FakeClient> {
  const load = hub.load(id);
  const client = clients.of(id);
  client.loads.at(-1)?.finish();
  await load;
  await flush();
  return client;
}

const resultOf = (answer: HubAnswer): string | null => (answer.kind === 'result' ? answer.result.input.text : null);

afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

describe('ResultHub: precomputed first, then the engine', () => {
  it('serves seeds and example chips precomputed while the tokenizer is not loaded, loading nothing', async () => {
    const seed = syntheticResult('台灣台南', GROK2, { trace: false });
    const source = chipSource();
    const clients = new FakeClients();
    const hub = new ResultHub({
      precomputed: source,
      seeds: [seed],
      engine: engineOver(new TokenizerPool(clients.spawn)),
    });
    expect(hub.entry(GROK2)).toMatchObject({ result: seed, source: 'precomputed', pending: false });
    // The seed answers its own text at once.
    await expect(hub.request(GROK2, '台灣台南', ROW_OPTIONS, { trace: false })).resolves.toEqual({
      kind: 'result',
      result: seed,
      source: 'precomputed',
    });
    expect(source.finds).toBe(0);
    const chip = hub.request(GROK2, CHIP, ROW_OPTIONS, { trace: false });
    expect(hub.entry(GROK2).pending).toBe(true);
    expect(resultOf(await chip)).toBe(CHIP);
    expect(hub.entry(GROK2)).toMatchObject({ source: 'precomputed', pending: false, error: null });
    hub.start();
    expect(clients.all).toHaveLength(0); // no Worker, no download for example texts
  });

  it('keeps free text waiting before start(); start() loads its tokenizer and the request is encoded live', async () => {
    const { hub, clients } = setup();
    const request = hub.request(GROK2, 'free text', ROW_OPTIONS, { trace: false });
    await flush();
    expect(clients.all).toHaveLength(0); // 06 §3: nothing loads before first paint
    expect(hub.entry(GROK2).pending).toBe(true);
    hub.start();
    const client = clients.of(GROK2);
    expect(hub.entry(GROK2).progress).toMatchObject({ tokenizer: GROK2, phase: 'cache' });
    client.loads[0]?.onProgress?.({ tokenizer: GROK2, phase: 'download', loaded: 5, total: 10 });
    expect(hub.entry(GROK2).progress).toMatchObject({ phase: 'download', loaded: 5 });
    client.loads[0]?.finish();
    await flush();
    expect(hub.loaded(GROK2)).toBe(true);
    expect(hub.entry(GROK2).progress).toBeNull();
    expect(client.encodes.map((call) => [call.text, call.options.trace])).toEqual([['free text', false]]);
    client.encodes[0]?.answer();
    expect(resultOf(await request)).toBe('free text');
    expect(hub.entry(GROK2)).toMatchObject({ source: 'live', pending: false });
  });

  it('loads on free text once started, and encodes chips live (not precomputed) once loaded', async () => {
    const { hub, clients } = setup();
    hub.start();
    void hub.request(O200K, 'typed', ROW_OPTIONS, { trace: false });
    await flush();
    const client = clients.of(O200K);
    client.loads[0]?.finish();
    await flush();
    client.encodes.at(-1)?.answer();
    const chip = hub.request(O200K, CHIP, ROW_OPTIONS, { trace: false });
    expect(client.encodes.at(-1)?.text).toBe(CHIP);
    client.encodes.at(-1)?.answer();
    await expect(chip).resolves.toMatchObject({ kind: 'result', source: 'live' });
  });

  it('turns the precomputed answer of what was asked into a live one when the tokenizer loads', async () => {
    const { hub, clients } = setup();
    expect(resultOf(await hub.request(O200K, CHIP, ROW_OPTIONS, { trace: false }))).toBe(CHIP);
    hub.entry(GROK2); // an entry nobody asked anything of stays as it is
    const client = await loaded(hub, clients, O200K);
    expect(client.encodes.map((call) => call.text)).toEqual([CHIP]);
    client.encodes[0]?.answer();
    await flush();
    expect(hub.entry(O200K)).toMatchObject({ source: 'live', pending: false });
    expect(clients.all).toHaveLength(1);
  });

  it('loads the rows ensureRows names, deferred until start()', () => {
    const { hub, clients } = setup();
    hub.ensureRows([GROK2]);
    expect(clients.all).toHaveLength(0);
    hub.start();
    expect(clients.of(GROK2).loads).toHaveLength(1);
    hub.ensureRows([GROK2, 'google-gemma4']); // a load in flight is shared
    expect(clients.of(GROK2).loads).toHaveLength(1);
    expect(clients.of('google-gemma4').loads).toHaveLength(1);
  });
});

describe('ResultHub: latest wins, sharing and turns', () => {
  it('lets the latest request of an entry win; the superseded one settles as none, never as an error', async () => {
    const { hub, clients } = setup();
    const client = await loaded(hub, clients, O200K);
    const first = hub.request(O200K, 'first', ROW_OPTIONS, { trace: false });
    const second = hub.request(O200K, 'second', ROW_OPTIONS, { trace: false });
    await expect(first).resolves.toEqual({ kind: 'none' });
    client.encodes[0]?.resolve(syntheticResult('first', O200K)); // cancelled by the client: a late answer is dropped
    client.encodes[1]?.answer();
    expect(resultOf(await second)).toBe('second');
    expect(hub.entry(O200K)).toMatchObject({ error: null, pending: false });
    expect(hub.entry(O200K).result?.input.text).toBe('second');
    const third = hub.request(O200K, 'third', ROW_OPTIONS, { trace: false });
    client.encodes[2]?.reject(new CancelledError());
    await expect(third).resolves.toEqual({ kind: 'none' });
    expect(hub.entry(O200K).error).toBeNull();
  });

  it('serves the board and a row from one traced request when their options agree', async () => {
    const { hub, clients } = setup();
    const client = await loaded(hub, clients, O200K);
    const board = hub.request(O200K, 'shared', ROW_OPTIONS, { trace: true });
    const row = hub.request(O200K, 'shared', ROW_OPTIONS, { trace: false });
    expect(row).toBe(board);
    expect(client.encodes).toHaveLength(1);
    expect(hub.entry(O200K).traced).toBe(true);
    client.encodes[0]?.answer();
    const answer = await board;
    // Asked again after the answer: the traced live result serves an untraced request without the Worker…
    await expect(hub.request(O200K, 'shared', ROW_OPTIONS, { trace: false })).resolves.toEqual(answer);
    expect(client.encodes).toHaveLength(1);
    // …while an untraced result cannot serve a traced one.
    void hub.request(O200K, 'untraced', ROW_OPTIONS, { trace: false });
    client.encodes[1]?.answer();
    await flush();
    void hub.request(O200K, 'untraced', ROW_OPTIONS, { trace: { maxSteps: 10 } });
    expect(client.encodes.map((call) => call.options.trace)).toEqual([true, false, { maxSteps: 10 }]);
  });

  it('runs the encodes of two entries on one Worker in turn (its client cancels older encodes)', async () => {
    const { hub, clients } = setup();
    const client = await loaded(hub, clients, O200K);
    const row = hub.request(O200K, 'text', ROW_OPTIONS, { trace: false });
    const board = hub.request(O200K, 'text', WITH_BOS, { trace: true });
    expect(client.encodes).toHaveLength(1);
    expect(hub.entry(O200K, WITH_BOS).pending).toBe(true);
    client.encodes[0]?.answer();
    expect(resultOf(await row)).toBe('text');
    expect(client.encodes.map((call) => call.options)).toEqual([
      { ...ROW_OPTIONS, trace: false },
      { ...WITH_BOS, trace: true },
    ]);
    client.encodes[1]?.answer();
    expect(resultOf(await board)).toBe('text');
    expect(hub.entry(O200K, WITH_BOS).result?.options.addBos).toBe(true);
    expect(hub.entry(O200K).result?.options.addBos).toBe(false);
    expect(clients.all).toHaveLength(1);
  });

  it('gives every tokenizer its own Worker: encodes on two tokenizers run side by side', async () => {
    const { hub, clients } = setup();
    const o200k = await loaded(hub, clients, O200K);
    const grok2 = await loaded(hub, clients, GROK2);
    const a = hub.request(O200K, 'side', ROW_OPTIONS, { trace: false });
    const b = hub.request(GROK2, 'side', ROW_OPTIONS, { trace: false });
    expect([o200k.encodes.length, grok2.encodes.length]).toEqual([1, 1]);
    grok2.encodes[0]?.answer();
    o200k.encodes[0]?.answer();
    expect((await a).kind).toBe('result');
    expect((await b).kind).toBe('result');
    expect(o200k.unloads + grok2.unloads).toBe(0);
  });
});

describe('ResultHub: errors', () => {
  const failure = (code: string, retryable = false): Error => Object.assign(new Error(code), { code, retryable });

  it('puts an encode error on the entry and answers it; the next request clears it', async () => {
    const { hub, clients } = setup();
    const client = await loaded(hub, clients, O200K);
    const failed = hub.request(O200K, 'bad', ROW_OPTIONS, { trace: false });
    client.encodes[0]?.reject(failure('pretokenize'));
    await expect(failed).resolves.toMatchObject({ kind: 'error', error: { code: 'pretokenize' } });
    expect(hub.entry(O200K).error).toMatchObject({ code: 'pretokenize', phase: 'encode', tokenizer: O200K });
    void hub.request(O200K, 'good', ROW_OPTIONS, { trace: false });
    expect(hub.entry(O200K).error).toBeNull();
  });

  it('shows a load error on the tokenizer’s entries until a retried load succeeds; the waiting request then runs', async () => {
    const { hub, clients } = setup();
    hub.start();
    const request = hub.request(GROK2, 'free', ROW_OPTIONS, { trace: false });
    await flush();
    const client = clients.of(GROK2);
    client.loads[0]?.reject(failure('fetch', true));
    await flush();
    expect(hub.entry(GROK2).error).toMatchObject({ code: 'fetch', retryable: true, phase: 'load' });
    expect(hub.entry(GROK2).pending).toBe(true);
    const retry = hub.load(GROK2);
    expect(hub.entry(GROK2).error).toBeNull();
    client.loads[1]?.finish();
    await retry;
    client.encodes[0]?.answer();
    expect(resultOf(await request)).toBe('free');
  });

  it('shows the text alone (no result, no error) when ?mock=1 has no answer for free text', async () => {
    const { hub, clients } = setup();
    const client = await loaded(hub, clients, O200K);
    void hub.request(O200K, 'chip-like', ROW_OPTIONS, { trace: false });
    client.encodes[0]?.answer();
    await flush();
    const free = hub.request(O200K, 'free', ROW_OPTIONS, { trace: false });
    client.encodes[1]?.reject(new NoPrecomputedResultError('no precomputed result'));
    expect((await free).kind).toBe('error');
    expect(hub.entry(O200K)).toMatchObject({ result: null, error: null, pending: false });
  });

  it('answers lookups only from a Worker that has the tokenizer', async () => {
    const { hub, clients } = setup();
    await expect(hub.lookup(O200K, { ids: [1] })).rejects.toThrow(/not loaded/);
    expect(hub.features(O200K)).toBeNull();
    await loaded(hub, clients, O200K);
    await expect(hub.lookup(O200K, { ids: [1] })).resolves.toEqual([]);
    await expect(hub.features(O200K)).resolves.toMatchObject({ cacheApi: true });
  });
});

describe('ResultHub: memory (AD-27) and Workers', () => {
  it('drops a released entry’s result and pending request, and lets its Worker be evicted', async () => {
    const clients = new FakeClients();
    const pool = new TokenizerPool(clients.spawn, 1);
    const hub = new ResultHub({ engine: engineOver(pool) });
    hub.retain(O200K);
    hub.retain(O200K, WITH_BOS);
    const client = await loaded(hub, clients, O200K);
    void hub.request(O200K, 'kept', ROW_OPTIONS, { trace: false });
    client.encodes[0]?.answer();
    await flush();
    const pending = hub.request(O200K, 'dropped', WITH_BOS, { trace: false });
    hub.release(O200K, WITH_BOS);
    await expect(pending).resolves.toEqual({ kind: 'none' });
    client.encodes[1]?.answer(); // a late answer is not kept for an entry nobody shows
    await flush();
    expect(hub.entry(O200K, WITH_BOS)).toMatchObject({ result: null, pending: false });
    expect(hub.entry(O200K).result?.input.text).toBe('kept'); // still held
    expect(pool.get(O200K)?.users).toBe(1);
    hub.release(O200K);
    expect(hub.entry(O200K).result).toBeNull();
    expect(pool.get(O200K)?.users).toBe(0);
    void hub.load(GROK2); // the pool keeps one client: the unused o200k Worker goes
    expect(client.terminated).toBe(true);
    expect(hub.loaded(O200K)).toBe(false);
  });

  it('forgets a result at once, and the answer of a request issued before', async () => {
    const { hub, clients } = setup();
    const client = await loaded(hub, clients, O200K);
    void hub.request(O200K, 'one', ROW_OPTIONS, { trace: false });
    client.encodes[0]?.answer();
    await flush();
    const late = hub.request(O200K, 'two', ROW_OPTIONS, { trace: false });
    hub.forget(O200K);
    expect(hub.entry(O200K).result).toBeNull();
    client.encodes[1]?.answer();
    expect(resultOf(await late)).toBe('two'); // the caller still gets it…
    expect(hub.entry(O200K).result).toBeNull(); // …but the entry no longer holds it
  });

  it('releases the previous result before a request whose result may exceed 8 MB', async () => {
    const { hub, clients } = setup();
    const client = await loaded(hub, clients, O200K);
    void hub.request(O200K, 'small', ROW_OPTIONS, { trace: false });
    client.encodes[0]?.answer();
    await flush();
    const big = '台'.repeat(Math.ceil(RELEASE_ABOVE_BYTES / 3 / 24) + 1);
    const request = hub.request(O200K, big, ROW_OPTIONS, { trace: false });
    expect(hub.entry(O200K).result).toBeNull();
    client.encodes[1]?.answer();
    expect(resultOf(await request)).toBe(big);
    expect(hub.entry(O200K).result?.input.text).toBe(big);
  });

  it('reports the first client’s wire sizes', async () => {
    const summary = {
      'openai-o200k_base': { path: '/tok/o.bin', bytesCompressed: 1, bytesRaw: 2 },
    } as unknown as AssetSummary;
    class SizedClient extends FakeClient {
      override readonly assets: Promise<AssetSummary> = Promise.resolve(summary);
    }
    const hub = new ResultHub({ engine: engineOver(new TokenizerPool(() => new SizedClient())) });
    hub.retain(O200K); // a view alone spawns no Worker
    await flush();
    expect(hub.assets).toBeNull();
    void hub.load(O200K);
    await flush();
    expect(hub.assets).toBe(summary);
  });
});

describe('ResultHub: idle prefetch', () => {
  it('prefetches the other rows one after another after the delay, through a Worker already up', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout'] });
    const { hub, clients } = setup();
    const load = hub.load(O200K);
    const o200k = clients.of(O200K);
    o200k.loads[0]?.finish();
    await load;
    const done = hub.prefetchIdle([O200K, GROK2, 'google-gemma4']);
    await vi.advanceTimersByTimeAsync(9_999);
    expect(o200k.prefetches).toEqual([]);
    await vi.advanceTimersByTimeAsync(1);
    await done;
    expect(o200k.prefetches).toEqual([GROK2, 'google-gemma4']); // o200k is loaded: skipped
    expect(clients.all).toHaveLength(1); // no Worker spawned for a prefetch
    const again = hub.prefetchIdle([GROK2], 0);
    await vi.advanceTimersByTimeAsync(0);
    await again;
    expect(o200k.prefetches).toHaveLength(2); // once per page
  });

  it('prefetches nothing under Save-Data', async () => {
    vi.stubGlobal('navigator', { connection: { saveData: true } });
    const { hub, clients } = setup();
    const load = hub.load(O200K);
    clients.of(O200K).loads[0]?.finish();
    await load;
    await hub.prefetchIdle([GROK2], 0);
    expect(clients.of(O200K).prefetches).toEqual([]);
  });
});
