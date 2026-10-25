/**
 * Real-Worker tests (Vitest browser mode, chromium; 07 WP07): the production entry and a test entry over the same host,
 * loading the BUILT `.bin` files that Vite serves from `data/vocab/dist`, with the real engines (WP05A/WP05B) — every
 * asset of the manifest is loaded through the production entry and checked against its committed fixture. Skipped with a
 * message without chromium or without a built manifest (`pnpm vocab:build`).
 */
import { beforeEach, describe, expect, it } from 'vitest';
import { DEFAULT_OPTIONS, type TokenizerId } from '@tsbs/core';
import type { VocabManifest } from '@tsbs/core/format/types';
import type { Progress, ToWorker } from '@tsbs/core/protocol';
import { CACHE_NAME } from '../../src/cache-store.ts';
import { isCancelled, TokenizerClient, TokenizerError, WORKER_NAME } from '../../src/client.ts';
import type { EngineConfig, EngineConfigEntry } from '../../src/engine-config.ts';

const O200K: TokenizerId = 'openai-o200k_base';
const CL100K: TokenizerId = 'openai-cl100k_base';
const IN_BROWSER = typeof (globalThis as { document?: unknown }).document !== 'undefined';

/** One committed fixture case: text, ids and `[start, end)` byte spans (the `fixtureCases` browser command). */
interface FixtureCaseLite {
  readonly name: string;
  readonly text: string;
  readonly ids: readonly number[];
  readonly spans: ReadonlyArray<readonly [number, number]>;
}

/** The project's browser commands (vitest.browser.config.ts). */
interface Commands {
  vocabManifest: () => Promise<{ schema?: unknown } | null>;
  fixtureCases: (id: string) => Promise<FixtureCaseLite[] | null>;
}

/** `vitest/browser` exists only in browser mode, hence the dynamic import behind IN_BROWSER. */
async function browserCommands(): Promise<Commands> {
  return ((await import('vitest/browser')) as unknown as { commands: Commands }).commands;
}

/** The built manifest through the project's `vocabManifest` browser command. */
async function builtManifest(): Promise<VocabManifest | null> {
  const manifest = await (await browserCommands()).vocabManifest();
  return manifest?.schema === 1 ? (manifest as VocabManifest) : null;
}

const MANIFEST = IN_BROWSER ? await builtManifest() : null;
const READY = MANIFEST?.assets[O200K] !== undefined && MANIFEST.assets[CL100K] !== undefined;
if (!IN_BROWSER) console.warn('[worker-browser] skipped: not running in a browser (chromium is not installed)');
else if (!READY) console.warn('[worker-browser] skipped: data/vocab/dist has no built manifest — run pnpm vocab:build');

/** The registry fields of the two tokenizers these tests load (tests may not import @tsbs/registry, 02 §2.1). */
const ENGINE_CONFIG: EngineConfig = {
  [O200K]: entryFor(O200K, 'o200k', 200019, 199998),
  [CL100K]: entryFor(CL100K, 'cl100k', 100277, 100256),
};

function entryFor(
  id: TokenizerId,
  pattern: 'o200k' | 'cl100k',
  vocabSize: number,
  rankCount: number,
): EngineConfigEntry {
  return {
    id,
    family: 'bytelevel-bpe',
    vocabSize,
    rankCount,
    engine: { kind: 'bytelevel-bpe', pattern, idOffset: 0, maxTokenBytes: 128, bosId: null },
    defaults: { specialTokens: 'as-text' },
    toggles: ['specialTokens'],
  };
}

function manifest(): VocabManifest {
  if (MANIFEST === null) throw new Error('no manifest');
  return MANIFEST;
}

function assetOf(id: TokenizerId): VocabManifest['assets'][string] {
  const entry = manifest().assets[id];
  if (entry === undefined) throw new Error(`no asset for ${id}`);
  return entry;
}

/** Everything a test Worker said and was told. */
interface WorkerLog {
  readonly sent: Array<ToWorker['type']>;
  readonly received: Array<{ readonly data: { readonly type: string } & Record<string, unknown>; readonly at: number }>;
  readonly workers: Worker[];
}

/** A factory of test-entry Workers (configured with `config`), logging traffic. */
function testWorkers(config: { manifest: VocabManifest; engineConfig: EngineConfig; slowSlices?: number }): {
  spawn: () => Worker;
  log: WorkerLog;
} {
  const log: WorkerLog = { sent: [], received: [], workers: [] };
  const spawn = (): Worker => {
    const worker = new Worker(new URL('./test-worker.ts', import.meta.url), { type: 'module', name: WORKER_NAME });
    worker.addEventListener('message', (event: MessageEvent) => {
      log.received.push({ data: event.data as WorkerLog['received'][number]['data'], at: performance.now() });
    });
    worker.postMessage({ type: '__config', ...config });
    const post = worker.postMessage.bind(worker);
    worker.postMessage = ((message: ToWorker, transfer: Transferable[]) => {
      log.sent.push(message.type);
      post(message, transfer);
    }) as typeof worker.postMessage;
    log.workers.push(worker);
    return worker;
  };
  return { spawn, log };
}

/** Sends `message` straight to `worker` and resolves the first reply of `type`. */
function ask<T extends string>(
  worker: Worker,
  message: unknown,
  type: T,
): Promise<{ type: T } & Record<string, unknown>> {
  return new Promise((resolve) => {
    const onMessage = (event: MessageEvent): void => {
      const data = event.data as { type: string } & Record<string, unknown>;
      if (data.type !== type) return;
      worker.removeEventListener('message', onMessage);
      resolve(data as { type: T } & Record<string, unknown>);
    };
    worker.addEventListener('message', onMessage);
    worker.postMessage(message);
  });
}

function expectMonotoneDownload(progress: readonly Progress[], total: number): void {
  const download = progress.filter((p) => p.phase === 'download');
  expect(download.length).toBeGreaterThan(1);
  for (let i = 1; i < download.length; i++) {
    expect(download[i]?.loaded).toBeGreaterThanOrEqual(download[i - 1]?.loaded ?? 0);
  }
  expect(download.every((p) => p.total === total)).toBe(true);
  expect(download.at(-1)?.loaded).toBe(total);
}

describe.skipIf(!READY)('real Worker (chromium)', () => {
  beforeEach(async () => {
    await caches.delete(CACHE_NAME);
  });

  it('the production entry loads o200k from the local .bin (monotone progress, exact total), then hits the cache', async () => {
    const holder: { worker?: Worker } = {};
    const client = new TokenizerClient(() => {
      holder.worker = new Worker(new URL('../../src/entry.ts', import.meta.url), { type: 'module', name: WORKER_NAME });
      return holder.worker;
    });
    const entry = assetOf(O200K);
    expect(await client.features).toMatchObject({ cacheApi: true, subtleCrypto: true, segmenter: true });
    expect((await client.assets)[O200K]).toEqual({
      path: entry.path,
      bytesCompressed: entry.bytesCompressed,
      bytesRaw: entry.bytesRaw,
    });
    const progress: Progress[] = [];
    const loaded = await client.load(O200K, (p) => progress.push(p));
    expect(loaded).toMatchObject({
      fromCache: false,
      layer: 'gzip',
      bytesTransferred: entry.bytesCompressed,
      info: { id: O200K, family: 'bytelevel-bpe' },
    });
    expectMonotoneDownload(progress, entry.bytesCompressed);
    expect(progress.map((p) => p.phase).filter((p, i, all) => p !== all[i - 1])).toEqual([
      'download',
      'verify',
      'decompress',
      'build',
    ]);
    expect(client.resident).toBe(O200K);

    const result = await client.encode('台灣台南', DEFAULT_OPTIONS);
    expect(result.text).toBe('台灣台南');
    expect(result.utf8.length).toBe(12);
    expect(result.tokens.byteStart.at(-1)).toBe(12);

    const worker = holder.worker;
    if (worker === undefined) throw new Error('no worker');
    const pong = await ask(worker, { type: 'ping', reqId: 1_000_000 }, 'pong');
    expect(pong).toMatchObject({ resident: O200K, heapHint: null }); // no heap API in browsers (rule 7)

    await client.unload();
    const progressAgain: Progress[] = [];
    const again = await client.load(O200K, (p) => progressAgain.push(p));
    expect(again).toMatchObject({ fromCache: true, bytesTransferred: 0, layer: 'gzip' });
    expect(progressAgain[0]).toMatchObject({ phase: 'cache', loaded: entry.bytesCompressed });
    expect(await client.cachedTokenizers()).toEqual([O200K]);
    client.terminate();
  });

  it('imports engine chunks lazily and releases the old tables before load is posted', async () => {
    const { spawn, log } = testWorkers({ manifest: manifest(), engineConfig: ENGINE_CONFIG });
    const client = new TokenizerClient(spawn);
    await client.features;
    const worker = log.workers[0];
    if (worker === undefined) throw new Error('no worker');
    const engineChunks = async (): Promise<string[]> =>
      ((await ask(worker, { type: '__resources' }, '__resources'))['names'] as string[]).filter((name) =>
        /\/engines\/(bytelevel|spm)/.test(name),
      );
    expect(await engineChunks()).toEqual([]);
    await client.load(O200K);
    const afterFirst = await engineChunks();
    expect(afterFirst.some((name) => name.includes('/engines/bytelevel'))).toBe(true);
    expect(afterFirst.some((name) => name.includes('/engines/spm'))).toBe(false);

    const sentBefore = log.sent.length;
    await client.load(CL100K);
    expect(log.sent.slice(sentBefore)).toEqual(['unload', 'load']);
    const hooks = log.received
      .map((r) => r.data)
      .filter((d) => d.type === '__hook')
      .map(
        (d) =>
          `${String(d['event'])} ${String(d['tokenizer'])}${d['event'] === 'load-start' ? ` released=${String(d['tablesReleased'])}` : ''}`,
      );
    expect(hooks).toEqual([
      `load-start ${O200K} released=true`,
      `release ${O200K}`,
      `load-start ${CL100K} released=true`,
    ]);
    expect(client.resident).toBe(CL100K);
    client.terminate();
  });

  it('an integrity failure (corrupted copy) evicts the cached body and reports integrity', async () => {
    const entry = assetOf(O200K);
    const corruptPath = entry.path.replace('/tok/', '/tok-corrupt/');
    const altered: VocabManifest = {
      ...manifest(),
      assets: { ...manifest().assets, [O200K]: { ...entry, path: corruptPath } },
    };
    const url = new URL(corruptPath, location.origin).href;
    const cache = await caches.open(CACHE_NAME);
    await cache.put(url, new Response(Uint8Array.of(0x1f, 0x8b, 0, 0))); // a stale, unusable stored body
    const { spawn } = testWorkers({ manifest: altered, engineConfig: ENGINE_CONFIG });
    const client = new TokenizerClient(spawn);
    const error: unknown = await client.load(O200K).then(
      () => null,
      (e: unknown) => e,
    );
    expect(error).toBeInstanceOf(TokenizerError);
    expect(error).toMatchObject({ code: 'integrity', retryable: true });
    expect(await (await caches.open(CACHE_NAME)).match(url)).toBeUndefined();
    expect(client.resident).toBeNull();
    client.terminate();
  });

  it('cancels an in-flight encode of 20k CJK in a real Worker within one slice (slow engine, 4 ms slices)', async () => {
    const { spawn, log } = testWorkers({ manifest: manifest(), engineConfig: ENGINE_CONFIG, slowSlices: 100 });
    const client = new TokenizerClient(spawn);
    await client.load(O200K);
    const controller = new AbortController();
    const start = log.received.length;
    let abortedAt = 0;
    const pending = client
      .encode(
        '台灣台南'.repeat(5_000),
        DEFAULT_OPTIONS,
        () => {
          if (abortedAt === 0) {
            abortedAt = performance.now();
            controller.abort();
          }
        },
        controller.signal,
      )
      .catch((e: unknown) => e);
    expect(isCancelled(await pending)).toBe(true);
    const deadline = performance.now() + 5_000;
    while (!log.received.slice(start).some((r) => r.data.type === 'cancelled') && performance.now() < deadline) {
      await new Promise((resolve) => setTimeout(resolve, 5));
    }
    const cancelled = log.received.slice(start).find((r) => r.data.type === 'cancelled');
    expect(cancelled).toBeDefined();
    expect(log.received.slice(start).some((r) => r.data.type === 'result')).toBe(false);
    const latency = (cancelled?.at ?? Number.POSITIVE_INFINITY) - abortedAt;
    console.info(`[worker-browser] cancel → cancelled in a real Worker: ${latency.toFixed(1)} ms`);
    // ≤ one slice plus the round trip (the strict ≤ 10 ms bound is the Node test's; CI browsers get headroom).
    expect(latency).toBeLessThan(50);
    client.terminate();
  });

  it('the production entry loads every built asset and reproduces its fixture (ids and byte spans, real engines)', async () => {
    const ids = Object.keys(manifest().assets) as TokenizerId[];
    expect(ids).toHaveLength(9);
    const commands = await browserCommands();
    const client = new TokenizerClient(
      () => new Worker(new URL('../../src/entry.ts', import.meta.url), { type: 'module', name: WORKER_NAME }),
    );
    for (const id of ids) {
      const cases = await commands.fixtureCases(id);
      if (cases === null) throw new Error(`no fixture for ${id}`);
      const loaded = await client.load(id);
      expect(loaded.info.id).toBe(id);
      expect(client.resident).toBe(id);
      let checked = 0;
      for (const c of cases) {
        const result = await client.encode(c.text, DEFAULT_OPTIONS);
        expect({ id, name: c.name, ids: [...result.tokens.id] }).toEqual({ id, name: c.name, ids: c.ids });
        const spans = [...result.tokens.id].map((_, i) => [result.tokens.byteStart[i], result.tokens.byteStart[i + 1]]);
        expect({ id, name: c.name, spans }).toEqual({ id, name: c.name, spans: c.spans });
        checked += 1;
      }
      console.info(`[worker-browser] ${id}: ${String(checked)} fixture cases through the real Worker`);
    }
    client.terminate();
  }, 180_000);
});
