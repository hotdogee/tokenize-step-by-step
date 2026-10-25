/**
 * Shared setup of the spm engine suites: the BUILT assets (`data/vocab/dist`, gunzipped with node:zlib and decoded by
 * `readTsbv1` — core tests may not import the dev loaders of `@tsbs/vocab-tools`, 02 §2.1), the registry entries (read as
 * data from `packages/registry/data/tokenizers.json`) and small drivers. Suites skip with `SKIP_REASON` when the manifest
 * is absent (CI's unit job has it).
 */
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { gunzipSync } from 'node:zlib';
import { readTsbv1 } from '../../../src/format/tsbv1.ts';
import type { Tsbv1 } from '../../../src/format/types.ts';
import type { EncodeOptions, TokenizationResult, Tokenizer, TokenizerId } from '../../../src/index.ts';
import {
  createSpmEngine,
  createSpmTokenizer,
  resolveSpmConfig,
  type SpmEntryLike,
} from '../../../src/engines/spm/index.ts';
import { caseOf } from '../../helpers/fixtures.ts';
import { REPO_ROOT } from '../../helpers/repo.ts';

export const SPM_IDS = ['google-gemma4', 'google-gemma2', 'xai-grok1'] as const satisfies readonly TokenizerId[];
export type SpmId = (typeof SPM_IDS)[number];

const DIST = join(REPO_ROOT, 'data', 'vocab', 'dist');
const MANIFEST = join(DIST, 'vocab-manifest.generated.json');

/** True when the built assets are present. */
export const BUILT = existsSync(MANIFEST);
/** Appended to suite titles when they skip. */
export const SKIP_REASON = BUILT
  ? ''
  : ' (skipped: data/vocab/dist/vocab-manifest.generated.json is missing — run `pnpm vocab:build`)';

const tsbvCache = new Map<SpmId, Tsbv1>();

/** The decoded built asset of `id` (cached; the container buffer itself is not kept). */
export function builtTsbv(id: SpmId): Tsbv1 {
  let tsbv = tsbvCache.get(id);
  if (tsbv === undefined) {
    const manifest = JSON.parse(readFileSync(MANIFEST, 'utf8')) as { assets: Record<string, { path: string }> };
    const entry = manifest.assets[id];
    if (entry === undefined) throw new Error(`${id} is not in the vocab manifest`);
    const raw = gunzipSync(readFileSync(join(DIST, entry.path)));
    tsbv = readTsbv1(raw.buffer.slice(raw.byteOffset, raw.byteOffset + raw.byteLength));
    tsbvCache.set(id, tsbv);
  }
  return tsbv;
}

let entries: readonly SpmEntryLike[] | undefined;

/** The registry entry of `id`, as data. */
export function registryEntry(id: SpmId): SpmEntryLike {
  entries ??= JSON.parse(
    readFileSync(join(REPO_ROOT, 'packages', 'registry', 'data', 'tokenizers.json'), 'utf8'),
  ) as SpmEntryLike[];
  const entry = entries.find((e) => e.id === id);
  if (entry === undefined) throw new Error(`no registry entry for ${id}`);
  return entry;
}

/** The engine of `id` as the converter builds it. */
export function spmTokenizer(id: SpmId): Tokenizer {
  return createSpmTokenizer(builtTsbv(id), registryEntry(id));
}

/** The engine of `id` with the other byte-fallback order (both orders are literal, 04 §3.3). */
export function otherOrderTokenizer(id: SpmId): Tokenizer {
  const tsbv = builtTsbv(id);
  const config = resolveSpmConfig(tsbv, registryEntry(id));
  const fallbackOrder = config.fallbackOrder === 'after-merge' ? 'before-merge' : 'after-merge';
  return createSpmEngine(tsbv, { ...config, fallbackOrder });
}

/** Drains `encodeIncremental`, counting its yields. */
export function drain(
  tokenizer: Tokenizer,
  text: string,
  options: Partial<EncodeOptions>,
  budgetMs: number,
): { result: TokenizationResult; yields: number } {
  const gen = tokenizer.encodeIncremental(text, options, budgetMs);
  let yields = 0;
  for (;;) {
    const next = gen.next();
    if (next.done === true) return { result: next.value, yields };
    yields++;
  }
}

/** Token ids as a plain array. */
export const idsOf = (r: TokenizationResult): number[] => Array.from(r.tokens.id);

/** `[start, end)` of token `t`. */
export const spanOf = (r: TokenizationResult, t: number): [number, number] => [
  r.tokens.byteStart[t] ?? -1,
  r.tokens.byteStart[t + 1] ?? -1,
];

/** `count` CJK code points cycling over the Grok-1 `zh-tw-paragraph` text without its spaces (one SentencePiece word). */
export function spmCjkText(count: number): string {
  const unit = Array.from(caseOf('xai-grok1', 'zh-tw-paragraph').text).filter((ch) => ch !== ' ');
  return Array.from({ length: count }, (_, i) => unit[i % unit.length]).join('');
}
