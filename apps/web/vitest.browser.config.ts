/**
 * Component tests in Vitest browser mode (06 §1 "Component"): `src/**` `*.browser.test.ts` run in chromium through the
 * Playwright provider, with the same Svelte plugin as the app and the generated grid placement classes. Run by
 * `pnpm test:browser` (chained into `pnpm test`). They need Playwright's chromium for the pinned `playwright`
 * (`pnpm exec playwright install chromium`); without it the project collects no files and says so, rather than failing
 * every unit run on a machine without browsers.
 */
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { svelte } from '@sveltejs/vite-plugin-svelte';
import { playwright } from '@vitest/browser-playwright';
import { chromium } from 'playwright';
import { defineConfig } from 'vitest/config';
import { gridClasses } from './plugins/grid-classes.ts';

/** True when Playwright's chromium for the pinned version is installed. */
function chromiumInstalled(): boolean {
  try {
    return existsSync(chromium.executablePath());
  } catch {
    return false;
  }
}

const enabled = chromiumInstalled();
if (!enabled) {
  console.warn(
    '[web-browser] Playwright chromium is not installed: component tests are skipped (pnpm exec playwright install chromium).',
  );
}

export default defineConfig({
  // `pnpm test:browser` runs from the repository root; the app directory is the Vite root (svelte.config.js, src/).
  root: fileURLToPath(new URL('.', import.meta.url)),
  plugins: [svelte(), gridClasses()],
  test: {
    name: 'web-browser',
    include: enabled ? ['src/**/*.browser.test.ts'] : [],
    passWithNoTests: !enabled,
    browser: {
      enabled,
      headless: true,
      provider: playwright(),
      instances: [{ browser: 'chromium' }],
      viewport: { width: 1440, height: 900 },
      screenshotFailures: false,
    },
  },
});
