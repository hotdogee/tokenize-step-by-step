/**
 * Perf spec (06 §1 "Performance", §3; WP12): `perf.spec.ts` against `vite preview` of the built `apps/web/dist`, chromium
 * only (CDP network emulation, Chromium traces), one worker and no retries so the timings never share the CPU with
 * another test. Budget misses are soft (recorded, annotated, `::warning::` in CI) unless `PERF_STRICT=1`; every run writes
 * `test-results/perf/perf-results.json` (the nightly artifact is the trend).
 *
 *   pnpm build && pnpm e2e:perf                     # E2E_PERF_PORT moves the preview off 4174
 *   PERF_STRICT=1 pnpm e2e:perf                     # fail on a budget miss
 */
import process from 'node:process';
import { defineConfig, devices } from '@playwright/test';
import { DESKTOP_VIEWPORT } from '../projects.ts';

const CI = process.env['CI'] !== undefined && process.env['CI'] !== '';
const PORT = Number(process.env['E2E_PERF_PORT'] ?? 4174);
const BASE_URL = `http://localhost:${String(PORT)}`;

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
  use: { baseURL: BASE_URL, trace: 'off' },
  webServer: {
    command: `pnpm --filter @tsbs/web preview --port ${String(PORT)} --strictPort`,
    url: BASE_URL,
    reuseExistingServer: false,
    timeout: 60_000,
  },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'], viewport: DESKTOP_VIEWPORT } }],
});
