/**
 * Reads the JSON report of `vitest bench --outputJson` (the `pnpm bench` suites) and holds every benchmark median to its
 * 06 §3 Node ceiling (`../helpers/ceilings.ts`; the phone budget is the ceiling × 4). Prints one line per benchmark
 * with the median, p99, sample count, ceiling and phone equivalent. With `TSBS_PERF=1` a median over its ceiling exits 1
 * (the opt-in assertion, like the `TSBS_PERF=1` tests); without it the table is a report.
 *
 *   node packages/core/test/bench/check-bench.ts [report.json]
 */
import { readFileSync } from 'node:fs';
import { cpus } from 'node:os';
import process from 'node:process';
import { PHONE_MARGIN } from '../helpers/ceilings.ts';
import { allBenches, ceilingOf } from './benches.ts';

interface BenchJson {
  readonly files: ReadonlyArray<{
    readonly groups: ReadonlyArray<{
      readonly fullName: string;
      readonly benchmarks: ReadonlyArray<{
        readonly name: string;
        readonly median: number;
        readonly mean: number;
        readonly p99: number;
        readonly sampleCount: number;
      }>;
    }>;
  }>;
}

const DEFAULT_REPORT = new URL('../../node_modules/.cache/tsbs/bench.json', import.meta.url);
const path = process.argv[2] ?? DEFAULT_REPORT;
const report = JSON.parse(readFileSync(path, 'utf8')) as BenchJson;
const assert = process.env['TSBS_PERF'] === '1';
const specs = allBenches();
const rows = report.files.flatMap((f) => f.groups.flatMap((g) => g.benchmarks));
if (rows.length === 0) {
  console.error('check-bench: the report has no benchmarks (data/vocab/dist missing? run `pnpm vocab:build`)');
  process.exit(1);
}

const ms = (value: number): string => value.toFixed(2).padStart(7);
console.log(
  `vitest bench medians — node ${process.version}, ${cpus()[0]?.model.trim() ?? 'unknown CPU'}; ` +
    `ceilings 06 §3 (Node; phone = ×${String(PHONE_MARGIN)})${assert ? '' : ' — report only, set TSBS_PERF=1 to assert'}`,
);
let over = 0;
for (const row of rows) {
  const ceiling = ceilingOf(row.name, specs);
  const verdict = ceiling === null ? 'recorded' : row.median <= ceiling ? 'ok' : 'OVER';
  if (verdict === 'OVER') over++;
  const limit =
    ceiling === null
      ? ''.padEnd(26)
      : `≤ ${String(ceiling).padStart(2)} ms (phone ${String(ceiling * PHONE_MARGIN)} ms)`.padEnd(26);
  console.log(
    `  ${row.name.padEnd(52)} median ${ms(row.median)} ms  p99 ${ms(row.p99)} ms  n=${String(row.sampleCount).padStart(4)}  ${limit} ${verdict}`,
  );
}
const missing = specs.filter((s) => !rows.some((r) => r.name === s.name)).map((s) => s.name);
if (missing.length > 0) console.log(`  not run: ${missing.join(', ')}`);
if (over > 0) {
  console.log(`${String(over)} median(s) over the 06 §3 ceiling${assert ? '' : ' (not asserted without TSBS_PERF=1)'}`);
  if (assert) process.exitCode = 1;
}
