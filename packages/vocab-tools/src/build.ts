/**
 * `tsbs-vocab build` — WP00 STUB. The real pipeline (parse → validate → TSBV1 → conformance → gzip → `.bin` + manifest,
 * 03 §C.5) is WP03's. Until then this writes an empty but schema-valid `vocab-manifest.generated.json` so the rest of
 * `pnpm build` (Vite, `check:dist`, `wrangler deploy --dry-run`) runs, and it reports the conformance mode exactly as the
 * real converter will (AD-32): one "CONFORMANCE SKIPPED" warning per family whose engine `@tsbs/core` does not export.
 */
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { VocabManifest } from '@tsbs/core';
import { ENGINE_FACTORIES, familiesMissingEngine } from '@tsbs/conformance';
import type { BuildOptions } from './args.ts';

/** File name of the generated manifest inside `--out` (02 §6, AD-11). */
export const MANIFEST_FILE = 'vocab-manifest.generated.json';

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

/** The manifest the stub writes: no assets yet. */
export function emptyManifest(builtOn: string, generator: string): VocabManifest {
  return { schema: 1, builtOn, generator, assets: {} };
}

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

/**
 * Deterministic `builtOn` (02 §7: no timestamps beyond `retrievedOn`): the UTC date of `SOURCE_DATE_EPOCH` when set,
 * otherwise the newest `retrievedOn` in the oracle manifest.
 */
export function resolveBuiltOn(env: Readonly<Record<string, string | undefined>>, oracleManifest: unknown): string {
  const epoch = env['SOURCE_DATE_EPOCH'];
  if (epoch !== undefined && epoch !== '') {
    const seconds = Number(epoch);
    if (!Number.isInteger(seconds) || seconds < 0)
      throw new Error(`SOURCE_DATE_EPOCH must be a non-negative integer, got "${epoch}"`);
    return new Date(seconds * 1000).toISOString().slice(0, 10);
  }
  const dates: string[] = [];
  collectRetrievedOn(oracleManifest, dates);
  const newest = dates.sort().at(-1);
  if (newest === undefined) throw new Error('no retrievedOn date in the oracle manifest; set SOURCE_DATE_EPOCH');
  return newest;
}

/** `@tsbs/vocab-tools@<version>` from this package's package.json. */
export async function generatorId(): Promise<string> {
  const pkg: unknown = JSON.parse(await readFile(new URL('../package.json', import.meta.url), 'utf8'));
  const version = typeof pkg === 'object' && pkg !== null && 'version' in pkg ? pkg.version : undefined;
  if (typeof version !== 'string') throw new Error('packages/vocab-tools/package.json has no version');
  return `@tsbs/vocab-tools@${version}`;
}

/** Conformance log lines for `mode` given the engines `coreModule` exports (AD-32). */
export function conformanceWarnings(options: BuildOptions, coreModule: Readonly<Record<string, unknown>>): string[] {
  const source = `--conformance ${options.conformance} (from ${options.conformanceSource})`;
  switch (options.conformance) {
    case 'off':
      return [`${source}: conformance disabled — local development only, never in CI (AD-13).`];
    case 'strict':
      return [`${source}: no assets to check — the converter is a stub until WP03.`];
    case 'skip-missing-engine':
      return familiesMissingEngine(coreModule).map(
        (family) =>
          `CONFORMANCE SKIPPED for ${family}: @tsbs/core does not export ${ENGINE_FACTORIES[family]} yet (${source}; AD-32).`,
      );
  }
}

export interface BuildResult {
  readonly manifestPath: string;
  readonly manifest: VocabManifest;
  readonly warnings: readonly string[];
}

/** Runs the stub build: writes `<out>/vocab-manifest.generated.json` (stable JSON, trailing newline) and returns warnings. */
export async function runBuild(
  options: BuildOptions,
  env: Readonly<Record<string, string | undefined>>,
  coreModule: Readonly<Record<string, unknown>>,
): Promise<BuildResult> {
  const oracleManifest: unknown = JSON.parse(await readFile(options.manifest, 'utf8'));
  const manifest = emptyManifest(resolveBuiltOn(env, oracleManifest), await generatorId());
  await mkdir(options.out, { recursive: true });
  const manifestPath = join(options.out, MANIFEST_FILE);
  await writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`, 'utf8');
  const warnings = [
    `tsbs-vocab build is a STUB until WP03: no vocabulary assets were built; ${manifestPath} lists none.`,
    ...(options.only === null ? [] : [`--only ${options.only} is accepted but has no effect in the stub.`]),
    ...conformanceWarnings(options, coreModule),
  ];
  return { manifestPath, manifest, warnings };
}
