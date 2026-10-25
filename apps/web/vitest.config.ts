/**
 * Vitest project for @tsbs/web: Svelte component smoke tests (server-rendered in Node) and Vite plugin unit tests.
 * Kept separate from vite.config.ts so tests do not run the build-only plugins.
 */
import { svelte } from '@sveltejs/vite-plugin-svelte';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  plugins: [svelte()],
  test: {
    name: 'web',
    environment: 'node',
    include: ['src/**/*.test.ts', 'plugins/**/*.test.ts'],
  },
});
