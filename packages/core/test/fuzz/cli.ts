/**
 * `pnpm test:fuzz` — fuzz the nine engines against the Python oracles (WP12; 04 §7, 06 §1, PA-9).
 *
 *   pnpm test:fuzz                               # 2,000 strings per tokenizer, the fixed seed 20261025
 *   pnpm test:fuzz --seed 20261026 --n 10000     # nightly-fuzz.yml: the date seed, 10,000 per tokenizer
 *   pnpm test:fuzz --tokenizer google-gemma4     # one tokenizer (repeatable, or comma-separated)
 *   pnpm test:fuzz --out <dir> | --no-write      # where candidates go (default fixtures/candidates) / nowhere
 *   pnpm test:fuzz --max-shrinks 0               # classify on the full strings, no minimal repros
 *
 * Needs the built assets (`pnpm vocab:build` → data/vocab/dist; the engines decode them with `readTsbv1`), the raw files
 * (`pnpm vocab:fetch` → data/vocab/raw; the oracles and second opinions read them) and uv (the oracle lane's venv:
 * `uv run --project tools/oracle`, or `$TSBS_ORACLE_PROJECT`). Every oracle divergence is printed (the divergence log:
 * second opinion, class, minimal repro). Exit 0 = no engine mismatch, no oracle error and every divergence classified;
 * 1 = findings to triage (written to `<out>/<tokenizer>-<seed>.json` in the fixture case shape with `classification`,
 * minimal repros printed); 2 = usage or setup error.
 */
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import process from 'node:process';
import { parseArgs } from 'node:util';
import type { TokenizerId } from '../../src/index.ts';
import { findRawVocabDir, REPO_ROOT } from '../helpers/repo.ts';
import { readAlphabetFile } from './alphabet.ts';
import { engineFor, FUZZ_TOKENIZERS } from './engines.ts';
import { type OracleLike, startPythonOracle } from './oracle-client.ts';
import { printable, summaryTable } from './report.ts';
import { candidateFile, runTokenizer, type TokenizerReport } from './run.ts';
import { secondOpinionFor } from './second-opinions.ts';
import { writeCandidates } from './candidates.ts';

/** The fixed seed of the every-PR smoke (ci.yml fuzz-smoke) and the default run. */
export const FIXED_SEED = 20261025;
export const DEFAULT_N = 2000;

function fail(message: string): never {
  console.error(`test:fuzz: ${message}`);
  process.exit(2);
}

function positiveInt(name: string, value: string | undefined, fallback: number): number {
  if (value === undefined) return fallback;
  const n = Number(value);
  if (!Number.isSafeInteger(n) || n < 0) fail(`--${name} must be a non-negative integer, got ${value}`);
  return n;
}

async function main(): Promise<void> {
  const { values } = parseArgs({
    options: {
      seed: { type: 'string' },
      n: { type: 'string' },
      tokenizer: { type: 'string', multiple: true },
      out: { type: 'string' },
      'no-write': { type: 'boolean' },
      'max-shrinks': { type: 'string' },
      help: { type: 'boolean' },
    },
  });
  if (values.help === true) {
    console.log(
      'usage: pnpm test:fuzz [--seed N] [--n N] [--tokenizer ID[,ID]] [--out DIR | --no-write] [--max-shrinks N]',
    );
    return;
  }
  const seed = positiveInt('seed', values.seed, FIXED_SEED);
  const n = positiveInt('n', values.n, DEFAULT_N);
  const maxShrinks = positiveInt('max-shrinks', values['max-shrinks'], 50);
  const requested = (values.tokenizer ?? []).flatMap((t) => t.split(',')).filter((t) => t !== '');
  const unknown = requested.filter((t) => !(FUZZ_TOKENIZERS as readonly string[]).includes(t));
  if (unknown.length > 0) fail(`unknown tokenizer(s) ${unknown.join(', ')}; known: ${FUZZ_TOKENIZERS.join(', ')}`);
  const tokenizers = requested.length === 0 ? FUZZ_TOKENIZERS : (requested as TokenizerId[]);
  const outDir = values['no-write'] === true ? null : (values.out ?? join(REPO_ROOT, 'fixtures', 'candidates'));

  if (!existsSync(join(REPO_ROOT, 'data', 'vocab', 'dist', 'vocab-manifest.generated.json')))
    fail(
      'data/vocab/dist has no vocab-manifest.generated.json — run `pnpm vocab:build` (the engines read the built .bin)',
    );
  const raw = findRawVocabDir();
  if (raw === null) fail('data/vocab/raw is missing — run `pnpm vocab:fetch`');

  const started = performance.now();
  console.log(
    `test:fuzz seed ${String(seed)}, ${String(n)} strings per tokenizer, ${String(tokenizers.length)} tokenizer(s); ` +
      `oracle tools/oracle/fuzz_oracle.py (ids + spans, fixture policy); engines over data/vocab/dist via readTsbv1`,
  );
  let oracle: OracleLike;
  try {
    oracle = await startPythonOracle();
  } catch (error) {
    fail(error instanceof Error ? error.message : String(error));
  }
  const reports: TokenizerReport[] = [];
  try {
    for (const tokenizer of tokenizers) {
      const t0 = performance.now();
      const report = await runTokenizer({
        tokenizer,
        seed,
        n,
        alphabet: readAlphabetFile(),
        oracle,
        engine: engineFor(tokenizer),
        secondOpinion: secondOpinionFor(tokenizer, raw),
        maxShrinks,
      });
      reports.push(report);
      console.log(
        `  ${tokenizer}: ${String(report.strings)} strings in ${((performance.now() - t0) / 1000).toFixed(1)} s` +
          (report.cases.length > 0 ? `, ${String(report.cases.length)} finding(s)` : ''),
      );
      // A candidates file is written only when something needs triage (an engine/oracle failure or an unclassified
      // divergence); it then carries every case of the run for context. Classified divergences are the log below.
      if (outDir !== null && report.failures > 0) {
        const path = writeCandidates(outDir, candidateFile(report, seed, n, new Date().toISOString().slice(0, 10)));
        console.log(`    candidates → ${path}`);
      }
      for (const c of report.cases.filter((x) => x.classification !== 'oracle-divergence').slice(0, 10)) {
        console.log(`    ✗ ${c.name} [${c.classification}] ${c.explanation}`);
        console.log(`      text    ${printable(c.text)}`);
        if (c.minimal !== undefined)
          console.log(`      minimal ${printable(c.minimal.text)} (UTF-8 ${c.minimal.utf8Hex})`);
      }
      // The oracle-divergence log: one line per divergence with its class and minimal repro.
      for (const c of report.cases.filter((x) => x.classification === 'oracle-divergence')) {
        const mark = c.divergenceClass === 'unclassified' ? '?' : '~';
        console.log(
          `    ${mark} ${c.name} oracle-divergence vs ${c.secondOpinion?.library ?? '?'} [${c.divergenceClass ?? '?'}] ` +
            `minimal ${printable(c.minimal?.text ?? c.text)} — ${c.explanation}`,
        );
      }
    }
  } finally {
    await oracle.close();
  }
  console.log('');
  console.log(summaryTable(reports, seed, n, (performance.now() - started) / 1000));
  if (reports.some((r) => r.failures > 0)) process.exitCode = 1;
}

await main();
