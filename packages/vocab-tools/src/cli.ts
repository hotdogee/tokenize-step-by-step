#!/usr/bin/env node
/**
 * `tsbs-vocab` entry point (Node ≥ 26 runs this TypeScript file directly; `erasableSyntaxOnly` keeps that possible).
 * Exit codes: 0 success, 1 failure or a command not implemented yet, 2 usage error.
 */
import process from 'node:process';
import * as core from '@tsbs/core';
import { parseCommand, USAGE } from './args.ts';
import { runBuild } from './build.ts';

/** Prints a warning; inside GitHub Actions also as a workflow annotation so skipped conformance is visible on the run. */
function warn(message: string): void {
  if (process.env['GITHUB_ACTIONS'] === 'true') console.log(`::warning title=tsbs-vocab::${message}`);
  console.warn(`WARNING: ${message}`);
}

async function main(argv: readonly string[]): Promise<number> {
  const command = parseCommand(argv, process.env);
  switch (command.kind) {
    case 'help':
      console.log(USAGE);
      return 0;
    case 'usage-error':
      console.error(`tsbs-vocab: ${command.message}\n\n${USAGE}`);
      return 2;
    case 'pending':
      console.error(
        `tsbs-vocab ${command.command}: not implemented until WP03 (docs/design/03-data-model-and-assets.md §C.5).`,
      );
      return 1;
    case 'build': {
      const result = await runBuild(command.options, process.env, core);
      for (const message of result.warnings) warn(message);
      console.log(
        `tsbs-vocab build: wrote ${result.manifestPath} (${String(Object.keys(result.manifest.assets).length)} assets).`,
      );
      return 0;
    }
  }
}

main(process.argv.slice(2)).then(
  (code) => {
    process.exitCode = code;
  },
  (error: unknown) => {
    console.error(`tsbs-vocab: ${error instanceof Error ? error.message : String(error)}`);
    process.exitCode = 1;
  },
);
