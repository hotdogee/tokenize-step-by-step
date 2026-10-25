/**
 * Worker heap check (06 §3 "Worker heap growth while typing", WP12): a Node harness over the real host, loader and engine
 * on the BUILT asset types 500 keystrokes into a 10,000-CJK paragraph — one `encode` per keystroke, each awaited like a
 * typist slower than the engine, every result dropped as soon as it is posted (the Worker transfers it) — and the
 * process's `heapUsed + external` (ArrayBuffers included) must grow by < 10 MB between a settled sample after warm-up
 * and one after the 500th result (the chunk cache is ≤ 2 MiB and a CJK paragraph is one chunk that is never cached).
 * Opt-in and serial, with forced GC:
 *   TSBS_PERF=1 NODE_OPTIONS=--expose-gc pnpm test:perf
 * Skips without `data/vocab/dist` (`pnpm vocab:build`) or without the generated engine config (`pnpm generate`). With
 * TSBS_PERF=1 but no `gc` (no `--expose-gc`) it fails rather than skip, so a green opt-in run always includes it.
 */
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { DEFAULT_OPTIONS, type Family, type TokenizerId } from '@tsbs/core';
import type { VocabManifest } from '@tsbs/core/format/types';
import { asEngineFactory, type EngineConfig, type EngineFactory } from '../src/engine-config.ts';
import { createHost } from '../src/host.ts';
import { createLoader } from '../src/loader.ts';
import { FakeCacheStorage, fakeFetch, loaderEnv, respond, waitFor } from './helpers/fakes.ts';

const REPO = fileURLToPath(new URL('../../../', import.meta.url));
const DIST = join(REPO, 'data', 'vocab', 'dist');
const MANIFEST = join(DIST, 'vocab-manifest.generated.json');
const ENGINE_CONFIG = join(REPO, 'packages', 'worker', 'src', 'generated', 'engine-config.json');
const gc = (globalThis as { gc?: () => void }).gc;
const PERF = process.env['TSBS_PERF'] === '1';
const READY = existsSync(MANIFEST) && existsSync(ENGINE_CONFIG);

/** 06 §3: 500 keystrokes into a 10k-CJK paragraph grow the Worker's memory by less than this. */
const GROWTH_LIMIT = 10 * 2 ** 20;
const KEYSTROKES = 500;

/** `count` CJK ideographs from a fixed zh-TW alphabet (deterministic; one regex chunk / one SentencePiece word). */
function cjk(count: number, offset = 0): string {
  const alphabet = Array.from(
    '台灣台南高雄臺北新竹嘉義花蓮宜蘭基隆桃園苗栗彰化南投雲林屏東澎湖金門馬祖今天天氣很好我們一起去吃飯',
  );
  let out = '';
  for (let i = 0; i < count; i++) out += alphabet[((i + offset) * 7 + (i >> 5)) % alphabet.length] ?? '';
  return out;
}

async function importEngine(family: Family): Promise<EngineFactory> {
  return family === 'bytelevel-bpe'
    ? asEngineFactory((await import('../src/engines/bytelevel.ts')).createByteLevelTokenizer)
    : asEngineFactory((await import('../src/engines/spm.ts')).createSpmTokenizer);
}

/** `heapUsed + external` after two forced collections and a macrotask (so finalizers and weak callbacks have run). */
async function settledMemory(): Promise<number> {
  gc?.();
  await new Promise((resolve) => setTimeout(resolve, 20));
  gc?.();
  const usage = process.memoryUsage();
  return usage.heapUsed + usage.external;
}

describe.skipIf(!READY || !PERF)('Worker heap while typing (TSBS_PERF=1, 06 §3)', () => {
  it.runIf(gc === undefined)('has forced GC (TSBS_PERF=1)', () => {
    expect.fail('the Worker heap check needs forced GC: run it with NODE_OPTIONS=--expose-gc');
  });
  it.runIf(gc !== undefined).each<TokenizerId>(['openai-o200k_base', 'google-gemma4'])(
    '%s: 500 keystrokes into a 10k-CJK paragraph grow the memory by < 10 MB (TSBS_PERF=1)',
    async (id) => {
      const manifest = JSON.parse(readFileSync(MANIFEST, 'utf8')) as VocabManifest;
      const engineConfig = JSON.parse(readFileSync(ENGINE_CONFIG, 'utf8')) as EngineConfig;
      const entry = manifest.assets[id];
      if (entry === undefined) throw new Error(`${id} is not in the built manifest`);
      const bin = new Uint8Array(readFileSync(join(DIST, ...entry.path.split('/').filter(Boolean))));
      const server = fakeFetch({ [`https://tsbs.test${entry.path}`]: respond(bin, { chunkSize: 256 * 1024 }) });
      let loaded = false;
      let lastSeq = 0;
      let results = 0;
      let errors = 0;
      const host = createHost({
        manifest,
        engineConfig,
        importEngine,
        loader: createLoader(manifest, loaderEnv({ fetch: server.fetch, caches: new FakeCacheStorage() })),
        // Keep nothing a real Worker would have transferred away: only counters and the last seq.
        post: (message) => {
          if (message.type === 'loaded') loaded = true;
          else if (message.type === 'result') {
            results++;
            lastSeq = message.seq;
          } else if (message.type === 'error') errors++;
        },
      });
      host.handle({ type: 'load', reqId: 1, tokenizer: id });
      await waitFor(() => loaded || errors > 0, 20_000);
      expect(errors).toBe(0);

      const head = cjk(5_000);
      const tail = cjk(5_000, 3);
      let typed = '';
      let seq = 0;
      const keystroke = async (): Promise<void> => {
        typed += cjk(1, seq);
        seq++;
        host.handle({ type: 'encode', reqId: 100 + seq, seq, text: head + typed + tail, options: DEFAULT_OPTIONS });
        await waitFor(() => lastSeq === seq || errors > 0, 10_000);
      };
      for (let i = 0; i < 20; i++) await keystroke(); // warm-up: JIT, chunk cache, steady-state allocations
      const before = await settledMemory();
      const t0 = performance.now();
      for (let i = 0; i < KEYSTROKES; i++) await keystroke();
      const seconds = (performance.now() - t0) / 1000;
      const after = await settledMemory();
      const growth = after - before;
      console.info(
        `[worker heap] ${id}: ${String(KEYSTROKES)} keystrokes into ${String(Array.from(head + tail).length)} CJK in ` +
          `${seconds.toFixed(1)} s (${((seconds * 1000) / KEYSTROKES).toFixed(1)} ms/keystroke); heapUsed+external ` +
          `${(before / 2 ** 20).toFixed(1)} → ${(after / 2 ** 20).toFixed(1)} MB, growth ${(growth / 2 ** 20).toFixed(2)} MB`,
      );
      expect(errors).toBe(0);
      expect(results).toBe(KEYSTROKES + 20);
      expect(growth).toBeLessThan(GROWTH_LIMIT);
    },
    180_000,
  );
});
