/**
 * The host and the real loader on the BUILT o200k asset (`data/vocab/dist`, read through its manifest): gzip layer,
 * SHA-256, `DecompressionStream`, `readTsbv1`, the engine factory of `src/engines/bytelevel.ts` (the stand-in until
 * WP05A, the real engine after integration), a cache hit on the second load, and — opt-in — the Node heap delta of one
 * resident tokenizer (06 §3: o200k ≤ 8 MB; AD-19: released on unload; `pong.heapHint` from the bench):
 *   TSBS_PERF=1 NODE_OPTIONS=--expose-gc pnpm exec vitest run --project worker test/integration.test.ts
 * Skipped with a message when `data/vocab/dist` has no manifest (`pnpm vocab:build`; CI's unit job has it).
 */
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { DEFAULT_OPTIONS, type Family, type TokenizerId } from '@tsbs/core';
import type { VocabManifest } from '@tsbs/core/format/types';
import type { FromWorker } from '@tsbs/core/protocol';
import { asEngineFactory, type EngineFactory } from '../src/engine-config.ts';
import { createHost } from '../src/host.ts';
import { createLoader } from '../src/loader.ts';
import {
  ENGINE_CONFIG,
  engineEntry,
  FakeCacheStorage,
  fakeFetch,
  loaderEnv,
  respond,
  waitFor,
} from './helpers/fakes.ts';

const REPO = fileURLToPath(new URL('../../../', import.meta.url));
const DIST = join(REPO, 'data', 'vocab', 'dist');
const MANIFEST = join(DIST, 'vocab-manifest.generated.json');
const O200K: TokenizerId = 'openai-o200k_base';
const HAVE_DIST = existsSync(MANIFEST);
/** Heap numbers mean something only with a forced GC between the samples. */
const gc = (globalThis as { gc?: () => void }).gc;
const PERF = process.env['TSBS_PERF'] === '1' && gc !== undefined;
if (process.env['TSBS_PERF'] === '1' && gc === undefined) {
  console.warn('[worker integration] heap delta skipped: run with NODE_OPTIONS=--expose-gc');
}

if (!HAVE_DIST) console.warn(`[worker integration] skipped: ${MANIFEST} is missing — run pnpm vocab:build`);

/** entry.ts's importer (entry.ts itself needs a Worker scope and the generated JSON). */
async function importEngine(family: Family): Promise<EngineFactory> {
  return family === 'bytelevel-bpe'
    ? asEngineFactory((await import('../src/engines/bytelevel.ts')).createByteLevelTokenizer)
    : asEngineFactory((await import('../src/engines/spm.ts')).createSpmTokenizer);
}

function setup() {
  const manifest = JSON.parse(readFileSync(MANIFEST, 'utf8')) as VocabManifest;
  const entry = manifest.assets[O200K];
  if (entry === undefined) throw new Error('the built manifest has no o200k asset');
  const bin = new Uint8Array(readFileSync(join(DIST, ...entry.path.split('/').filter(Boolean))));
  const url = `https://tsbs.test${entry.path}`;
  const server = fakeFetch({ [url]: respond(bin, { chunkSize: 64 * 1024 }) });
  const storage = new FakeCacheStorage();
  const posted: FromWorker[] = [];
  const host = createHost({
    manifest,
    engineConfig: { ...ENGINE_CONFIG, [O200K]: { ...engineEntry(O200K), vocabSize: 200019, rankCount: 199998 } },
    importEngine,
    loader: createLoader(manifest, loaderEnv({ fetch: server.fetch, caches: storage })),
    heapHint: () => process.memoryUsage().arrayBuffers,
    post: (message) => {
      posted.push(message);
    },
  });
  return { manifest, entry, bin, url, server, storage, posted, host };
}

describe.skipIf(!HAVE_DIST)('host + loader on the built o200k asset', () => {
  it('loads with exact download progress, encodes, looks up, and reloads from the cache', async () => {
    const { entry, bin, url, server, storage, posted, host } = setup();
    host.handle({ type: 'load', reqId: 1, tokenizer: O200K });
    await waitFor(() => posted.some((m) => m.type === 'loaded' || m.type === 'error'), 10_000);
    const loaded = posted.find((m) => m.type === 'loaded');
    expect(loaded?.type === 'loaded' && loaded.loaded).toMatchObject({
      fromCache: false,
      layer: 'gzip',
      bytesTransferred: bin.length,
      info: { id: O200K, family: 'bytelevel-bpe' },
    });
    const download = posted.flatMap((m) =>
      m.type === 'progress' && m.progress.phase === 'download' ? [m.progress] : [],
    );
    expect(download.at(-1)).toMatchObject({ loaded: entry.bytesCompressed, total: entry.bytesCompressed });
    expect(download.every((p, i) => i === 0 || p.loaded >= (download[i - 1]?.loaded ?? 0))).toBe(true);

    host.handle({ type: 'encode', reqId: 2, seq: 1, text: '台灣台南', options: DEFAULT_OPTIONS });
    await waitFor(() => posted.some((m) => m.type === 'result'));
    const result = posted.find((m) => m.type === 'result');
    expect(result?.type === 'result' && result.result.text).toBe('台灣台南');

    host.handle({ type: 'lookup', reqId: 3, bytes: new TextEncoder().encode('台') });
    const lookup = posted.find((m) => m.type === 'lookupResult');
    expect(lookup?.type === 'lookupResult' && lookup.entries[0]?.id).toBe(3735); // research anchor (04 §7)

    await waitFor(() => storage.cache().store.has(url));
    host.handle({ type: 'unload', reqId: 4 });
    host.handle({ type: 'load', reqId: 5, tokenizer: O200K });
    await waitFor(() => posted.some((m) => m.type === 'loaded' && m.reqId === 5), 10_000);
    const again = posted.find((m) => m.type === 'loaded' && m.reqId === 5);
    expect(again?.type === 'loaded' && again.loaded.fromCache).toBe(true);
    expect(server.calls).toHaveLength(1);
  });

  it.skipIf(!PERF)('Node heap delta: one resident o200k ≤ 8 MB, released on unload (TSBS_PERF=1)', async () => {
    const { posted, host, storage } = setup();
    const heap = async (): Promise<number> => {
      gc?.();
      await new Promise((resolve) => setTimeout(resolve, 10));
      gc?.();
      const reqId = 100 + posted.length;
      host.handle({ type: 'ping', reqId });
      const pong = posted.find((m) => m.type === 'pong' && m.reqId === reqId);
      return pong?.type === 'pong' ? (pong.heapHint ?? Number.NaN) : Number.NaN;
    };
    const before = await heap();
    host.handle({ type: 'load', reqId: 1, tokenizer: O200K });
    await waitFor(() => posted.some((m) => m.type === 'loaded'), 10_000);
    const resident = await heap();
    host.handle({ type: 'unload', reqId: 2 });
    // The in-memory fake Cache API holds the stored .bin in this process; a browser's cache lives elsewhere.
    await waitFor(() => storage.cache().store.size > 0);
    const cached = [...storage.cache().store.values()].reduce((sum, r) => sum + r.body.byteLength, 0);
    const after = (await heap()) - cached;
    const mb = (n: number): string => (n / 2 ** 20).toFixed(2);
    console.info(
      `o200k resident arrayBuffers delta ${mb(resident - before - cached)} MB; after unload ${mb(after - before)} MB`,
    );
    expect(resident - before - cached).toBeLessThanOrEqual(8 * 2 ** 20);
    expect(after - before).toBeLessThanOrEqual(0.5 * 2 ** 20);
  });
});
