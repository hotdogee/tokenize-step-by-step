/**
 * Workspace test runner (`pnpm test` = `vitest run`, 02 §6). One Vitest project per package; each package keeps its tests
 * in `test/` (own tsconfig with Node types, so `src/` stays DOM-/Node-free where 02 §4 requires it). The web app has its
 * own config (Svelte plugin). Playwright specs under e2e/specs and e2e/headers are not Vitest tests; e2e/test checks the
 * Playwright configuration and helpers, scripts/test the root tooling.
 */
import { configDefaults, defineConfig } from 'vitest/config';

const PACKAGES = ['core', 'worker', 'registry', 'vocab-tools', 'conformance', 'ui-tokens'] as const;

export default defineConfig({
  test: {
    projects: [
      ...PACKAGES.map((name) => ({
        test: {
          name,
          root: `packages/${name}`,
          include: ['test/**/*.test.ts'],
          // test/browser/** runs in Vitest browser mode (the worker-browser project below), never in Node.
          exclude: [...configDefaults.exclude, 'test/browser/**'],
          environment: 'node' as const,
        },
      })),
      // WP07: real-Worker tests in chromium (Vitest browser mode, Playwright provider); skip without chromium.
      'packages/worker/test/vitest.browser.config.ts',
      'apps/web/vitest.config.ts',
      { test: { name: 'e2e', root: 'e2e', include: ['test/**/*.test.ts'], environment: 'node' as const } },
      // Root tooling: dist guards, deploy smoke, CI gates and the workflow/budget consistency checks (WP11).
      { test: { name: 'scripts', root: 'scripts', include: ['test/**/*.test.ts'], environment: 'node' as const } },
    ],
  },
});
