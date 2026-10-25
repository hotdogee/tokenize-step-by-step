/**
 * Command-line parsing for `tsbs-vocab` (03 §C.5). Pure: takes argv and the environment, returns a typed command or a
 * usage error, so the CLI entry stays a thin shell around it. Each subcommand accepts only its own options.
 */
import { parseArgs, type ParseArgsOptionsConfig } from 'node:util';
import { isConformanceMode, type ConformanceMode } from '@tsbs/conformance';

/** Every subcommand of 03 §C.5. */
export const COMMANDS = ['build', 'verify', 'inspect', 'guard', 'licences', 'examples'] as const;
export type CommandName = (typeof COMMANDS)[number];

/** What `build` does when an asset's raw files are absent (a SHA-256 mismatch always fails). */
export type MissingRawPolicy = 'fail' | 'skip';

/** Options of `tsbs-vocab build`. Paths are relative to the working directory (the repository root under `pnpm`). */
export interface BuildOptions {
  readonly manifest: string;
  readonly raw: string;
  readonly out: string;
  readonly only: string | null;
  readonly conformance: ConformanceMode;
  /** Where `conformance` came from, for the log line. */
  readonly conformanceSource: 'flag' | 'env' | 'default';
  /**
   * `fail` under `strict`; `skip` (with a warning per asset) under the interim modes, so CI stays green until the
   * workflow fetches `data/vocab/raw` (AD-32 interim; WP11).
   */
  readonly missingRaw: MissingRawPolicy;
  readonly fixtures: string;
  readonly licenses: string;
  /** Registry `tokenizers.json` (WP04): `withdrawn` flags and the engine factories' entries. */
  readonly registry: string;
}

export interface VerifyOptions {
  readonly out: string;
  readonly manifest: string;
  readonly raw: string;
}
export interface GuardCliOptions {
  readonly dist: string;
  /** null = skip the `/tok` ↔ manifest cross-check (`--vocab-manifest none`). */
  readonly vocabManifest: string | null;
}
export interface LicencesOptions {
  readonly out: string;
  readonly manifest: string;
  readonly licenses: string;
  readonly vocabManifest: string;
}
export interface ExamplesOptions {
  readonly fixtures: string;
  readonly chips: string;
  readonly out: string;
}

export type ParsedCommand =
  | { readonly kind: 'build'; readonly options: BuildOptions }
  | { readonly kind: 'verify'; readonly options: VerifyOptions }
  | { readonly kind: 'inspect'; readonly file: string }
  | { readonly kind: 'guard'; readonly options: GuardCliOptions }
  | { readonly kind: 'licences'; readonly options: LicencesOptions }
  | { readonly kind: 'examples'; readonly options: ExamplesOptions }
  | { readonly kind: 'help' }
  | { readonly kind: 'usage-error'; readonly message: string };

/** Default conformance mode when neither `--conformance` nor `CONFORMANCE_MODE` is set: the end state (AD-13). */
export const DEFAULT_CONFORMANCE: ConformanceMode = 'strict';

export const DEFAULTS = {
  manifest: 'tools/oracle/manifest.json',
  raw: 'data/vocab/raw',
  out: 'data/vocab/dist',
  fixtures: 'fixtures',
  licenses: 'docs/licenses',
  registry: 'packages/registry/data/tokenizers.json',
  chips: 'packages/registry/data/examples.json',
  dist: 'apps/web/dist',
  vocabManifest: 'data/vocab/dist/vocab-manifest.generated.json',
  licencesOut: 'packages/registry/data/licences.generated.json',
  examplesOut: 'data/vocab/dist/examples',
} as const;

export const USAGE = `Usage: tsbs-vocab <command> [options]

Commands (docs/design/03-data-model-and-assets.md §C.5):
  build     [--manifest <file>] [--raw <dir>] [--out <dir>] [--only <assetId|tokenizerId>]
            [--conformance strict|skip-missing-engine|off] [--missing-raw fail|skip]
            [--fixtures <dir>] [--licenses <dir>] [--registry <tokenizers.json>]
  verify    [--out <dir>] [--manifest <file>] [--raw <dir>]   decode every .bin, check sha256, round-trip vs raw
  inspect   <file.bin>                                          META, sections, first/last entries, sha256
  guard     [--dist <dir>] [--vocab-manifest <file>|none]       03 §C.8 deploy guards
  licences  [--out <file>] [--manifest <file>] [--licenses <dir>] [--vocab-manifest <file>]
  examples  [--fixtures <dir>] [--chips <examples.json>] [--out <dir>]

--conformance defaults to $CONFORMANCE_MODE, then to "${DEFAULT_CONFORMANCE}".
--missing-raw defaults to "fail" under strict and "skip" otherwise; a raw SHA-256 mismatch always fails.`;

const str = (fallback: string) => ({ type: 'string', default: fallback }) as const;

const OPTIONS = {
  build: {
    manifest: str(DEFAULTS.manifest),
    raw: str(DEFAULTS.raw),
    out: str(DEFAULTS.out),
    only: { type: 'string' },
    conformance: { type: 'string' },
    'missing-raw': { type: 'string' },
    fixtures: str(DEFAULTS.fixtures),
    licenses: str(DEFAULTS.licenses),
    registry: str(DEFAULTS.registry),
  },
  verify: { out: str(DEFAULTS.out), manifest: str(DEFAULTS.manifest), raw: str(DEFAULTS.raw) },
  inspect: {},
  guard: { dist: str(DEFAULTS.dist), 'vocab-manifest': str(DEFAULTS.vocabManifest) },
  licences: {
    out: str(DEFAULTS.licencesOut),
    manifest: str(DEFAULTS.manifest),
    licenses: str(DEFAULTS.licenses),
    'vocab-manifest': str(DEFAULTS.vocabManifest),
  },
  examples: { fixtures: str(DEFAULTS.fixtures), chips: str(DEFAULTS.chips), out: str(DEFAULTS.examplesOut) },
} as const satisfies Record<CommandName, ParseArgsOptionsConfig>;

function isCommand(value: string): value is CommandName {
  return (COMMANDS as readonly string[]).includes(value);
}

function parseBuild(
  values: Record<string, string | boolean | undefined>,
  env: Readonly<Record<string, string | undefined>>,
): ParsedCommand {
  const envMode = env['CONFORMANCE_MODE'];
  const flag = values['conformance'];
  const [rawMode, conformanceSource] =
    typeof flag === 'string'
      ? [flag, 'flag' as const]
      : envMode !== undefined && envMode !== ''
        ? [envMode, 'env' as const]
        : [DEFAULT_CONFORMANCE, 'default' as const];
  if (!isConformanceMode(rawMode))
    return { kind: 'usage-error', message: `invalid conformance mode "${rawMode}" (from ${conformanceSource})` };
  const missing = values['missing-raw'];
  if (missing !== undefined && missing !== 'fail' && missing !== 'skip')
    return { kind: 'usage-error', message: `invalid --missing-raw "${String(missing)}" (fail or skip)` };
  const only = values['only'];
  return {
    kind: 'build',
    options: {
      manifest: String(values['manifest']),
      raw: String(values['raw']),
      out: String(values['out']),
      only: typeof only === 'string' ? only : null,
      conformance: rawMode,
      conformanceSource,
      missingRaw: missing ?? (rawMode === 'strict' ? 'fail' : 'skip'),
      fixtures: String(values['fixtures']),
      licenses: String(values['licenses']),
      registry: String(values['registry']),
    },
  };
}

/** Parses `argv` (without the node and script entries). `env` supplies the `CONFORMANCE_MODE` fallback (AD-32). */
export function parseCommand(
  argv: readonly string[],
  env: Readonly<Record<string, string | undefined>>,
): ParsedCommand {
  const [command, ...rest] = argv;
  if (command === undefined || command === '--help' || command === '-h' || command === 'help') return { kind: 'help' };
  if (!isCommand(command)) return { kind: 'usage-error', message: `unknown command "${command}"` };
  let values: Record<string, string | boolean | undefined>;
  let positionals: string[];
  try {
    const parsed = parseArgs({
      args: rest,
      allowPositionals: true,
      strict: true,
      options: { ...OPTIONS[command], help: { type: 'boolean', short: 'h', default: false } },
    });
    values = parsed.values as Record<string, string | boolean | undefined>;
    positionals = parsed.positionals;
  } catch (error: unknown) {
    return { kind: 'usage-error', message: error instanceof Error ? error.message : String(error) };
  }
  if (values['help'] === true) return { kind: 'help' };
  if (command === 'inspect') {
    const [file, ...extra] = positionals;
    if (file === undefined || extra.length > 0)
      return { kind: 'usage-error', message: 'inspect takes exactly one <file.bin>' };
    return { kind: 'inspect', file };
  }
  if (positionals.length > 0) return { kind: 'usage-error', message: `unexpected argument "${positionals.join(' ')}"` };
  const s = (key: string): string => String(values[key]);
  switch (command) {
    case 'build':
      return parseBuild(values, env);
    case 'verify':
      return { kind: 'verify', options: { out: s('out'), manifest: s('manifest'), raw: s('raw') } };
    case 'guard':
      return {
        kind: 'guard',
        options: { dist: s('dist'), vocabManifest: s('vocab-manifest') === 'none' ? null : s('vocab-manifest') },
      };
    case 'licences':
      return {
        kind: 'licences',
        options: {
          out: s('out'),
          manifest: s('manifest'),
          licenses: s('licenses'),
          vocabManifest: s('vocab-manifest'),
        },
      };
    case 'examples':
      return { kind: 'examples', options: { fixtures: s('fixtures'), chips: s('chips'), out: s('out') } };
  }
}
