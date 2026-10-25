/**
 * The perf spec's Node-side helpers and configuration (WP12, `e2e/perf`): percentiles, pairing of probe timestamps,
 * Chromium trace parsing, and the perf config (chromium only, one worker, no retries, its own preview port).
 */
import { describe, expect, it } from 'vitest';
import { latencies, mainThreadTasks, nextAfter, percentile } from '../perf/metrics.ts';
import perfConfig from '../perf/playwright.config.ts';

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
    expect(perfConfig.use?.baseURL).toBe('http://localhost:4174');
    const webServer = Array.isArray(perfConfig.webServer) ? perfConfig.webServer[0] : perfConfig.webServer;
    expect(webServer?.command).toContain('@tsbs/web preview');
    expect(webServer?.reuseExistingServer).toBe(false);
  });
});
