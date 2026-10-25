/**
 * Dist guards CLI (03 §C.8, 06 §3; implementation in `lib/dist-guards.ts`).
 *
 *   node scripts/check-dist.ts [--dist apps/web/dist] [--manifest data/vocab/dist/vocab-manifest.generated.json]
 *   node scripts/check-dist.ts --vocab [--dist data/vocab/dist]
 *
 * The first form is `pnpm check:dist` (followed by `size-limit`); the second is `pnpm vocab:guard`, run by the CI `vocab`
 * job on the converter output before it is uploaded. Exit code 1 on any error; warnings never fail.
 */
import process from 'node:process';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';
import { runGuards, VOCAB_MANIFEST_FILE, type GuardOptions } from './lib/dist-guards.ts';

const fromRoot = (path: string): string => fileURLToPath(new URL(`../${path}`, import.meta.url));

const { values } = parseArgs({
  options: {
    vocab: { type: 'boolean', default: false },
    dist: { type: 'string' },
    manifest: { type: 'string' },
  },
});

const options: GuardOptions = values.vocab
  ? { mode: 'vocab', dist: values.dist ?? fromRoot('data/vocab/dist') }
  : {
      mode: 'site',
      dist: values.dist ?? fromRoot('apps/web/dist'),
      manifest: values.manifest ?? fromRoot(`data/vocab/dist/${VOCAB_MANIFEST_FILE}`),
    };
const name = values.vocab ? 'vocab:guard' : 'check:dist';
const report = runGuards(options);
for (const message of report.warnings) console.warn(`${name} WARNING: ${message}`);
if (report.errors.length > 0) {
  for (const message of report.errors) console.error(`${name} ERROR: ${message}`);
  process.exitCode = 1;
} else {
  console.log(
    `${name}: ${String(report.fileCount)} files OK in ${options.dist} (/tok ${(report.tokBytes / 1024 / 1024).toFixed(2)} MiB).`,
  );
}
