/**
 * Test-only access to the BUILT byte-level assets: `data/vocab/dist/vocab-manifest.generated.json` names each
 * `/tok/<id>/<sha12>.bin` (gzip), which is gunzipped with node:zlib and decoded with `readTsbv1` — the same bytes the
 * Worker loads. `@tsbs/core` may not import the dev loaders of `@tsbs/vocab-tools` (02 §2.1), so the suites need
 * `pnpm vocab:build` (CI's unit job has the output) and skip with a message when the manifest is absent. Registry entries
 * are read as plain JSON from `packages/registry/data/tokenizers.json` (a file read, not a package import).
 */
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { gunzipSync } from 'node:zlib';
import type { ByteLevelEntryLike } from '../../../src/engines/bytelevel/config.ts';
import { ByteLevelTokenizer, type ByteLevelEngineOptions } from '../../../src/engines/bytelevel/engine.ts';
import { readTsbv1 } from '../../../src/format/tsbv1.ts';
import type { TiktokenFixture, TokenizerId, Tsbv1, VocabManifest } from '../../../src/index.ts';
import { loadFixture } from '../../helpers/fixtures.ts';
import { REPO_ROOT } from '../../helpers/repo.ts';

/** The six byte-level tokenizers (04 §2). */
export const BYTELEVEL_IDS = [
  'openai-o200k_base',
  'openai-cl100k_base',
  'meta-llama3',
  'meta-llama4-muse',
  'xai-grok2',
  'anthropic-claude-legacy',
] as const satisfies readonly TokenizerId[];
export type ByteLevelId = (typeof BYTELEVEL_IDS)[number];

const DIST = join(REPO_ROOT, 'data', 'vocab', 'dist');
const MANIFEST = join(DIST, 'vocab-manifest.generated.json');

/** Null when the built assets exist, else the reason the suites skip. */
export const SKIP_REASON: string | null = existsSync(MANIFEST)
  ? null
  : `no built vocabulary (${MANIFEST}); run \`CONFORMANCE_MODE=skip-missing-engine pnpm vocab:build\` first`;

if (SKIP_REASON !== null) console.warn(`[bytelevel] skipping the asset suites: ${SKIP_REASON}`);

let manifest: VocabManifest | undefined;
const tsbvCache = new Map<string, Tsbv1>();
let entries: readonly ByteLevelEntryLike[] | undefined;

/** The decoded built asset of `id` (cached per process). */
export function builtTsbv(id: ByteLevelId): Tsbv1 {
  let tsbv = tsbvCache.get(id);
  if (tsbv === undefined) {
    manifest ??= JSON.parse(readFileSync(MANIFEST, 'utf8')) as VocabManifest;
    const asset = manifest.assets[id];
    if (asset === undefined) throw new Error(`${id} is not in ${MANIFEST}`);
    const raw = gunzipSync(readFileSync(join(DIST, asset.path)));
    tsbv = readTsbv1(raw.buffer.slice(raw.byteOffset, raw.byteOffset + raw.byteLength));
    tsbvCache.set(id, tsbv);
  }
  return tsbv;
}

/** The registry `TokenizerEntry` of `id`, as the converter's gate passes it (raw JSON). */
export function registryEntry(id: ByteLevelId): ByteLevelEntryLike {
  entries ??= JSON.parse(
    readFileSync(join(REPO_ROOT, 'packages', 'registry', 'data', 'tokenizers.json'), 'utf8'),
  ) as readonly ByteLevelEntryLike[];
  const entry = entries.find((e) => e.id === id);
  if (entry === undefined) throw new Error(`no registry entry for ${id}`);
  return entry;
}

/** A fresh engine over the built asset of `id`. */
export function tokenizerFor(id: ByteLevelId, options?: ByteLevelEngineOptions): ByteLevelTokenizer {
  return new ByteLevelTokenizer(builtTsbv(id), registryEntry(id), options);
}

/** The golden fixture of `id`. */
export function fixtureOf(id: ByteLevelId): TiktokenFixture {
  const fixture = loadFixture(id);
  if (fixture.family !== 'tiktoken-bpe') throw new Error(`${id} is not a tiktoken fixture`);
  return fixture;
}

/** `count` CJK ideographs cycling over a fixed 64-character zh-TW alphabet (deterministic; one regex chunk). */
export function cjkText(count: number): string {
  const alphabet =
    '台灣台南高雄臺北新竹嘉義花蓮宜蘭基隆桃園苗栗彰化南投雲林屏東澎湖金門馬祖今天天氣很好我們一起去吃飯吧這是測試文字中文字元繁體';
  const chars = Array.from(alphabet);
  let out = '';
  for (let i = 0; i < count; i++) out += chars[(i * 7 + (i >> 6)) % chars.length] ?? '';
  return out;
}
