/**
 * Vite configuration for @tsbs/web (docs/design/02-architecture.md §5). Multi-page app: `/` and `/about/` (+ `404.html`).
 */
import { fileURLToPath } from 'node:url';
import { svelte } from '@sveltejs/vite-plugin-svelte';
import { defineConfig } from 'vite';
import { bootScript } from './plugins/boot-script.ts'; // esbuild src/app/boot.ts → IIFE assets/boot-[hash].js, injected first in <head>
import { examples } from './plugins/examples.ts'; // fixtures → precomputed example results (WP03)
import { gridClasses } from './plugins/grid-classes.ts'; // writes src/board/grid-classes.css (.c1..c64 / .s1..s64)
import { headersMiddleware } from './plugins/headers.ts'; // dev/preview only: replays public/_headers (dev omits the CSP, PA-2b)
import { licences } from './plugins/licences.ts'; // manifest + docs/licenses → generated/licences.json; copies texts (WP03)
import { vocabAssets } from './plugins/vocab-assets.ts'; // copies data/vocab/dist/tok → dist/tok (manifest emit: WP03)

const page = (path: string): string => fileURLToPath(new URL(path, import.meta.url));

export default defineConfig({
  plugins: [svelte(), vocabAssets(), examples(), licences(), gridClasses(), bootScript(), headersMiddleware()],
  appType: 'mpa',
  build: {
    target: ['es2022', 'safari16.4', 'chrome109', 'firefox115'],
    modulePreload: { polyfill: false },
    cssMinify: 'lightningcss',
    assetsInlineLimit: 0,
    sourcemap: 'hidden', // *.map excluded from deploy via public/.assetsignore
    rollupOptions: {
      // boot.ts is NOT an input (it would become a deferred ES module); bootScript() emits it. 404.html is an input so it
      // gets the boot script and the hashed stylesheet too.
      input: { main: page('./index.html'), about: page('./about/index.html'), notFound: page('./404.html') },
      // All three catalogs ship together in one `i18n` chunk shared by every page (AD-29; 06 §3 budgets it at ≤ 8 KB br).
      output: { manualChunks: { i18n: ['./src/i18n/en.ts', './src/i18n/zh-TW.ts', './src/i18n/ja.ts'] } },
    },
    reportCompressedSize: true,
  },
  // REQUIRED for the lazy engine import()s inside the Worker (02 §5); the Worker is constructed with
  // `import TokWorker from '@tsbs/worker/entry?worker'`, never a bare specifier inside new URL().
  worker: { format: 'es' },
  css: { transformer: 'lightningcss' },
  // PD-5 (no inline regex modifiers such as (?i:) — Safari < 26): 02 §5 sets esbuild `supported['regexp-modifiers'] = false`,
  // but esbuild 0.27/0.28 (Vite 7) has no such feature key and rejects it, and esbuild never introduces modifiers itself.
  // The guard is therefore the ESLint rule on regex literals (eslint.config.js) plus WP02's pattern-expansion tests.
  define: {
    __BUILD_SHA__: JSON.stringify(process.env['GITHUB_SHA'] ?? 'dev'),
    __BUILD_DATE__: JSON.stringify(new Date().toISOString().slice(0, 10)),
  },
});
