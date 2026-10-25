/**
 * Header-dependent E2E (06 §1 "E2E (headers)", §4 `e2e-headers`): the specs in `headers/` against workerd —
 * `wrangler dev --assets apps/web/dist`, which applies `_headers`, `html_handling` and `not_found_handling` the way the edge
 * does — or, with `E2E_BASE_URL`, against a deployed URL (the CI `preview` job points it at the `wrangler preview` URL).
 * Never against `vite preview`, whose headers are only a replay (AD-15).
 *
 *   pnpm e2e:headers                                   # local wrangler dev on 127.0.0.1:$E2E_HEADERS_PORT (8791)
 *   E2E_BASE_URL=https://pr-12-….workers.dev pnpm e2e:headers
 */
import process from 'node:process';
import { fileURLToPath } from 'node:url';
import { defineConfig, devices } from '@playwright/test';

const CI = process.env['CI'] !== undefined && process.env['CI'] !== '';
const EXTERNAL = process.env['E2E_BASE_URL'] === '' ? undefined : process.env['E2E_BASE_URL'];
const PORT = Number(process.env['E2E_HEADERS_PORT'] ?? 8791);
const LOCAL_URL = `http://127.0.0.1:${String(PORT)}`;
const REPO_ROOT = fileURLToPath(new URL('..', import.meta.url));

export default defineConfig({
  testDir: './headers',
  testMatch: '**/*.spec.ts',
  outputDir: './test-results/headers',
  fullyParallel: true,
  forbidOnly: CI,
  retries: CI ? 1 : 0,
  reporter: CI ? [['github'], ['html', { open: 'never', outputFolder: 'playwright-report/headers' }]] : 'list',
  use: {
    baseURL: EXTERNAL ?? LOCAL_URL,
    trace: 'retain-on-failure',
  },
  ...(EXTERNAL === undefined
    ? {
        webServer: {
          command: `pnpm exec wrangler dev --assets apps/web/dist --ip 127.0.0.1 --port ${String(PORT)} --show-interactive-dev-session=false`,
          cwd: REPO_ROOT,
          url: LOCAL_URL,
          reuseExistingServer: false,
          timeout: 120_000,
          env: { WRANGLER_SEND_METRICS: 'false' },
        },
      }
    : {}),
  projects: [{ name: 'headers-chromium', use: { ...devices['Desktop Chrome'] } }],
});
