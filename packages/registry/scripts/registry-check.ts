/**
 * `pnpm registry:check` (02 §6, 03 §B.7): runs `checkRegistry` on this checkout — the registry data files, the oracle
 * manifest, the golden fixtures, the licence texts and, when `data/vocab/dist` exists, the built assets' META — prints
 * one line per issue and exits 1 if there is any. The negative tests run next (`vitest run --project registry`, chained
 * in the root script).
 *
 * `--require-built` (CI's `unit` job, after it downloads the `vocab-dist` artifact) also exits 1 when no built asset was
 * compared, so the `maxTokenBytes === META.maxPieceBytes` and id cross-checks (WP04 acceptance) can never pass vacuously.
 */
import process from 'node:process';
import { parseArgs } from 'node:util';
import { checkRegistry } from '../src/check.ts';
import { loadRegistryInput } from './load-inputs.ts';

const { values: flags } = parseArgs({ options: { 'require-built': { type: 'boolean', default: false } } });
const input = loadRegistryInput();
const issues = checkRegistry(input);

for (const issue of issues) console.error(`registry:check ERROR [${issue.rule}] ${issue.where}: ${issue.message}`);
const built =
  input.built === null
    ? 'no built assets (data/vocab/dist absent)'
    : `${String(input.built.size)} built asset(s) compared`;
const builtMissing = flags['require-built'] && (input.built === null || input.built.size === 0);
if (builtMissing)
  console.error(`registry:check ERROR [built-required] data/vocab/dist: --require-built was given but ${built}.`);
if (issues.length > 0 || builtMissing) {
  console.error(`registry:check: ${String(issues.length + (builtMissing ? 1 : 0))} issue(s); ${built}.`);
  process.exitCode = 1;
} else {
  console.log(
    `registry:check: OK — ${String(input.fixtures.size)} fixtures cross-checked; tokenizers, models, licences, examples, byok and strings are consistent; ${built}.`,
  );
}
