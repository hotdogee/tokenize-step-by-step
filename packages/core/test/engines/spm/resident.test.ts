/**
 * Opt-in memory ceiling of 06 §3 / WP05B (`TSBS_PERF=1`): the Gemma 4 engine stays ≤ 12 MB resident once the decompressed
 * container is released (PCES copy + offsets + hash table + TYPS + merge CSR; 03 §C.2 estimates ≈ 9.5 MB). Measured as the
 * `process.memoryUsage().arrayBuffers` delta around gunzip → readTsbv1 → createSpmTokenizer after forced GCs, in a file of
 * its own so no other suite's buffers are collected inside the window.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import process from 'node:process';
import v8 from 'node:v8';
import vm from 'node:vm';
import { gunzipSync } from 'node:zlib';
import { describe, expect, it } from 'vitest';
import { createSpmTokenizer } from '../../../src/engines/spm/index.ts';
import { readTsbv1 } from '../../../src/format/tsbv1.ts';
import { PERF_BUDGETS } from '../../helpers/perf.ts';
import { REPO_ROOT } from '../../helpers/repo.ts';
import { BUILT, registryEntry } from './helpers.ts';

const MB = 1024 * 1024;

describe.skipIf(!PERF_BUDGETS || !BUILT)('spm resident memory (TSBS_PERF=1, 06 §3)', () => {
  it('google-gemma4 stays ≤ 12 MB resident with the container released', async () => {
    v8.setFlagsFromString('--expose-gc');
    const gc = vm.runInNewContext('gc') as () => void;
    const settle = async (): Promise<void> => {
      for (let i = 0; i < 3; i++) {
        gc();
        await new Promise((resolve) => setTimeout(resolve, 0));
      }
    };
    const dist = join(REPO_ROOT, 'data', 'vocab', 'dist');
    const manifest = JSON.parse(readFileSync(join(dist, 'vocab-manifest.generated.json'), 'utf8')) as {
      assets: Record<string, { path: string }>;
    };
    const compressed = readFileSync(join(dist, manifest.assets['google-gemma4']!.path));
    const entry = registryEntry('google-gemma4');
    await settle();
    const before = process.memoryUsage().arrayBuffers;
    const build = (): ReturnType<typeof createSpmTokenizer> => {
      const raw = gunzipSync(compressed);
      const container = raw.buffer.slice(raw.byteOffset, raw.byteOffset + raw.byteLength);
      return createSpmTokenizer(readTsbv1(container), entry);
    };
    const tokenizer = build();
    tokenizer.encode('台灣台南 Hello'); // touch the lazy paths
    await settle();
    const resident = process.memoryUsage().arrayBuffers - before;
    console.log(`google-gemma4 resident: ${(resident / MB).toFixed(2)} MB (arrayBuffers delta)`);
    expect(resident).toBeGreaterThan(0);
    expect(resident).toBeLessThanOrEqual(12 * MB);
    expect(tokenizer.info.vocabSize).toBe(262_144); // keeps the engine alive until after the measurement
  });
});
