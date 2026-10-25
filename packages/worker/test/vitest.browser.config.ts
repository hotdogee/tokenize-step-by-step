/**
 * Vitest project `worker-browser` (07 WP07): the real-Worker tests in chromium through Vitest browser mode (Playwright
 * provider). Vite serves `data/vocab/dist` as the public directory, so `/tok/<id>/<sha12>.bin` resolves on the test
 * origin exactly as on the site; the browser command `vocabManifest` returns the built manifest (or null when nothing
 * was built); `/tok-corrupt/<path>` serves `/tok/<path>` with one byte flipped for the integrity test.
 *
 * Without a Playwright chromium build (`pnpm exec playwright install chromium`) the project runs in Node and every
 * test skips with that message, so `pnpm test` stays usable on a machine (or CI job) without browsers.
 */
import { existsSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { join, normalize } from 'node:path';
import { fileURLToPath } from 'node:url';
import { defineBrowserCommand } from '@vitest/browser';
import { playwright } from '@vitest/browser-playwright';
import { chromium } from 'playwright';
import { defineProject, type Plugin } from 'vitest/config';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const DIST = fileURLToPath(new URL('../../../data/vocab/dist/', import.meta.url));
const HAVE_CHROMIUM = existsSync(chromium.executablePath());

if (!HAVE_CHROMIUM) {
  console.warn('[worker-browser] chromium is not installed (pnpm exec playwright install chromium): tests skip');
}

/** `commands.vocabManifest()`: the converter's manifest from disk, or null when `data/vocab/dist` has none. */
const vocabManifest = defineBrowserCommand(async () => {
  try {
    return JSON.parse(await readFile(join(DIST, 'vocab-manifest.generated.json'), 'utf8')) as unknown;
  } catch {
    return null;
  }
});

/** Serves `/tok-corrupt/<path>` as the bytes of `data/vocab/dist/tok/<path>` with the middle byte flipped. */
function corruptCopies(): Plugin {
  return {
    name: 'tsbs:corrupt-copies',
    configureServer(server) {
      server.middlewares.use((req, res, next) => {
        const url = (req.url ?? '').split('?')[0] ?? '';
        if (!url.startsWith('/tok-corrupt/')) {
          next();
          return;
        }
        const file = normalize(join(DIST, 'tok', url.slice('/tok-corrupt/'.length)));
        if (!file.startsWith(normalize(join(DIST, 'tok')))) {
          next();
          return;
        }
        readFile(file).then(
          (body) => {
            const middle = body.length >> 1;
            body[middle] = (body[middle] ?? 0) ^ 0xff;
            res.setHeader('Content-Type', 'application/octet-stream');
            res.setHeader('Content-Length', String(body.length));
            res.end(body);
          },
          () => {
            next();
          },
        );
      });
    },
  };
}

export default defineProject({
  root: ROOT,
  publicDir: DIST,
  plugins: [corruptCopies()],
  test: {
    name: 'worker-browser',
    root: ROOT,
    include: ['test/browser/**/*.test.ts'],
    ...(HAVE_CHROMIUM
      ? {
          browser: {
            enabled: true,
            provider: playwright(),
            headless: true,
            screenshotFailures: false,
            commands: { vocabManifest },
            instances: [{ browser: 'chromium' }],
          },
        }
      : { environment: 'node' }),
  },
});
