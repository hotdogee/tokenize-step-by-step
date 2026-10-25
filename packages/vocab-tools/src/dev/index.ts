/**
 * `@tsbs/vocab-tools/dev` — dev loaders (07 §1, 02 §5): plain readers that turn an upstream vocabulary file into the
 * in-memory tables the converter would write, so engine work and `vite dev` never wait for `vocab:build`.
 *
 * - `loadTiktokenText` / `loadClaudeJson` / `loadGrok2Json` / `loadHfJson` / `loadSpmModel` return `VocabTables`
 *   (pieces in id order, TYPS, scores, merges, specials, META config facts).
 * - `toContainer(tables)` encodes them as an uncompressed TSBV1 container for `readTsbv1` (WP02) — the same bytes
 *   `tsbs-vocab build` gzips, minus provenance.
 * - `buildInMemory()` runs the real per-asset pipeline (SHA-256-verified, conformance off) without writing files; the
 *   `vocabAssets()` Vite plugin serves its output under `/tok` when `data/vocab/dist` is missing.
 *
 * The loaders do not verify SHA-256 (they take any path); the converter and `buildInMemory` do.
 */
import { readFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import type { VocabAssetEntry, VocabManifest } from '@tsbs/core';
import { DEFAULTS, type BuildOptions } from '../args.ts';
import { convertAsset, generatorId, refusalReason, resolveBuiltOn } from '../build.ts';
import { readOracleManifest } from '../oracle-manifest.ts';
import { parseClaudeJson } from '../sources/claude-json.ts';
import { parseGrok2Json } from '../sources/grok2-json.ts';
import { parseHfByteLevelJson } from '../sources/hf-bytelevel.ts';
import { parseHfSpmJson } from '../sources/hf-spm-json.ts';
import { ASSET_SOURCES } from '../sources/index.ts';
import { loadSpecialsTable } from '../sources/specials.ts';
import { parseSpmModel } from '../sources/spm-proto.ts';
import { parseTiktokenText } from '../sources/tiktoken-text.ts';
import { encodeTsbv1 } from '../tsbv-writer.ts';
import type { VocabTables } from '../tables.ts';

export type { VocabTables, SpecialEntry, MergeTable, TableConfig } from '../tables.ts';
export { PieceType } from '../tables.ts';

/** Tokenizers stored as tiktoken rank text. */
export type TiktokenTextTokenizer = 'openai-o200k_base' | 'openai-cl100k_base' | 'meta-llama3';
/** Tokenizers stored as SentencePiece `.model`. */
export type SpmModelTokenizer = 'google-gemma2' | 'xai-grok1';

/** A tiktoken rank file (`o200k_base.tiktoken`, `cl100k_base.tiktoken`, Llama 3 `tokenizer.model`), with its committed specials. */
export async function loadTiktokenText(path: string, tokenizerId: TiktokenTextTokenizer): Promise<VocabTables> {
  const table = await loadSpecialsTable(tokenizerId);
  const bos = tokenizerId === 'meta-llama3' ? table.specials.find((s) => s.text === '<|begin_of_text|>') : undefined;
  return parseTiktokenText(await readFile(path, 'utf8'), {
    tokenizerId,
    specials: table.specials,
    ...(bos === undefined ? {} : { bosId: bos.id }),
  });
}

/** A SentencePiece BPE `.model` (Grok-1, Gemma 1/2). */
export async function loadSpmModel(path: string, tokenizerId: SpmModelTokenizer): Promise<VocabTables> {
  return parseSpmModel(new Uint8Array(await readFile(path)), tokenizerId);
}

/**
 * An HF `tokenizer.json`: Muse Glimmer (byte-level → `meta-llama4-muse`) or Gemma 4 (SentencePiece-style → `google-gemma4`,
 * which also reads the sibling `tokenizer_config.json` unless `configPath` is given). The kind is detected from
 * `model.byte_fallback`. The A2 merge-regeneration check is skipped (it is informational and costs ~1 s).
 */
export async function loadHfJson(path: string, configPath?: string): Promise<VocabTables> {
  const json: unknown = JSON.parse(await readFile(path, 'utf8'));
  const model = typeof json === 'object' && json !== null ? (json as Record<string, unknown>)['model'] : undefined;
  const byteFallback =
    typeof model === 'object' && model !== null && (model as Record<string, unknown>)['byte_fallback'] === true;
  if (!byteFallback) return parseHfByteLevelJson(json);
  const config: unknown = JSON.parse(
    await readFile(configPath ?? join(dirname(path), 'tokenizer_config.json'), 'utf8'),
  );
  return parseHfSpmJson(json, config, { regenerationCheck: false });
}

/** The legacy Claude `claude.json`. */
export async function loadClaudeJson(path: string): Promise<VocabTables> {
  return parseClaudeJson(await readFile(path, 'utf8'));
}

/** xAI Grok-2 `tokenizer.tok.json`. */
export async function loadGrok2Json(path: string): Promise<VocabTables> {
  return parseGrok2Json(await readFile(path, 'utf8'));
}

const DEV_UPSTREAM: VocabAssetEntry['upstream'] = {
  assetId: 'dev',
  file: 'dev',
  sha256: '0'.repeat(64),
  url: 'about:blank',
  revision: 'dev',
  retrievedOn: '1970-01-01',
};

/** Encodes tables as an uncompressed TSBV1 container (dev provenance in META) for `readTsbv1`. */
export function toContainer(tables: VocabTables, upstream: VocabAssetEntry['upstream'] = DEV_UPSTREAM): Uint8Array {
  return encodeTsbv1(tables, { upstream, modificationNotice: 'dev loader (not a shipped asset)', generator: 'dev' })
    .bytes;
}

/** Output of {@link buildInMemory}: a vocab manifest and the gzip files keyed by their root-relative path. */
export interface InMemoryBuild {
  readonly manifest: VocabManifest;
  readonly files: ReadonlyMap<string, Uint8Array>;
  readonly skipped: readonly string[];
}

/**
 * Converts every shipped asset whose raw files exist (SHA-256-verified; conformance off — this is for `vite dev` only,
 * never for a deploy) and returns the manifest + gzip files without writing anything.
 */
export async function buildInMemory(
  paths: { readonly manifest?: string; readonly raw?: string } = {},
): Promise<InMemoryBuild> {
  const options: BuildOptions = {
    manifest: paths.manifest ?? DEFAULTS.manifest,
    raw: paths.raw ?? DEFAULTS.raw,
    out: DEFAULTS.out,
    only: null,
    conformance: 'off',
    conformanceSource: 'flag',
    missingRaw: 'skip',
    fixtures: DEFAULTS.fixtures,
    licenses: DEFAULTS.licenses,
    registry: DEFAULTS.registry,
  };
  const { manifest: oracle, json } = await readOracleManifest(options.manifest);
  const generator = await generatorId();
  const assets: Record<string, VocabAssetEntry> = {};
  const files = new Map<string, Uint8Array>();
  const skipped: string[] = [];
  const deps = {
    core: {},
    conformance: {},
    readTsbv1: null,
    registryEntry: () => Promise.resolve(null),
    readFixture: () => Promise.resolve(null),
  };
  for (const source of ASSET_SOURCES) {
    const asset = oracle.assets.find((a) => a.id === source.assetId);
    const refusal =
      asset === undefined ? `${source.assetId} is not in the oracle manifest` : refusalReason(asset, null);
    if (refusal !== null) {
      skipped.push(`${source.tokenizerId}: ${refusal}`);
      continue;
    }
    try {
      const converted = await convertAsset(source, oracle, options, {}, generator, deps);
      assets[source.tokenizerId] = converted.entry;
      files.set(converted.entry.path, converted.gzip);
    } catch (error: unknown) {
      skipped.push(`${source.tokenizerId}: ${error instanceof Error ? error.message : String(error)}`);
    }
  }
  return { manifest: { schema: 1, builtOn: resolveBuiltOn({}, json), generator, assets }, files, skipped };
}
