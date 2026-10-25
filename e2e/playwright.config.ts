/**
 * Playwright configuration — SKELETON from WP00. WP11 owns the suites and the full matrix of 06 §1/§4 (chromium, firefox,
 * webkit, Pixel 5, iPhone 12, 320/360/2560 viewports, axe, visual, the `headers` project on `wrangler dev`); PA-5 lets
 * its first version run chromium only. `pnpm test` never runs this file and needs no browsers.
 */
import { defineConfig, devices } from '@playwright/test';

const PREVIEW_PORT = 4173;

export default defineConfig({
  testDir: './specs',
  testMatch: '**/*.spec.ts',
  fullyParallel: true,
  forbidOnly: process.env['CI'] !== undefined,
  retries: process.env['CI'] !== undefined ? 1 : 0,
  reporter: process.env['CI'] !== undefined ? [['github'], ['html', { open: 'never' }]] : 'list',
  use: {
    baseURL: `http://localhost:${String(PREVIEW_PORT)}`,
    trace: 'retain-on-failure',
  },
  // Functional suites run against `vite preview` (+ headersMiddleware) of the built dist (02 §6).
  webServer: {
    command: `pnpm --filter @tsbs/web preview --port ${String(PREVIEW_PORT)} --strictPort`,
    url: `http://localhost:${String(PREVIEW_PORT)}`,
    reuseExistingServer: process.env['CI'] === undefined,
  },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
});
