/**
 * Functional E2E (06 §1, §4): the specs in `specs/` against `vite preview` of the built `apps/web/dist`, which replays
 * `public/_headers` (CSP included) through `headersMiddleware()` (02 §5, PA-2b). Header-dependent checks live in
 * `headers/` and run against workerd (`playwright.headers.config.ts`), never against `vite preview`.
 *
 *   pnpm e2e                     # chromium (PA-5)
 *   E2E_FULL_MATRIX=1 pnpm e2e   # + firefox, webkit, Pixel 5, iPhone 12, 320/360/2560 (WP11 wave 3)
 *
 * `E2E_PORT` moves the preview server off 4173. An already-running server is never reused: with several checkouts on one
 * machine it could be another worktree's build. `pnpm test` never runs this file and needs no browsers.
 */
import process from 'node:process';
import { defineConfig } from '@playwright/test';
import { fullMatrixRequested, functionalProjects } from './projects.ts';

const CI = process.env['CI'] !== undefined && process.env['CI'] !== '';
const PORT = Number(process.env['E2E_PORT'] ?? 4173);
const BASE_URL = `http://localhost:${String(PORT)}`;

export default defineConfig({
  testDir: './specs',
  testMatch: '**/*.spec.ts',
  outputDir: './test-results/functional',
  fullyParallel: true,
  forbidOnly: CI,
  retries: CI ? 1 : 0,
  reporter: CI ? [['github'], ['html', { open: 'never', outputFolder: 'playwright-report/functional' }]] : 'list',
  use: {
    baseURL: BASE_URL,
    trace: 'retain-on-failure',
  },
  webServer: {
    command: `pnpm --filter @tsbs/web preview --port ${String(PORT)} --strictPort`,
    url: BASE_URL,
    reuseExistingServer: false,
    timeout: 60_000,
  },
  projects: functionalProjects(fullMatrixRequested(process.env)),
});
