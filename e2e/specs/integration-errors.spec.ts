/**
 * WP13 integration — error toasts (05 §12, 04 §5) through `page.route`: a failed download says so and retries; a 404
 * (a stale deploy) offers the reload; a corrupted `.bin` is refetched once automatically, then "Download was corrupted —
 * retry"; an out-of-memory build (a mocked engine chunk that throws `RangeError`) offers "back", which returns to the
 * previous tokenizer — still resident in its own Worker (PA-19), so nothing is downloaded again. Every toast is a
 * `role="alert"`.
 */
import { expect, test, type Page } from '@playwright/test';
import { LIVE_READY_TIMEOUT_MS, openShell, pickTokenizer } from './shell-helpers.ts';

const toast = (page: Page) => page.getByTestId('error-toast');

test('a failed download shows the retry toast; retrying loads the tokenizer', async ({ page }) => {
  await page.route('**/tok/**', (route) => route.abort('failed'));
  await page.goto('/?lang=en');
  await expect(toast(page)).toBeVisible({ timeout: LIVE_READY_TIMEOUT_MS });
  await expect(toast(page).getByRole('alert')).toHaveText(
    'Could not download o200k_base (GPT-4o → GPT-5.x) — check the connection and retry',
  );
  await page.unroute('**/tok/**');
  await toast(page).getByTestId('error-action').click();
  await expect(page.locator('[data-source="live"]')).toBeVisible({ timeout: LIVE_READY_TIMEOUT_MS });
  await expect(toast(page)).toHaveCount(0);
});

test('a 404 for the vocabulary (a stale deploy) offers the reload', async ({ page }) => {
  await page.route('**/tok/**', (route) => route.fulfill({ status: 404, body: 'gone' }));
  await page.goto('/?lang=en');
  await expect(toast(page).getByRole('alert')).toHaveText('A new version is available — reload', {
    timeout: LIVE_READY_TIMEOUT_MS,
  });
  await expect(toast(page).getByTestId('error-action')).toHaveText('Reload');
});

test('a corrupted download is refetched once automatically, then the integrity toast offers a retry', async ({
  page,
}) => {
  let requests = 0;
  await page.route('**/tok/**', async (route) => {
    requests++;
    const response = await route.fetch();
    const body = Buffer.from(await response.body());
    const middle = Math.floor(body.length / 2);
    body[middle] = (body[middle] ?? 0) ^ 0xff;
    await route.fulfill({ response, body });
  });
  await page.goto('/?lang=en');
  await expect(toast(page).getByRole('alert')).toHaveText('Download was corrupted — retry', {
    timeout: LIVE_READY_TIMEOUT_MS,
  });
  expect(requests).toBe(2);
  await expect(toast(page).getByTestId('error-action')).toHaveText('Retry');
});

test('an out-of-memory build offers "back", which returns to the previous tokenizer still resident in its Worker', async ({
  page,
}) => {
  await openShell(page, 'en');
  await page.route('**/assets/spm-*.js', (route) =>
    route.fulfill({
      contentType: 'text/javascript',
      body: 'export function createSpmTokenizer() { throw new RangeError("Array buffer allocation failed"); }',
    }),
  );
  await pickTokenizer(page, 'Grok-1');
  await expect(toast(page).getByRole('alert')).toHaveText(
    'Not enough memory to load Grok-1 (historical) on this device — try o200k_base (GPT-4o → GPT-5.x)',
    { timeout: LIVE_READY_TIMEOUT_MS },
  );
  const downloads: string[] = [];
  page.on('request', (request) => {
    if (new URL(request.url()).pathname.startsWith('/tok/')) downloads.push(request.url());
  });
  await toast(page).getByTestId('error-action').click();
  await expect(page.getByTestId('picker-button')).toContainText('o200k_base');
  await expect(page.locator('[data-source="live"]')).toBeVisible({ timeout: LIVE_READY_TIMEOUT_MS });
  await expect(toast(page)).toHaveCount(0);
  // PA-19: o200k never left its own Worker (AD-19 holds per Worker), so "back" loads nothing.
  expect(downloads).toEqual([]);
  expect(JSON.parse((await page.evaluate(() => sessionStorage.getItem('tsbs:lastLoaded'))) ?? '{}')).toMatchObject({
    tokenizer: 'openai-o200k_base',
  });
});
