/**
 * Serves the browser-parity harness (`harness.ts`) to a Playwright page: esbuild bundles it once per worker process, and
 * `page.route` answers `/__parity/*` on the page's own origin — under the production CSP (06 §6) — so the harness needs no
 * server and never ships in `dist`.
 */
import { fileURLToPath } from 'node:url';
import type { Page } from '@playwright/test';
import { build } from 'esbuild';
import { EXPECTED_CSP } from '../support/expected.ts';

/** URL path of the harness page. */
export const PARITY_PATH = '/__parity/';

const HTML = `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <title>tsbs browser parity harness</title>
    <script type="module" src="${PARITY_PATH}harness.js"></script>
  </head>
  <body></body>
</html>
`;

let bundle: Promise<string> | undefined;

/** The harness as one ES module, built with the app's browser floor (02 §5). */
export function harnessBundle(): Promise<string> {
  bundle ??= build({
    entryPoints: [fileURLToPath(new URL('./harness.ts', import.meta.url))],
    bundle: true,
    format: 'esm',
    write: false,
    target: ['es2022', 'safari16.4', 'chrome109', 'firefox115'],
    logLevel: 'silent',
  }).then((result) => {
    const [output] = result.outputFiles;
    if (output === undefined) throw new Error('esbuild produced no output for the parity harness');
    return output.text;
  });
  return bundle;
}

/** Routes `/__parity/*` on `page`, opens the harness and waits until `window.tsbsParity` exists. */
export async function openHarness(page: Page): Promise<void> {
  const script = await harnessBundle();
  await page.route(`**${PARITY_PATH}**`, (route) => {
    const isScript = new URL(route.request().url()).pathname.endsWith('/harness.js');
    return route.fulfill({
      status: 200,
      headers: {
        'content-type': isScript ? 'text/javascript; charset=utf-8' : 'text/html; charset=utf-8',
        'content-security-policy': EXPECTED_CSP,
      },
      body: isScript ? script : HTML,
    });
  });
  await page.goto(PARITY_PATH);
  await page.waitForFunction(() => window.tsbsParity !== undefined);
}
