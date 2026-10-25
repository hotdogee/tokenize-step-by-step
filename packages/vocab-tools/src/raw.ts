/**
 * Hermetic raw-input loading (02 §7): every file a parser reads is SHA-256-verified against `tools/oracle/manifest.json`
 * before parsing; a mismatch aborts the build. Optional cross-check files of oracle-only assets are verified when
 * present and skipped when absent.
 */
import { readFile, stat } from 'node:fs/promises';
import { join } from 'node:path';
import { sha256Hex } from './compress.ts';
import { oracleFile, type OracleManifest } from './oracle-manifest.ts';
import type { AssetSource, SourceInputs } from './sources/index.ts';

/** Thrown when a raw file is missing or does not match its manifest SHA-256. */
export class RawInputError extends Error {
  override readonly name = 'RawInputError';
}

async function exists(path: string): Promise<boolean> {
  return stat(path).then(
    (s) => s.isFile(),
    () => false,
  );
}

/** Reads `data/vocab/raw/<assetId>/<name>` and checks it against the manifest entry. */
export async function readVerified(
  rawDir: string,
  manifest: OracleManifest,
  assetId: string,
  name: string,
): Promise<Uint8Array> {
  const asset = manifest.assets.find((a) => a.id === assetId);
  if (asset === undefined) throw new RawInputError(`oracle manifest has no asset ${assetId}`);
  const entry = oracleFile(asset, name);
  const path = join(rawDir, assetId, ...name.split('/'));
  let bytes: Uint8Array;
  try {
    bytes = new Uint8Array(await readFile(path));
  } catch {
    throw new RawInputError(`missing raw file ${path} — run pnpm vocab:fetch`);
  }
  const actual = sha256Hex(bytes);
  if (actual !== entry.sha256)
    throw new RawInputError(`raw SHA-256 mismatch for ${assetId}/${name}: manifest ${entry.sha256}, file ${actual}`);
  return bytes;
}

/** Loads and verifies every input of `source`. */
export async function loadSourceInputs(
  source: AssetSource,
  rawDir: string,
  manifest: OracleManifest,
): Promise<SourceInputs> {
  const files = new Map<string, Uint8Array>();
  for (const name of [source.vocabFile, ...source.configFiles])
    files.set(name, await readVerified(rawDir, manifest, source.assetId, name));
  const crossCheck = new Map<string, Uint8Array>();
  for (const { assetId, file } of source.crossCheck) {
    if (!(await exists(join(rawDir, assetId, ...file.split('/'))))) continue;
    crossCheck.set(`${assetId}/${file}`, await readVerified(rawDir, manifest, assetId, file));
  }
  return { files, crossCheck };
}
