/**
 * `vitest bench`: vocab init in the Worker (06 §3: o200k ≤ 25 ms, Gemma 4 ≤ 40 ms in Node ⇒ ×4 on the phone) on the
 * BUILT assets — `readTsbv1` of the decompressed container (what the loader hands the engine after gunzip + SHA-256),
 * and `readTsbv1` + the engine factory (the whole step before `loaded`). Run with `pnpm bench`; `check-bench.ts` asserts
 * the medians when `TSBS_PERF=1`. Skips without `data/vocab/dist` (`pnpm vocab:build`).
 */
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { gunzipSync } from 'node:zlib';
import { bench, describe } from 'vitest';
import { createByteLevelTokenizer } from '../../src/engines/bytelevel/index.ts';
import { createSpmTokenizer } from '../../src/engines/spm/index.ts';
import { readTsbv1 } from '../../src/format/tsbv1.ts';
import type { VocabManifest } from '../../src/index.ts';
import { registryEntry as byteLevelEntry } from '../engines/bytelevel/assets.ts';
import { registryEntry as spmEntry } from '../engines/spm/helpers.ts';
import { REPO_ROOT } from '../helpers/repo.ts';
import { initBench } from './benches.ts';

const DIST = join(REPO_ROOT, 'data', 'vocab', 'dist');
const MANIFEST = join(DIST, 'vocab-manifest.generated.json');
const BUILT = existsSync(MANIFEST);

/** The decompressed TSBV1 container of `id` (a fresh ArrayBuffer, as the loader passes it). */
function container(id: 'openai-o200k_base' | 'google-gemma4'): ArrayBuffer {
  const manifest = JSON.parse(readFileSync(MANIFEST, 'utf8')) as VocabManifest;
  const entry = manifest.assets[id];
  if (entry === undefined) throw new Error(`${id} is not in ${MANIFEST}`);
  const raw = gunzipSync(readFileSync(join(DIST, entry.path)));
  return raw.buffer.slice(raw.byteOffset, raw.byteOffset + raw.byteLength);
}

const OPTIONS = { time: 1500, warmupIterations: 5 } as const;

describe.skipIf(!BUILT)('vocab init (06 §3)', () => {
  const o200k = BUILT ? container('openai-o200k_base') : new ArrayBuffer(0);
  const gemma4 = BUILT ? container('google-gemma4') : new ArrayBuffer(0);

  bench(initBench('openai-o200k_base', false).name, () => void readTsbv1(o200k), OPTIONS);
  bench(
    initBench('openai-o200k_base', true).name,
    () => void createByteLevelTokenizer(readTsbv1(o200k), byteLevelEntry('openai-o200k_base')),
    OPTIONS,
  );
  bench(initBench('google-gemma4', false).name, () => void readTsbv1(gemma4), OPTIONS);
  bench(
    initBench('google-gemma4', true).name,
    () => void createSpmTokenizer(readTsbv1(gemma4), spmEntry('google-gemma4')),
    OPTIONS,
  );
});
