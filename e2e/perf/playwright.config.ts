/**
 * Perf spec (06 §1 "Performance", §3; WP12): `perf.spec.ts` against `vite preview` of the built `apps/web/dist`, chromium
 * only (CDP network emulation, Chromium traces), one worker and no retries so the timings never share the CPU with
 * another test. Budget misses are soft (recorded, annotated, `::warning::` in CI) unless `PERF_STRICT=1`; every run writes
 * `test-results/perf/perf-results.json` (the nightly artifact is the trend). With `E2E_PERF_BASE_URL` the spec runs against
 * that URL (a deployed preview or production, 06 §3) and starts no local server.
 *
 *   pnpm build && pnpm e2e:perf                     # E2E_PERF_PORT moves the preview off 4174
 *   PERF_STRICT=1 pnpm e2e:perf                     # fail on a budget miss
 *   E2E_PERF_BASE_URL=https://….workers.dev pnpm e2e:perf
 */
import process from 'node:process';
import { defineConfig, devices, type PlaywrightTestConfig } from '@playwright/test';
import { DESKTOP_VIEWPORT } from '../projects.ts';

const CI = process.env['CI'] !== undefined && process.env['CI'] !== '';

/** Where the spec runs: `E2E_PERF_BASE_URL` when set (no local server), else its own `vite preview` of `apps/web/dist`. */
export function perfTarget(env: Readonly<Record<string, string | undefined>>): {
  readonly baseURL: string;
  readonly webServer?: PlaywrightTestConfig['webServer'];
} {
  const external = env['E2E_PERF_BASE_URL'];
  if (external !== undefined && external !== '') return { baseURL: external };
  const port = Number(env['E2E_PERF_PORT'] ?? 4174);
  // 127.0.0.1, as in ../playwright.config.ts: vite preview listens on one address family and a browser that tries the
  // other one gets ERR_CONNECTION_REFUSED.
  const baseURL = `http://127.0.0.1:${String(port)}`;
  return {
    baseURL,
    webServer: {
      command: `pnpm --filter @tsbs/web preview --host 127.0.0.1 --port ${String(port)} --strictPort`,
      url: baseURL,
      reuseExistingServer: false,
      timeout: 60_000,
    },
  };
}

const TARGET = perfTarget(process.env);

export default defineConfig({
  testDir: '.',
  testMatch: '**/*.spec.ts',
  outputDir: '../test-results/perf',
  fullyParallel: false,
  workers: 1,
  retries: 0,
  forbidOnly: CI,
  timeout: 180_000,
  reporter: CI ? [['github'], ['list']] : 'list',
  use: { baseURL: TARGET.baseURL, trace: 'off' },
  ...(TARGET.webServer === undefined ? {} : { webServer: TARGET.webServer }),
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'], viewport: DESKTOP_VIEWPORT } }],
});
