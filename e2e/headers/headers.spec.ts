import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { expect, test } from '@playwright/test';
import { runSmoke, targetFromDist } from '../../scripts/lib/smoke.ts';
import { EXPECTED_PAGE_HEADERS, LANG_PATTERN, PAGES, THEME_PATTERN } from '../support/expected.ts';
import { watchPage } from '../support/page-guards.ts';

// Header-dependent checks (06 §1 "E2E (headers)") against workerd or a deployed preview — never `vite preview`.
const DIST = fileURLToPath(new URL('../../apps/web/dist/', import.meta.url));

for (const { path } of PAGES) {
  test(`${path} carries the 06 §6 security headers exactly, once each`, async ({ request }) => {
    const response = await request.get(path, { maxRedirects: 0 });
    expect(response.status()).toBe(200);
    const headers = response.headersArray();
    for (const [name, value] of Object.entries(EXPECTED_PAGE_HEADERS)) {
      const values = headers.filter((header) => header.name.toLowerCase() === name).map((header) => header.value);
      expect.soft(values, name).toEqual([value]);
    }
  });

  test(`${path} loads with zero CSP violations and boot.js ran before DOMContentLoaded`, async ({ page }) => {
    const guards = await watchPage(page);
    await page.goto(path);
    await page.waitForLoadState('load');
    expect(await guards.cspViolations()).toEqual([]);
    const boot = await guards.bootSnapshot();
    expect(boot?.lang).toMatch(LANG_PATTERN);
    expect(boot?.theme).toMatch(THEME_PATTERN);
  });
}

// The Worker under the production headers (PA-8): worker-src 'self' admits assets/entry-*.js, script-src 'self' its lazy
// engine import(), connect-src 'self' the /tok/*.bin fetch — a live result proves all three on workerd / the preview.
test('/ tokenizes typed text live in the Worker with zero CSP violations', async ({ page }) => {
  const guards = await watchPage(page);
  await page.goto('/?lang=en');
  await expect(page.locator('[data-source="live"]')).toBeVisible();
  await page.locator('#text-input').fill('こんにちは台灣 123 abc');
  await expect(page.getByTestId('counts')).toContainText('6 tokens'); // o200k: 95839 3735 133072 220 7633 75094
  expect(await guards.cspViolations()).toEqual([]);
});

// The deploy smoke checks of 06 §7 items 6–8 (scripts/lib/smoke.ts): /index.html → 307 /, /nope → 404.html with 404,
// dotfiles → 404, /tok/*.bin exact Content-Type / no Content-Encoding / Content-Length, /assets and /examples compressed +
// immutable + 304, /licenses max-age. Running them here proves the smoke script against a real workerd on every PR.
test('the 06 §7 deploy smoke checks pass', async ({ baseURL }) => {
  test.skip(!existsSync(DIST), 'apps/web/dist is missing; build first');
  const results = await runSmoke(targetFromDist(baseURL ?? '', DIST), (url, init) => fetch(url, init));
  for (const result of results)
    test.info().annotations.push({
      type: result.skipped ? 'skipped' : result.ok ? 'pass' : 'FAIL',
      description: `${result.name}: ${result.detail}`,
    });
  expect(results.filter((result) => !result.ok).map((result) => `${result.name}: ${result.detail}`)).toEqual([]);
});
