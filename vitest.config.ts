/**
 * Workspace test runner (`pnpm test` = `vitest run`, 02 §6). One Vitest project per package; each package keeps its tests
 * in `test/` (own tsconfig with Node types, so `src/` stays DOM-/Node-free where 02 §4 requires it). The web app has its
 * own config (Svelte plugin). Playwright specs under e2e/specs are not Vitest tests; e2e/test checks their config only.
 */
import { defineConfig } from 'vitest/config';

const PACKAGES = ['core', 'worker', 'registry', 'vocab-tools', 'conformance', 'ui-tokens'] as const;

export default defineConfig({
  test: {
    projects: [
      ...PACKAGES.map((name) => ({
        test: { name, root: `packages/${name}`, include: ['test/**/*.test.ts'], environment: 'node' as const },
      })),
      'apps/web/vitest.config.ts',
      { test: { name: 'e2e', root: 'e2e', include: ['test/**/*.test.ts'], environment: 'node' as const } },
    ],
  },
});
