/**
 * WP13 integration — keyboard focus is never dropped to the body by a control that goes busy or goes away (05 §8, WCAG
 * 2.4.3 / 2.4.7): "Tokenize now" keeps focus through its run (`aria-disabled`, never `disabled`); the error toast's Retry
 * and Dismiss leave focus on the textarea and "Go back" on the tokenizer picker — right away and after the recovery —
 * with a visible indicator (`:focus-visible`). Every control is reached and activated with the keyboard.
 */
import { expect, test, type Page } from '@playwright/test';
import { grid } from './board-helpers.ts';
import { LIVE_READY_TIMEOUT_MS, openShell, pickTokenizer } from './shell-helpers.ts';

/** An on-demand run over 20,001 code points takes a few seconds on a loaded CI runner. */
const RUN_TIMEOUT_MS = 60_000;
/** Presses before giving up on reaching a control with Tab. */
const MAX_PRESSES = 40;

test.skip(
  ({ browserName }) => browserName === 'webkit',
  'WebKit moves Tab focus only between form fields unless "Press Tab to highlight each item" is on',
);

const toast = (page: Page) => page.getByTestId('error-toast');

/** The focused element (its test id, else its id; `body` when none) and whether it shows its ring. */
function active(page: Page): Promise<{ readonly id: string; readonly visible: boolean }> {
  return page.evaluate(() => {
    const element = document.activeElement as HTMLElement | null;
    if (element === null || element === document.body) return { id: 'body', visible: false };
    return { id: element.dataset['testid'] ?? element.id, visible: element.matches(':focus-visible') };
  });
}

/** Presses `key` until the focused element is `id` (a test id or an id). */
async function pressTo(page: Page, key: 'Tab' | 'Shift+Tab', id: string): Promise<void> {
  for (let i = 0; i < MAX_PRESSES; i++) {
    if ((await active(page)).id === id) return;
    await page.keyboard.press(key);
  }
  throw new Error(`${key} never reached ${id}`);
}

/** From the textarea, Shift+Tab back to the toast's `id` (the toast precedes the input panel in tab order). */
async function reachToast(page: Page, id: 'error-action' | 'error-dismiss'): Promise<void> {
  await expect(toast(page)).toBeVisible({ timeout: LIVE_READY_TIMEOUT_MS });
  await page.locator('#text-input').focus();
  await pressTo(page, 'Shift+Tab', id);
}

test('"Tokenize now" keeps keyboard focus while its run is in flight and after it', async ({ page }) => {
  test.slow();
  await openShell(page, 'en', { advanced: true });
  await page.locator('#text-input').fill('a'.repeat(20_001));
  await expect(page.getByTestId('long-input-banner')).toBeVisible();
  await pressTo(page, 'Tab', 'long-input-run');
  await page.keyboard.press('Enter');
  expect(await active(page)).toEqual({ id: 'long-input-run', visible: true });
  await expect(grid(page)).toHaveAttribute('data-window', /^\d+-\d+$/, { timeout: RUN_TIMEOUT_MS });
  await expect(page.getByTestId('long-input-run')).toHaveAttribute('aria-disabled', 'false');
  expect(await active(page)).toEqual({ id: 'long-input-run', visible: true });
});

test('Retry after an aborted download leaves keyboard focus on the textarea, right away and after the recovery', async ({
  page,
}) => {
  await page.route('**/tok/**', (route) => route.abort('failed'));
  await page.goto('/?lang=en');
  await reachToast(page, 'error-action');
  await expect(page.getByTestId('error-action')).toHaveText('Retry');
  await page.unroute('**/tok/**');
  await page.keyboard.press('Enter');
  expect(await active(page)).toEqual({ id: 'text-input', visible: true });
  await expect(page.locator('[data-row="openai"] [data-source="live"]')).toBeVisible({
    timeout: LIVE_READY_TIMEOUT_MS,
  });
  await expect(toast(page)).toHaveCount(0);
  expect(await active(page)).toEqual({ id: 'text-input', visible: true });
});

test('Dismiss leaves keyboard focus on the textarea', async ({ page }) => {
  await openShell(page, 'en');
  await page.route('**/tok/**', (route) => route.abort('failed'));
  await pickTokenizer(page, 'cl100k_base');
  await reachToast(page, 'error-dismiss');
  await page.keyboard.press('Enter');
  await expect(toast(page)).toHaveCount(0);
  expect(await active(page)).toEqual({ id: 'text-input', visible: true });
});

test('"Go back" leaves keyboard focus on the tokenizer picker, right away and after the previous tokenizer loads', async ({
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
  await reachToast(page, 'error-action');
  await expect(page.getByTestId('error-action')).toHaveText('Go back');
  await page.keyboard.press('Enter');
  expect(await active(page)).toEqual({ id: 'picker-button', visible: true });
  await expect(page.getByTestId('picker-button')).toContainText('o200k_base');
  await expect(page.locator('#advanced [data-source="live"]')).toBeVisible({ timeout: LIVE_READY_TIMEOUT_MS });
  expect(await active(page)).toEqual({ id: 'picker-button', visible: true });
});
