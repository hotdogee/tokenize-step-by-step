#!/usr/bin/env node
/**
 * `tsbs-vocab` entry point (Node ≥ 26 runs this TypeScript file directly; `erasableSyntaxOnly` keeps that possible).
 * Exit codes: 0 success, 1 failure (incl. guard/verify violations), 2 usage error.
 */
import { readFile } from 'node:fs/promises';
import process from 'node:process';
import * as conformance from '@tsbs/conformance';
import * as core from '@tsbs/core';
import { parseCommand, USAGE } from './args.ts';
import { runBuild } from './build.ts';
import { runExamples, runLicences } from './commands.ts';
import { runGuard } from './guard.ts';
import { inspectReport } from './inspect.ts';
import { runVerify } from './verify.ts';

/** Prints a warning; inside GitHub Actions also as a workflow annotation so skipped conformance is visible on the run. */
function warn(message: string): void {
  if (process.env['GITHUB_ACTIONS'] === 'true') console.log(`::warning title=tsbs-vocab::${message}`);
  console.warn(`WARNING: ${message}`);
}

const kib = (bytes: number): string => `${(bytes / 1024).toFixed(1)} KB`;

async function main(argv: readonly string[]): Promise<number> {
  const command = parseCommand(argv, process.env);
  switch (command.kind) {
    case 'help':
      console.log(USAGE);
      return 0;
    case 'usage-error':
      console.error(`tsbs-vocab: ${command.message}\n\n${USAGE}`);
      return 2;
    case 'build': {
      const o = command.options;
      console.log(
        `tsbs-vocab build: --conformance ${o.conformance} (from ${o.conformanceSource}), --missing-raw ${o.missingRaw}`,
      );
      const result = await runBuild(o, process.env, { core, conformance });
      for (const line of result.info) console.log(`  ${line}`);
      for (const message of result.warnings) warn(message);
      for (const a of result.assets)
        console.log(
          `  ${a.tokenizerId}: ${a.path} raw ${kib(a.bytesRaw)} gzip ${kib(a.bytesCompressed)} maxPieceBytes ${String(a.maxPieceBytes)} [${a.sections}] conformance ${a.conformance}`,
        );
      console.log(
        `tsbs-vocab build: wrote ${result.manifestPath} (${String(Object.keys(result.manifest.assets).length)} assets) and ${result.licencesPath}.`,
      );
      return 0;
    }
    case 'verify': {
      const report = await runVerify(command.options);
      for (const line of report.checked) console.log(`  ${line}`);
      for (const message of report.warnings) warn(message);
      for (const message of report.errors) console.error(`tsbs-vocab verify ERROR: ${message}`);
      return report.errors.length === 0 ? 0 : 1;
    }
    case 'inspect':
      console.log(inspectReport(new Uint8Array(await readFile(command.file))));
      return 0;
    case 'guard': {
      const report = await runGuard({ dist: command.options.dist, manifest: command.options.vocabManifest });
      for (const message of report.warnings) warn(message);
      for (const message of report.errors) console.error(`tsbs-vocab guard ERROR: ${message}`);
      if (report.errors.length === 0)
        console.log(
          `tsbs-vocab guard: ${String(report.files)} files OK (/tok ${(report.tokBytes / 1024 / 1024).toFixed(2)} MiB).`,
        );
      return report.errors.length === 0 ? 0 : 1;
    }
    case 'licences': {
      const licences = await runLicences(command.options, process.env);
      console.log(`tsbs-vocab licences: wrote ${command.options.out} (${String(licences.assets.length)} ship assets).`);
      return 0;
    }
    case 'examples': {
      const { output, warning } = await runExamples(command.options);
      if (warning !== null) warn(warning);
      for (const f of [...output.perTokenizer, output.defaultExample, output.index])
        console.log(`  ${f.name}: ${String(f.bytes)} B, gzip ${String(f.gzipBytes)} B`);
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
