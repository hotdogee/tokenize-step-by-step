/**
 * `tsbs-vocab verify` (02 §6 `vocab:verify`): re-reads every `.bin` the vocab manifest lists, checks the gzip and
 * container SHA-256 and sizes, decodes the container, checks META against the manifest entry and the oracle manifest,
 * and — when the raw files are present — re-parses the upstream source and requires identical tables.
 */
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { VocabManifest } from '@tsbs/core';
import type { VerifyOptions } from './args.ts';
import { firstTableDifference } from './compare.ts';
import { gunzip, sha256Hex } from './compress.ts';
import { MANIFEST_FILE } from './build.ts';
import { decodeContainer } from './inspect.ts';
import { readOracleManifest } from './oracle-manifest.ts';
import { loadSourceInputs, RawInputError } from './raw.ts';
import { ASSET_SOURCES } from './sources/index.ts';

export interface VerifyReport {
  readonly errors: readonly string[];
  readonly warnings: readonly string[];
  readonly checked: readonly string[];
}

/** Verifies the converter output in `options.out`. Never throws for a mismatch (reported in `errors`). */
export async function runVerify(options: VerifyOptions): Promise<VerifyReport> {
  const errors: string[] = [];
  const warnings: string[] = [];
  const checked: string[] = [];
  const manifest = JSON.parse(await readFile(join(options.out, MANIFEST_FILE), 'utf8')) as VocabManifest;
  const { manifest: oracle } = await readOracleManifest(options.manifest);
  for (const [tokenizerId, entry] of Object.entries(manifest.assets)) {
    const fail = (message: string): void => {
      errors.push(`${tokenizerId}: ${message}`);
    };
    const source = ASSET_SOURCES.find((s) => s.tokenizerId === tokenizerId);
    if (source === undefined) {
      fail('not a shipped tokenizer');
      continue;
    }
    let file: Uint8Array;
    try {
      file = new Uint8Array(await readFile(join(options.out, ...entry.path.slice(1).split('/'))));
    } catch {
      fail(`${entry.path} is missing`);
      continue;
    }
    if (sha256Hex(file) !== entry.sha256) fail('sha256 of the .bin differs from the manifest');
    if (!entry.path.endsWith(`/${entry.sha256.slice(0, 12)}.bin`)) fail('file name is not sha256[0:12]');
    if (file.length !== entry.bytesCompressed) fail('bytesCompressed differs');
    let container: Uint8Array;
    try {
      container = gunzip(file);
    } catch (error: unknown) {
      fail(`not a gzip file (${error instanceof Error ? error.message : String(error)})`);
      continue;
    }
    if (sha256Hex(container) !== entry.sha256Raw) fail('sha256Raw differs');
    if (container.length !== entry.bytesRaw) fail('bytesRaw differs');
    let decoded: ReturnType<typeof decodeContainer>;
    try {
      decoded = decodeContainer(container);
    } catch (error: unknown) {
      fail(`container does not decode (${error instanceof Error ? error.message : String(error)})`);
      continue;
    }
    const meta = decoded.meta;
    if (meta.tokenizerId !== tokenizerId || meta.family !== entry.family)
      fail('META tokenizerId/family differ from the manifest');
    if (JSON.stringify(meta.upstream) !== JSON.stringify(entry.upstream))
      fail('META upstream differs from the manifest entry');
    if (JSON.stringify(meta.counts) !== JSON.stringify(entry.counts))
      fail('META counts differ from the manifest entry');
    if (meta.unusedCount !== 0) fail(`unusedCount ${String(meta.unusedCount)} (must be 0)`);
    const oracleAsset = oracle.assets.find((a) => a.id === source.assetId);
    const oracleSha = oracleAsset?.files.find((f) => f.name === source.vocabFile)?.sha256;
    if (oracleSha !== meta.upstream.sha256) fail('META upstream sha256 differs from tools/oracle/manifest.json');
    try {
      const tables = await source.parse(await loadSourceInputs(source, options.raw, oracle));
      const diff = firstTableDifference(decoded, tables);
      if (diff !== null) fail(`round trip vs raw: ${diff}`);
      else checked.push(`${tokenizerId}: ${entry.path} OK (round trip vs raw identical)`);
    } catch (error: unknown) {
      if (error instanceof RawInputError && error.message.startsWith('missing raw file')) {
        warnings.push(`${tokenizerId}: raw files absent, round trip skipped`);
        checked.push(`${tokenizerId}: ${entry.path} OK (hashes and structure)`);
      } else fail(error instanceof Error ? error.message : String(error));
    }
  }
  return { errors, warnings, checked };
}
