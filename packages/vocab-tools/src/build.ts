/**
 * `tsbs-vocab build` (03 §C.5): per asset, verify the raw SHA-256 against the oracle manifest → refuse
 * `shipIntent !== 'ship'` or `withdrawn` → parse → validate → encode TSBV1 → conformance gate (AD-13/AD-32) → gzip-9 →
 * `.bin` + manifest entry (`sha256` and `sha256Raw`); then `licences.generated.json` and `MODIFIED-<assetId>.txt`.
 * Every asset is converted in memory first; any failure aborts the whole build before anything is written.
 * Deterministic: no timestamps beyond `retrievedOn` (or `SOURCE_DATE_EPOCH`), fixed section order and gzip parameters,
 * so two builds are byte-identical and unchanged vocabularies keep their hashed file names.
 */
import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import type { VocabAssetEntry, VocabManifest } from '@tsbs/core';
import type { BuildOptions } from './args.ts';
import { gzipDeterministic, sha256Hex } from './compress.ts';
import {
  checkConformance,
  readFixtureFile,
  registryEntryLoader,
  type ConformanceDeps,
  type ConformanceOutcome,
} from './conformance-gate.ts';
import { buildLicences, modificationNotice, modifiedFileText, stableJson, upstreamOf } from './licences.ts';
import { readOracleManifest, type OracleAsset, type OracleManifest } from './oracle-manifest.ts';
import { loadSourceInputs, RawInputError } from './raw.ts';
import { ASSET_SOURCES, findSource, type AssetSource } from './sources/index.ts';
import { encodeTsbv1, type EncodedContainer } from './tsbv-writer.ts';

/** File names inside `--out` (02 §6, AD-11). */
export const MANIFEST_FILE = 'vocab-manifest.generated.json';
export const LICENCES_FILE = 'licences.generated.json';

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

/** Every `retrievedOn` ISO date found anywhere in a parsed JSON value. */
function collectRetrievedOn(value: unknown, into: string[]): void {
  if (Array.isArray(value)) {
    for (const item of value) collectRetrievedOn(item, into);
  } else if (typeof value === 'object' && value !== null) {
    for (const [key, item] of Object.entries(value)) {
      if (key === 'retrievedOn' && typeof item === 'string' && ISO_DATE.test(item)) into.push(item);
      else collectRetrievedOn(item, into);
    }
  }
}

/** The UTC date of `SOURCE_DATE_EPOCH`, or null when unset. */
function epochDate(env: Readonly<Record<string, string | undefined>>): string | null {
  const epoch = env['SOURCE_DATE_EPOCH'];
  if (epoch === undefined || epoch === '') return null;
  const seconds = Number(epoch);
  if (!Number.isInteger(seconds) || seconds < 0)
    throw new Error(`SOURCE_DATE_EPOCH must be a non-negative integer, got "${epoch}"`);
  return new Date(seconds * 1000).toISOString().slice(0, 10);
}

/**
 * Deterministic `builtOn` (02 §7: no timestamps beyond `retrievedOn`): the UTC date of `SOURCE_DATE_EPOCH` when set,
 * otherwise the newest `retrievedOn` in the oracle manifest.
 */
export function resolveBuiltOn(env: Readonly<Record<string, string | undefined>>, oracleManifest: unknown): string {
  const fromEpoch = epochDate(env);
  if (fromEpoch !== null) return fromEpoch;
  const dates: string[] = [];
  collectRetrievedOn(oracleManifest, dates);
  const newest = dates.sort().at(-1);
  if (newest === undefined) throw new Error('no retrievedOn date in the oracle manifest; set SOURCE_DATE_EPOCH');
  return newest;
}

/**
 * Date in an asset's modification statement: `SOURCE_DATE_EPOCH` when set, else the newest `retrievedOn` of the files
 * the conversion read. Per asset, so re-fetching one vocabulary never renames another's `.bin`.
 */
export function conversionDate(
  env: Readonly<Record<string, string | undefined>>,
  asset: OracleAsset,
  source: AssetSource,
): string {
  const fromEpoch = epochDate(env);
  if (fromEpoch !== null) return fromEpoch;
  const names = new Set([source.vocabFile, ...source.configFiles]);
  const dates = asset.files
    .filter((f) => names.has(f.name))
    .map((f) => f.retrievedOn)
    .sort();
  const newest = dates.at(-1);
  if (newest === undefined) throw new Error(`${asset.id}: no retrievedOn for its vocabulary files`);
  return newest;
}

/** `@tsbs/vocab-tools@<version>` from this package's package.json. */
export async function generatorId(): Promise<string> {
  const pkg: unknown = JSON.parse(await readFile(new URL('../package.json', import.meta.url), 'utf8'));
  const version = typeof pkg === 'object' && pkg !== null && 'version' in pkg ? pkg.version : undefined;
  if (typeof version !== 'string') throw new Error('packages/vocab-tools/package.json has no version');
  return `@tsbs/vocab-tools@${version}`;
}

/** Injected module objects (the CLI passes `import * as core` / `import * as conformance`; tests pass fakes). */
export interface BuildDeps {
  readonly core: Readonly<Record<string, unknown>>;
  readonly conformance: Readonly<Record<string, unknown>>;
}

/** One converted asset, still in memory. */
export interface ConvertedAsset {
  readonly source: AssetSource;
  readonly asset: OracleAsset;
  readonly container: EncodedContainer;
  readonly gzip: Uint8Array;
  readonly entry: VocabAssetEntry;
  readonly statement: string;
  readonly conformance: ConformanceOutcome;
  readonly notes: readonly string[];
}

/** Size line per asset for the build log and the WP03 report. */
export interface AssetReport {
  readonly tokenizerId: string;
  readonly path: string;
  readonly bytesRaw: number;
  readonly bytesCompressed: number;
  readonly sections: string;
  readonly maxPieceBytes: number;
  readonly conformance: ConformanceOutcome['kind'];
}

export interface BuildResult {
  readonly manifestPath: string;
  readonly manifest: VocabManifest;
  readonly licencesPath: string;
  readonly warnings: readonly string[];
  readonly info: readonly string[];
  readonly assets: readonly AssetReport[];
}

/** Whether `asset` may be converted at all (03 §C.5; AD-14 `withdrawn`). Returns the refusal reason or null. */
export function refusalReason(asset: OracleAsset, registryEntry: unknown): string | null {
  if (asset.shipIntent !== 'ship')
    return `${asset.id} has shipIntent "${asset.shipIntent}" (only "ship" assets are converted)`;
  if (asset.withdrawn) return `${asset.id} is withdrawn in the oracle manifest`;
  if (
    typeof registryEntry === 'object' &&
    registryEntry !== null &&
    (registryEntry as Record<string, unknown>)['withdrawn'] === true
  )
    return `${asset.id} is withdrawn in the registry (tokenizers.json)`;
  return null;
}

/** Converts one source in memory: verified inputs → tables → container → conformance → gzip → manifest entry. */
export async function convertAsset(
  source: AssetSource,
  oracle: OracleManifest,
  options: BuildOptions,
  env: Readonly<Record<string, string | undefined>>,
  generator: string,
  conformanceDeps: ConformanceDeps,
): Promise<ConvertedAsset> {
  const asset = oracle.assets.find((a) => a.id === source.assetId);
  if (asset === undefined) throw new Error(`oracle manifest has no asset ${source.assetId}`);
  const inputs = await loadSourceInputs(source, options.raw, oracle);
  const tables = await source.parse(inputs);
  const upstream = upstreamOf(asset, source);
  const statement = modificationNotice(upstream.file, upstream.sha256, generator, conversionDate(env, asset, source));
  const container = encodeTsbv1(tables, { upstream, modificationNotice: statement, generator });
  const conformance = await checkConformance(
    options.conformance,
    {
      tokenizerId: source.tokenizerId,
      family: source.family,
      container: container.bytes,
      fixturePath: join(options.fixtures, `${source.tokenizerId}.json`),
    },
    conformanceDeps,
  );
  const gzip = gzipDeterministic(container.bytes);
  const sha256 = sha256Hex(gzip);
  const entry: VocabAssetEntry = {
    path: `/tok/${source.tokenizerId}/${sha256.slice(0, 12)}.bin`,
    format: 'tsbv1',
    family: source.family,
    encoding: 'gzip',
    bytesCompressed: gzip.length,
    bytesRaw: container.bytes.length,
    sha256,
    sha256Raw: sha256Hex(container.bytes),
    upstream,
    counts: container.meta.counts,
  };
  return { source, asset, container, gzip, entry, statement, conformance, notes: tables.notes };
}

async function readExistingManifest(path: string): Promise<VocabManifest | null> {
  try {
    const parsed = JSON.parse(await readFile(path, 'utf8')) as VocabManifest;
    return typeof parsed.assets === 'object' ? parsed : null;
  } catch {
    return null;
  }
}

function report(converted: ConvertedAsset): AssetReport {
  return {
    tokenizerId: converted.source.tokenizerId,
    path: converted.entry.path,
    bytesRaw: converted.entry.bytesRaw,
    bytesCompressed: converted.entry.bytesCompressed,
    sections: converted.container.sections.map((s) => `${s.tag} ${String(s.length)}`).join(', '),
    maxPieceBytes: converted.container.meta.maxPieceBytes,
    conformance: converted.conformance.kind,
  };
}

/** Modification statements (by asset id) of the assets a vocab manifest lists. */
export function modificationStatements(
  oracle: OracleManifest,
  vocab: VocabManifest | null,
  generator: string,
  env: Readonly<Record<string, string | undefined>>,
): Map<string, string> {
  const statements = new Map<string, string>();
  for (const source of ASSET_SOURCES) {
    const asset = oracle.assets.find((a) => a.id === source.assetId);
    if (asset === undefined || vocab?.assets[source.tokenizerId] === undefined) continue;
    const upstream = upstreamOf(asset, source);
    statements.set(
      asset.id,
      modificationNotice(upstream.file, upstream.sha256, generator, conversionDate(env, asset, source)),
    );
  }
  return statements;
}

/** Runs the build and writes `<out>/tok/**`, the vocab manifest, the licences file and the MODIFIED notices. */
export async function runBuild(
  options: BuildOptions,
  env: Readonly<Record<string, string | undefined>>,
  deps: BuildDeps,
): Promise<BuildResult> {
  const { manifest: oracle, json: oracleJson } = await readOracleManifest(options.manifest);
  const generator = await generatorId();
  const builtOn = resolveBuiltOn(env, oracleJson);
  const registryEntry = registryEntryLoader(options.registry);
  const conformanceDeps: ConformanceDeps = {
    core: deps.core,
    conformance: deps.conformance,
    registryEntry,
    readFixture: readFixtureFile,
  };
  const warnings: string[] = [];
  const info: string[] = [];

  let sources: readonly AssetSource[] = ASSET_SOURCES;
  if (options.only !== null) {
    const source = findSource(options.only);
    if (source === undefined) throw new Error(`--only ${options.only}: no such shipped asset or tokenizer`);
    sources = [source];
  }
  if (options.conformance === 'off')
    warnings.push('--conformance off: conformance disabled — local development only, never in CI (AD-13).');

  const converted: ConvertedAsset[] = [];
  for (const source of sources) {
    const asset = oracle.assets.find((a) => a.id === source.assetId);
    if (asset === undefined) throw new Error(`oracle manifest has no asset ${source.assetId}`);
    const refusal = refusalReason(asset, await registryEntry(source.tokenizerId));
    if (refusal !== null) {
      if (options.only !== null) throw new Error(`refusing to convert: ${refusal}`);
      warnings.push(`ASSET SKIPPED: ${refusal}.`);
      continue;
    }
    let result: ConvertedAsset;
    try {
      result = await convertAsset(source, oracle, options, env, generator, conformanceDeps);
    } catch (error: unknown) {
      if (
        error instanceof RawInputError &&
        error.message.startsWith('missing raw file') &&
        options.missingRaw === 'skip'
      ) {
        warnings.push(`ASSET SKIPPED for ${source.tokenizerId}: ${error.message} (--missing-raw skip).`);
        continue;
      }
      throw error;
    }
    if (result.conformance.kind === 'failed')
      throw new Error(`refusing to write ${source.tokenizerId}: ${result.conformance.message}`);
    if (result.conformance.kind === 'skipped' && options.conformance !== 'off')
      warnings.push(result.conformance.message);
    if (result.conformance.kind === 'passed') info.push(result.conformance.message);
    info.push(`${source.tokenizerId}: ${result.notes.join('; ')}`);
    converted.push(result);
  }

  // Everything converted: write the outputs.
  const manifestPath = join(options.out, MANIFEST_FILE);
  const previous = options.only === null ? null : await readExistingManifest(manifestPath);
  const assets: Record<string, VocabAssetEntry> = {};
  for (const source of ASSET_SOURCES) {
    const fresh = converted.find((c) => c.source === source);
    const kept = previous?.assets[source.tokenizerId];
    if (fresh !== undefined) assets[source.tokenizerId] = fresh.entry;
    else if (kept !== undefined && !sources.includes(source)) assets[source.tokenizerId] = kept;
  }
  const manifest: VocabManifest = { schema: 1, builtOn, generator, assets };
  // The licences document can still fail (stale docs/licenses), so it is built before anything is written.
  const licences = await buildLicences({
    oracle,
    licensesDir: options.licenses,
    generator,
    builtOn,
    vocab: manifest,
    statements: modificationStatements(oracle, manifest, generator, env),
  });

  if (options.only === null) {
    await rm(join(options.out, 'tok'), { recursive: true, force: true });
    await rm(join(options.out, 'licenses'), { recursive: true, force: true });
  }
  for (const c of converted) {
    const dir = join(options.out, 'tok', c.source.tokenizerId);
    await rm(dir, { recursive: true, force: true });
    await mkdir(dir, { recursive: true });
    await writeFile(join(options.out, ...c.entry.path.slice(1).split('/')), c.gzip);
    const modified = join(options.out, 'licenses', c.asset.id, `MODIFIED-${c.asset.id}.txt`);
    await mkdir(dirname(modified), { recursive: true });
    await writeFile(modified, modifiedFileText(c.asset, c.entry, c.statement), 'utf8');
  }
  await mkdir(options.out, { recursive: true });
  await writeFile(manifestPath, stableJson(manifest), 'utf8');
  const licencesPath = join(options.out, LICENCES_FILE);
  await writeFile(licencesPath, stableJson(licences), 'utf8');

  return { manifestPath, manifest, licencesPath, warnings, info, assets: converted.map(report) };
}
