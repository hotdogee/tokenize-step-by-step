/**
 * The perf spec's Node-side helpers and configuration (WP12, `e2e/perf`): percentiles, pairing of probe timestamps,
 * Chromium trace parsing, and the perf config (chromium only, one worker, no retries, its own preview port or
 * `E2E_PERF_BASE_URL`).
 */
import process from 'node:process';
import { describe, expect, it } from 'vitest';
import { latencies, mainThreadTasks, nextAfter, percentile } from '../perf/metrics.ts';
import perfConfig, { perfTarget } from '../perf/playwright.config.ts';

describe('perf metrics', () => {
  it('percentile uses the nearest rank', () => {
    const values = Array.from({ length: 100 }, (_, i) => i + 1);
    expect(percentile(values, 95)).toBe(95);
    expect(percentile(values, 50)).toBe(50);
    expect(percentile([3, 1, 2], 100)).toBe(3);
    expect(percentile([], 50)).toBeNaN();
  });

  it('pairs every start with the first end at or after it', () => {
    expect(nextAfter([10, 20, 35], [15, 31, 40])).toEqual([15, 31, 40]);
    expect(nextAfter([50], [15])).toEqual([null]);
    expect(latencies([10, 20], [15, 31])).toEqual([5, 11]);
  });

  it('reads the busiest renderer main thread of a trace', () => {
    const trace = JSON.stringify({
      traceEvents: [
        { name: 'thread_name', ph: 'M', pid: 1, tid: 7, args: { name: 'CrRendererMain' } },
        { name: 'thread_name', ph: 'M', pid: 2, tid: 9, args: { name: 'CrRendererMain' } },
        { name: 'thread_name', ph: 'M', pid: 1, tid: 8, args: { name: 'Compositor' } },
        { name: 'RunTask', ph: 'X', pid: 1, tid: 7, ts: 0, dur: 60_000 },
        { name: 'ThreadControllerImpl::RunTask', ph: 'X', pid: 1, tid: 7, ts: 0, dur: 4_000 },
        { name: 'RunTask', ph: 'X', pid: 1, tid: 8, ts: 0, dur: 900_000 },
        { name: 'RunTask', ph: 'X', pid: 2, tid: 9, ts: 0, dur: 1_000 },
      ],
    });
    expect(mainThreadTasks(trace)).toEqual([60, 4]);
  });
});

describe('perf config (e2e/perf/playwright.config.ts)', () => {
  it('runs chromium alone, serially, against its own vite preview', () => {
    expect(perfConfig.projects?.map((project) => project.name)).toEqual(['chromium']);
    expect(perfConfig.workers).toBe(1);
    expect(perfConfig.retries).toBe(0);
    expect(perfConfig.fullyParallel).toBe(false);
    expect(perfConfig.use?.baseURL).toBe(perfTarget(process.env).baseURL);
  });

  it('starts its own vite preview unless E2E_PERF_BASE_URL names a deployed URL', () => {
    const local = perfTarget({});
    expect(local.baseURL).toBe('http://localhost:4174');
    const webServer = Array.isArray(local.webServer) ? local.webServer[0] : local.webServer;
    expect(webServer?.command).toContain('@tsbs/web preview');
    expect(webServer?.url).toBe('http://localhost:4174');
    expect(webServer?.reuseExistingServer).toBe(false);
    expect(perfTarget({ E2E_PERF_PORT: '4180', E2E_PERF_BASE_URL: '' }).baseURL).toBe('http://localhost:4180');
    expect(perfTarget({ E2E_PERF_BASE_URL: 'https://pr-1.example.workers.dev' })).toEqual({
      baseURL: 'https://pr-1.example.workers.dev',
    });
  });
});
