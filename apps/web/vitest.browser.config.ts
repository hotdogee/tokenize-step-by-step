/**
 * Component tests in Vitest browser mode (06 §1 "Component"): `src/**` `*.browser.test.ts` run in chromium through the
 * Playwright provider, with the same Svelte plugin as the app and the generated grid placement classes. Run by
 * `pnpm test:browser` (chained into `pnpm test`). They need Playwright's chromium for the pinned `playwright`
 * (`pnpm --filter @tsbs/e2e exec playwright install chromium`, the same version). On a developer machine without it the
 * project collects no files and says so, rather than failing every unit run; under CI (`CI` set) a missing chromium is
 * an error, so the component tests can never pass by running nothing. The error is raised only when Vitest itself loads
 * the config (`VITEST` set): tools that merely import it to read the project (knip's vitest plugin in the `check` job,
 * which has no browsers) get the skipped project instead.
 */
import { existsSync } from 'node:fs';
import process from 'node:process';
import { fileURLToPath } from 'node:url';
import { svelte } from '@sveltejs/vite-plugin-svelte';
import { playwright } from '@vitest/browser-playwright';
import { chromium } from 'playwright';
import type { BrowserCommand } from 'vitest/node';
import { defineConfig } from 'vitest/config';
import { compileBoot } from './plugins/boot-script.ts';
import { gridClasses } from './plugins/grid-classes.ts';

/** True when Playwright's chromium for the pinned version is installed. */
function chromiumInstalled(): boolean {
  try {
    return existsSync(chromium.executablePath());
  } catch {
    return false;
  }
}

const CI = process.env['CI'] !== undefined && process.env['CI'] !== '';
const RUNNING_VITEST = process.env['VITEST'] === 'true';
const INSTALL = 'pnpm --filter @tsbs/e2e exec playwright install --with-deps chromium';
const enabled = chromiumInstalled();
if (!enabled) {
  if (CI && RUNNING_VITEST)
    throw new Error(
      `[web-browser] Playwright chromium is not installed, and CI never skips the component tests (${INSTALL}).`,
    );
  console.warn(`[web-browser] Playwright chromium is not installed: component tests are skipped (${INSTALL}).`);
}

/**
 * `renderFirstPaint(locale)`: the static first paint's markup (src/app/prerender.ts), server-rendered by this project's
 * Vite server with the same Svelte plugin, so `first-paint.browser.test.ts` can hydrate it in chromium.
 */
const renderFirstPaint: BrowserCommand<[locale: string], string> = async (context, locale) => {
  const server = context.project.browser?.vite;
  if (server === undefined) throw new Error('renderFirstPaint: no browser Vite server');
  const prerender = (await server.ssrLoadModule('/src/app/prerender.ts')) as {
    renderFirstPaint(locale: string): string;
  };
  return prerender.renderFirstPaint(locale);
};

/** `emulateContrast(contrast)`: `prefers-contrast` for the test page and its frames (null: the browser's own again). */
const emulateContrast: BrowserCommand<[contrast: 'more' | null], void> = async (context, contrast) => {
  await context.page.emulateMedia({ contrast });
};

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
      commands: {
        renderFirstPaint,
        emulateContrast,
        // The clone script as the build emits it (first-paint-script.browser.test.ts runs it against a test DOM).
        compileFirstPaintScript: () =>
          compileBoot(fileURLToPath(new URL('src/app/first-paint-script.ts', import.meta.url))),
      },
    },
  },
});
