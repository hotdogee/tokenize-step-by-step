/**
 * Command-line parsing for `tsbs-vocab` (03 §C.5). Pure: takes argv and the environment, returns a typed command or a
 * usage error, so the CLI entry stays a thin shell around it.
 */
import { parseArgs } from 'node:util';
import { isConformanceMode, type ConformanceMode } from '@tsbs/conformance';

/** Every subcommand of 03 §C.5. Only `build` exists (as a stub) before WP03. */
export const COMMANDS = ['build', 'verify', 'inspect', 'guard', 'licences', 'examples'] as const;
export type CommandName = (typeof COMMANDS)[number];

/** Options of `tsbs-vocab build`. Paths are relative to the working directory (the repository root under `pnpm`). */
export interface BuildOptions {
  readonly manifest: string;
  readonly raw: string;
  readonly out: string;
  readonly only: string | null;
  readonly conformance: ConformanceMode;
  /** Where `conformance` came from, for the log line. */
  readonly conformanceSource: 'flag' | 'env' | 'default';
}

export type ParsedCommand =
  | { readonly kind: 'build'; readonly options: BuildOptions }
  | { readonly kind: 'pending'; readonly command: Exclude<CommandName, 'build'> }
  | { readonly kind: 'help' }
  | { readonly kind: 'usage-error'; readonly message: string };

/** Default conformance mode when neither `--conformance` nor `CONFORMANCE_MODE` is set: the end state (AD-13). */
export const DEFAULT_CONFORMANCE: ConformanceMode = 'strict';

export const USAGE = `Usage: tsbs-vocab <command> [options]

Commands (docs/design/03-data-model-and-assets.md §C.5):
  build     --manifest <file> --raw <dir> --out <dir> [--only <assetId>] [--conformance strict|skip-missing-engine|off]
  verify | inspect | guard | licences | examples   (implemented by WP03)

--conformance defaults to $CONFORMANCE_MODE, then to "${DEFAULT_CONFORMANCE}".`;

function isCommand(value: string): value is CommandName {
  return (COMMANDS as readonly string[]).includes(value);
}

/** Parses `argv` (without the node and script entries). `env` supplies the `CONFORMANCE_MODE` fallback (AD-32). */
export function parseCommand(
  argv: readonly string[],
  env: Readonly<Record<string, string | undefined>>,
): ParsedCommand {
  let parsed;
  try {
    parsed = parseArgs({
      args: [...argv],
      allowPositionals: true,
      strict: true,
      options: {
        manifest: { type: 'string', default: 'tools/oracle/manifest.json' },
        raw: { type: 'string', default: 'data/vocab/raw' },
        out: { type: 'string', default: 'data/vocab/dist' },
        only: { type: 'string' },
        conformance: { type: 'string' },
        help: { type: 'boolean', short: 'h', default: false },
      },
    });
  } catch (error: unknown) {
    return { kind: 'usage-error', message: error instanceof Error ? error.message : String(error) };
  }
  const { values, positionals } = parsed;
  const [command, ...rest] = positionals;
  if (values.help || command === undefined) return { kind: 'help' };
  if (!isCommand(command)) return { kind: 'usage-error', message: `unknown command "${command}"` };
  if (command !== 'build') return { kind: 'pending', command };
  if (rest.length > 0) return { kind: 'usage-error', message: `unexpected argument "${rest.join(' ')}"` };

  const envMode = env['CONFORMANCE_MODE'];
  const [rawMode, conformanceSource] =
    values.conformance !== undefined
      ? [values.conformance, 'flag' as const]
      : envMode !== undefined && envMode !== ''
        ? [envMode, 'env' as const]
        : [DEFAULT_CONFORMANCE, 'default' as const];
  if (!isConformanceMode(rawMode)) {
    return { kind: 'usage-error', message: `invalid conformance mode "${rawMode}" (from ${conformanceSource})` };
  }
  return {
    kind: 'build',
    options: {
      manifest: values.manifest,
      raw: values.raw,
      out: values.out,
      only: values.only ?? null,
      conformance: rawMode,
      conformanceSource,
    },
  };
}
