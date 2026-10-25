/**
 * Vite configuration for @tsbs/web (docs/design/02-architecture.md §5). Multi-page app: `/` and `/about/` (+ `404.html`).
 */
import { fileURLToPath } from 'node:url';
import { svelte } from '@sveltejs/vite-plugin-svelte';
import { defineConfig, type Rollup } from 'vite';
import { bootScript } from './plugins/boot-script.ts'; // esbuild src/app/boot.ts → IIFE assets/boot-[hash].js, injected first in <head>
import { examples } from './plugins/examples.ts'; // fixtures → precomputed example results (WP03)
import { gridClasses } from './plugins/grid-classes.ts'; // writes src/board/grid-classes.css (.c1..c64 / .s1..s64)
import { headersMiddleware } from './plugins/headers.ts'; // dev/preview only: replays public/_headers (dev omits the CSP, PA-2b)
import { lazyChunks } from './plugins/lazy-chunks.ts'; // chunks / does not load at startup → assets/lazy-*.js (06 §3 Main JS)
import { licences } from './plugins/licences.ts'; // manifest + docs/licenses → generated/licences.json; copies texts (WP03)
import { vocabAssets } from './plugins/vocab-assets.ts'; // copies data/vocab/dist/tok → dist/tok (manifest emit: WP03)

const page = (path: string): string => fileURLToPath(new URL(path, import.meta.url));

/**
 * File names of the Worker's lazy chunks (PA-8), the names size-limit.json budgets: the engine re-export modules of
 * `@tsbs/worker` (`src/engines/bytelevel.ts`, `src/engines/spm.ts`) become `assets/bytelevel-[hash].js` and
 * `assets/spm-[hash].js`; the core code both engines share (agenda loop, result builder, text analysis, …) is split out
 * by Rollup and named `assets/engine-core-[hash].js`, budgeted with each engine (it loads with the first one).
 */
function workerChunkFileName(chunk: Rollup.PreRenderedChunk): string {
  const id = (chunk.facadeModuleId ?? '').replaceAll('\\', '/');
  const engine = /\/packages\/worker\/src\/engines\/(bytelevel|spm)\.ts$/.exec(id)?.[1];
  return engine === undefined ? 'assets/engine-core-[hash].js' : `assets/${engine}-[hash].js`;
}

export default defineConfig({
  plugins: [
    svelte(),
    vocabAssets(),
    examples(),
    licences(),
    gridClasses(),
    bootScript(),
    headersMiddleware(),
    lazyChunks(page('./index.html')),
  ],
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
  // `import TokWorker from '@tsbs/worker/entry?worker'`, never a bare specifier inside new URL(). Its host chunk is
  // assets/entry-[hash].js (from entry.ts), the lazy engines bytelevel-/spm-[hash].js (PA-8, size-limit.json).
  worker: {
    format: 'es',
    rollupOptions: {
      output: {
        entryFileNames: 'assets/[name]-[hash].js',
        chunkFileNames: workerChunkFileName,
      },
    },
  },
  css: { transformer: 'lightningcss' },
  // PD-5 (no inline regex modifiers such as (?i:) — Safari < 26): 02 §5 sets esbuild `supported['regexp-modifiers'] = false`,
  // but esbuild 0.27/0.28 (Vite 7) has no such feature key and rejects it, and esbuild never introduces modifiers itself.
  // The guard is therefore the ESLint rule on regex literals (eslint.config.js) plus WP02's pattern-expansion tests.
  define: {
    __BUILD_SHA__: JSON.stringify(process.env['GITHUB_SHA'] ?? 'dev'),
    __BUILD_DATE__: JSON.stringify(new Date().toISOString().slice(0, 10)),
  },
});
