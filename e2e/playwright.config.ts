/**
 * Functional E2E (06 §1, §4): the specs in `specs/` (and the `visual` project's `visual/`) against `vite preview` of the
 * built `apps/web/dist`, which replays `public/_headers` (CSP included) through `headersMiddleware()` (02 §5, PA-2b).
 * Header-dependent checks live in `headers/` and run against workerd (`playwright.headers.config.ts`), never against
 * `vite preview`.
 *
 *   pnpm e2e                                          # chromium
 *   E2E_FULL_MATRIX=1 pnpm e2e                        # + firefox, webkit, Pixel 5, iPhone 12, 320/360/2560, visual
 *   E2E_FULL_MATRIX=1 E2E_ENGINE=webkit pnpm e2e --shard=1/3   # one CI job: the webkit projects, first third
 *
 * `E2E_PORT` moves the preview server off 4173. An already-running server is never reused: with several checkouts on one
 * machine it could be another worktree's build. `pnpm test` never runs this file and needs no browsers.
 */
import process from 'node:process';
import { defineConfig } from '@playwright/test';
import { engineRequested, fullMatrixRequested, functionalProjects } from './projects.ts';

const CI = process.env['CI'] !== undefined && process.env['CI'] !== '';
const PORT = Number(process.env['E2E_PORT'] ?? 4173);
const BASE_URL = `http://localhost:${String(PORT)}`;

export default defineConfig({
  testDir: './specs',
  testMatch: '**/*.spec.ts',
  outputDir: './test-results/functional',
  fullyParallel: true,
  forbidOnly: CI,
  // No retries by default, so a flaky spec fails where it flakes; the WebKit projects get one in CI (projects.ts).
  retries: 0,
  reporter: CI ? [['github'], ['html', { open: 'never', outputFolder: 'playwright-report/functional' }]] : 'list',
  use: {
    baseURL: BASE_URL,
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
  },
  webServer: {
    command: `pnpm --filter @tsbs/web preview --port ${String(PORT)} --strictPort`,
    url: BASE_URL,
    reuseExistingServer: false,
    timeout: 60_000,
  },
  projects: functionalProjects({
    full: fullMatrixRequested(process.env),
    engine: engineRequested(process.env),
    ci: CI,
  }),
});
