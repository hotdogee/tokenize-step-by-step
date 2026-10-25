/**
 * `licences.generated.json` and the per-asset `MODIFIED-<assetId>.txt` notices (03 §B.7, AD-14, 05 §14): generated from
 * `tools/oracle/manifest.json` + `docs/licenses/**` (+ the vocab manifest when assets were built), covering every
 * `shipIntent: ship` asset with its SPDX id, verbatim obligations, provenance notes, pinned source URLs and revisions,
 * the SHA-256 of every licence snapshot and of the shipped `.bin`, and the modification statement.
 */
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { TokenizerId, VocabAssetEntry, VocabManifest } from '@tsbs/core';
import { sha256Hex } from './compress.ts';
import { isSnapshotted, oracleFile, type OracleAsset, type OracleManifest } from './oracle-manifest.ts';
import { ASSET_SOURCES, type AssetSource } from './sources/index.ts';

/** One licence text served at `/licenses/<assetId>/<name>`. */
export interface LicenceTextFile {
  readonly name: string;
  readonly role: string;
  /** Root-relative URL on the site. */
  readonly path: string;
  readonly sha256: string;
  readonly bytes: number;
  /** True for a Notice file rendered from the manifest (Llama 3 `NOTICE.txt`), not an upstream copy. */
  readonly rendered: boolean;
}

export interface LicenceAsset {
  readonly assetId: string;
  readonly tokenizerId: TokenizerId | null;
  readonly lab: string;
  readonly description: string;
  readonly spdx: string;
  readonly shipIntent: string;
  readonly shipNote: string | null;
  readonly obligations: readonly string[];
  readonly provenance: string;
  readonly licence: {
    readonly file: string;
    readonly sourceUrl: string;
    readonly path: string;
    readonly sha256: string;
  };
  readonly notice: { readonly file: string; readonly text: string } | null;
  readonly texts: readonly LicenceTextFile[];
  readonly upstream: VocabAssetEntry['upstream'] | null;
  readonly shipped: {
    readonly path: string;
    readonly sha256: string;
    readonly sha256Raw: string;
    readonly bytesCompressed: number;
    readonly bytesRaw: number;
  } | null;
  readonly modified: { readonly statement: string; readonly path: string } | null;
  /** Where the asset's special-token table comes from, and anything a reader must know about it. */
  readonly specials: { readonly source: string; readonly note: string | null };
}

export interface LicencesGenerated {
  readonly schema: 1;
  readonly generator: string;
  readonly builtOn: string;
  readonly source: 'tools/oracle/manifest.json';
  readonly assets: readonly LicenceAsset[];
}

/** Where each source's SPCL table comes from (AD-12). */
const SPECIALS_SOURCE: Readonly<Record<string, string>> = {
  'openai-o200k_base': 'tiktoken 0.14.0 tiktoken_ext/openai_public.py o200k_base() (committed in sources/specials)',
  'openai-cl100k_base': 'tiktoken 0.14.0 tiktoken_ext/openai_public.py cl100k_base() (committed in sources/specials)',
  'anthropic-claude-legacy': 'claude.json special_tokens',
  'google-gemma4': 'tokenizer.json added_tokens[special=true]',
  'google-gemma2': 'tokenizer.model CONTROL and UNK pieces',
  'meta-muse-glimmer': 'tokenizer.json added_tokens (Muse Glimmer names)',
  'meta-llama3-model': 'llama-models models/llama3/tokenizer.py at 5fdf8311 (committed in sources/specials)',
  'xai-grok2': 'tokenizer.tok.json special_tokens',
  'xai-grok1': 'tokenizer.model CONTROL and UNK pieces',
};

/** The Llama 3 note required by WP03's acceptance: which special names ship. */
export const LLAMA3_SPECIALS_NOTE =
  'Special tokens ship with the llama-models tokenizer.py names (Llama 3.1+): <|finetune_right_pad_id|> 128004, ' +
  '<|step_id|> 128005, <|eom_id|> 128008, <|python_tag|> 128010, <|image|> 128011, and <|reserved_special_token_2|> … ' +
  '<|reserved_special_token_245|> at 128012–128255. The fixture cross-check used the Xenova Llama 3.0 added_tokens, ' +
  'whose ids agree but which name those ids <|reserved_special_token_2|>, _3, _4, _5, _6 and number the remaining ' +
  'reserved tokens from 7.';

/** The modification statement (licences.json MODIFIED template, 03 §B.7). */
export function modificationNotice(file: string, sha256: string, generator: string, date: string): string {
  const tool = generator.replace(/^(@tsbs\/vocab-tools)@/, '$1 ');
  return `Converted to the TSBV1 container from ${file} (sha256 ${sha256}) by ${tool} on ${date}; vocabulary contents unchanged.`;
}

/** Body of `MODIFIED-<assetId>.txt`. */
export function modifiedFileText(asset: OracleAsset, entry: VocabAssetEntry, statement: string): string {
  return [
    `MODIFIED: ${asset.id}`,
    '',
    statement,
    '',
    `Shipped file: ${entry.path} (gzip; sha256 ${entry.sha256}; TSBV1 container sha256 ${entry.sha256Raw}).`,
    `Upstream: ${entry.upstream.url} (revision ${entry.upstream.revision}, retrieved ${entry.upstream.retrievedOn}).`,
    '',
  ].join('\n');
}

/** Site path of an asset's MODIFIED notice. */
export function modifiedPath(assetId: string): string {
  return `/licenses/${assetId}/MODIFIED-${assetId}.txt`;
}

async function snapshotSha(
  licensesDir: string,
  assetId: string,
  name: string,
): Promise<{ sha256: string; bytes: number }> {
  const path = join(licensesDir, assetId, ...name.split('/'));
  let data: Uint8Array;
  try {
    data = new Uint8Array(await readFile(path));
  } catch {
    throw new Error(`licence snapshot ${path} is missing — run tools/oracle/render_license_docs.py / fetch_vocab.py`);
  }
  return { sha256: sha256Hex(data), bytes: data.length };
}

function sourceOf(assetId: string): AssetSource | undefined {
  return ASSET_SOURCES.find((s) => s.assetId === assetId);
}

/** The upstream block (vocab file) of a shipped asset. */
export function upstreamOf(asset: OracleAsset, source: AssetSource): VocabAssetEntry['upstream'] {
  const file = oracleFile(asset, source.vocabFile);
  return {
    assetId: asset.id,
    file: file.name,
    sha256: file.sha256,
    url: file.url,
    revision: file.revision,
    retrievedOn: file.retrievedOn,
  };
}

/** Builds the licences document. `vocab` adds the shipped `.bin` facts and MODIFIED statements of built assets. */
export async function buildLicences(options: {
  readonly oracle: OracleManifest;
  readonly licensesDir: string;
  readonly generator: string;
  readonly builtOn: string;
  readonly vocab: VocabManifest | null;
  readonly statements: ReadonlyMap<string, string>;
}): Promise<LicencesGenerated> {
  const assets: LicenceAsset[] = [];
  for (const asset of options.oracle.assets) {
    if (asset.shipIntent !== 'ship' || asset.withdrawn) continue;
    const source = sourceOf(asset.id);
    const texts: LicenceTextFile[] = [];
    for (const file of asset.files.filter(isSnapshotted)) {
      const { sha256, bytes } = await snapshotSha(options.licensesDir, asset.id, file.name);
      if (sha256 !== file.sha256)
        throw new Error(
          `docs/licenses/${asset.id}/${file.name} differs from the manifest sha256 — re-run fetch_vocab.py`,
        );
      texts.push({
        name: file.name,
        role: file.role,
        path: `/licenses/${asset.id}/${file.name}`,
        sha256,
        bytes,
        rendered: false,
      });
    }
    if (asset.license.notice !== null) {
      const { sha256, bytes } = await snapshotSha(options.licensesDir, asset.id, asset.license.notice.file);
      const name = asset.license.notice.file;
      texts.push({ name, role: 'notice', path: `/licenses/${asset.id}/${name}`, sha256, bytes, rendered: true });
    }
    const primary = texts.find((t) => t.name === asset.license.file);
    if (primary === undefined) throw new Error(`${asset.id}: licence file ${asset.license.file} is not snapshotted`);
    const entry = source === undefined ? undefined : options.vocab?.assets[source.tokenizerId];
    const statement = options.statements.get(asset.id);
    assets.push({
      assetId: asset.id,
      tokenizerId: source?.tokenizerId ?? null,
      lab: asset.lab,
      description: asset.description,
      spdx: asset.license.spdx,
      shipIntent: asset.shipIntent,
      shipNote: asset.shipNote,
      obligations: asset.license.obligations,
      provenance: asset.notes,
      licence: {
        file: asset.license.file,
        sourceUrl: asset.license.sourceUrl,
        path: primary.path,
        sha256: primary.sha256,
      },
      notice: asset.license.notice,
      texts,
      upstream: source === undefined ? null : upstreamOf(asset, source),
      shipped:
        entry === undefined
          ? null
          : {
              path: entry.path,
              sha256: entry.sha256,
              sha256Raw: entry.sha256Raw,
              bytesCompressed: entry.bytesCompressed,
              bytesRaw: entry.bytesRaw,
            },
      modified: entry === undefined || statement === undefined ? null : { statement, path: modifiedPath(asset.id) },
      specials: {
        source: SPECIALS_SOURCE[asset.id] ?? 'unknown',
        note: asset.id === 'meta-llama3-model' ? LLAMA3_SPECIALS_NOTE : null,
      },
    });
  }
  return {
    schema: 1,
    generator: options.generator,
    builtOn: options.builtOn,
    source: 'tools/oracle/manifest.json',
    assets,
  };
}

/** Stable JSON text (two-space indent, trailing newline) used for every generated JSON file. */
export function stableJson(value: unknown): string {
  return `${JSON.stringify(value, null, 2)}\n`;
}
