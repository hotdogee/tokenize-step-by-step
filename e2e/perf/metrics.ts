/**
 * Node-side helpers of the perf spec: percentiles, pairing of probe timestamps into latencies, Chromium trace parsing
 * (main-thread task durations), and the soft budgets with the results file (`test-results/perf/perf-results.json`).
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import process from 'node:process';

/** The `p`-th percentile (0–100, nearest rank) of `values`; NaN for an empty list. */
export function percentile(values: readonly number[], p: number): number {
  if (values.length === 0) return Number.NaN;
  const sorted = [...values].sort((a, b) => a - b);
  const rank = Math.min(sorted.length - 1, Math.max(0, Math.ceil((p / 100) * sorted.length) - 1));
  return sorted[rank] ?? Number.NaN;
}

/** For every start time, the first time in `ends` at or after it (null when none) — e.g. keystroke → next frame. */
export function nextAfter(starts: readonly number[], ends: readonly number[]): Array<number | null> {
  return starts.map((start) => ends.find((end) => end >= start) ?? null);
}

/** `end − start` for each start that has an end. */
export function latencies(starts: readonly number[], ends: readonly number[]): number[] {
  return nextAfter(starts, ends).flatMap((end, i) => (end === null ? [] : [end - (starts[i] ?? end)]));
}

interface TraceEvent {
  readonly name: string;
  readonly ph: string;
  readonly pid: number;
  readonly tid: number;
  readonly ts?: number;
  readonly dur?: number;
  readonly args?: { readonly name?: string };
}

/** Durations (ms) of the top-level tasks on the busiest renderer main thread (`CrRendererMain`) of a Chromium trace. */
export function mainThreadTasks(trace: Buffer | string): number[] {
  const parsed = JSON.parse(trace.toString()) as { traceEvents?: TraceEvent[] } | TraceEvent[];
  const events = Array.isArray(parsed) ? parsed : (parsed.traceEvents ?? []);
  const mains = new Set(
    events
      .filter((e) => e.ph === 'M' && e.name === 'thread_name' && e.args?.name === 'CrRendererMain')
      .map((e) => `${String(e.pid)}:${String(e.tid)}`),
  );
  const byThread = new Map<string, number[]>();
  for (const e of events) {
    if (e.ph !== 'X' || (e.name !== 'RunTask' && e.name !== 'ThreadControllerImpl::RunTask')) continue;
    const key = `${String(e.pid)}:${String(e.tid)}`;
    if (!mains.has(key)) continue;
    const list = byThread.get(key) ?? [];
    list.push((e.dur ?? 0) / 1000);
    byThread.set(key, list);
  }
  let busiest: number[] = [];
  for (const list of byThread.values())
    if (list.reduce((s, d) => s + d, 0) > busiest.reduce((s, d) => s + d, 0)) busiest = list;
  return busiest;
}

/** One recorded measurement. */
export interface PerfResult {
  readonly metric: string;
  readonly value: number;
  readonly unit: 'ms' | 'count';
  /** The 06 §3 budget, or null when the value is recorded only. */
  readonly budget: number | null;
  readonly ok: boolean | null;
  readonly note?: string;
}

const results: PerfResult[] = [];

/** True when budget misses fail the run (`PERF_STRICT=1`); otherwise they are reported (soft-fail with a trend, 06 §1). */
export const STRICT = process.env['PERF_STRICT'] === '1';

/**
 * Records `value` against `budget`. A miss is printed (a GitHub `::warning::` in CI) and returned as `false`; the spec
 * fails on it only when `PERF_STRICT=1`.
 */
export function record(
  metric: string,
  value: number,
  unit: PerfResult['unit'],
  budget: number | null,
  note?: string,
): boolean {
  const ok = budget === null ? null : value <= budget;
  results.push({
    metric,
    value: Math.round(value * 100) / 100,
    unit,
    budget,
    ok,
    ...(note === undefined ? {} : { note }),
  });
  const shown = `${metric}: ${value.toFixed(unit === 'ms' ? 1 : 0)}${unit === 'ms' ? ' ms' : ''}`;
  if (ok === false) {
    const message = `perf budget missed — ${shown} > ${String(budget)}${unit === 'ms' ? ' ms' : ''} (06 §3)`;
    console.log(process.env['CI'] === undefined ? `WARNING ${message}` : `::warning title=perf budget::${message}`);
  } else
    console.log(
      `[perf] ${shown}${budget === null ? '' : ` (≤ ${String(budget)})`}${note === undefined ? '' : ` — ${note}`}`,
    );
  return ok !== false;
}

/** Writes every recorded result (with the run's context) to `path`. */
export function writeResults(path: string, context: Record<string, unknown>): void {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, `${JSON.stringify({ ...context, results }, null, 1)}\n`, 'utf8');
}
