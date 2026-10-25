/**
 * Vitest project for @tsbs/web: Svelte component smoke tests (server-rendered in Node), Vite plugin unit tests and the pure
 * board/inspector models. Kept separate from vite.config.ts so tests do not run the build-only plugins. Component tests in
 * a real browser (`*.browser.test.ts`) run in their own project, vitest.browser.config.ts (`pnpm test:browser`), because
 * Vitest does not nest projects inside a referenced project config.
 */
import { svelte } from '@sveltejs/vite-plugin-svelte';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  plugins: [svelte()],
  test: {
    name: 'web',
    environment: 'node',
    include: ['src/**/*.test.ts', 'plugins/**/*.test.ts'],
    exclude: ['src/**/*.browser.test.ts'],
  },
});
