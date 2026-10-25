/**
 * Opt-in wall-clock budgets (06 §3). The every-PR unit suite shares CI runners with other jobs, so a hard timing
 * assertion there would flake; the budgets are enforced through `vitest bench` with a ×4 margin (WP12). Set
 * `TSBS_PERF=1` (like `TSBS_NATIVE_UNICODE=1`) to time the hot paths and assert the Node budgets on a quiet machine.
 */
import process from 'node:process';

/** `true` when `TSBS_PERF=1`: the timing tests run and assert their budgets; otherwise they are skipped. */
export const PERF_BUDGETS = process.env['TSBS_PERF'] === '1';

/** Median of `runs` timed calls of `fn` after one warm-up call (vitest-bench style), plus that cold first call. */
export function time(fn: () => unknown, runs = 9): { cold: number; median: number } {
  let t0 = performance.now();
  fn();
  const cold = performance.now() - t0;
  const samples: number[] = [];
  for (let i = 0; i < runs; i++) {
    t0 = performance.now();
    fn();
    samples.push(performance.now() - t0);
  }
  samples.sort((a, b) => a - b);
  return { cold, median: samples[runs >> 1] ?? Number.NaN };
}
