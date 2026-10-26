/**
 * WP13 integration — URL state (05 §1.1): `?t=…&q=…&s=<stage>.<step>&b=…&lang=…&tl=…` read once at load; invalid values
 * fall back to the defaults; `history.replaceState` (500 ms debounce) writes everything but the text; "Copy link" alone
 * writes the text (≤ 2,000 code points) and confirms it visibly — or says the link is in the address bar when the
 * clipboard refuses; a `q` that no longer equals the text leaves the address bar after the next edit.
 */
import { expect, test, type Page } from '@playwright/test';
import { grid } from './board-helpers.ts';
import { checkedStop, scrubber } from './pipeline-helpers.ts';
import { LIVE_READY_TIMEOUT_MS, openShell } from './shell-helpers.ts';

const RAMEN = '東京都渋谷区のラーメン屋さん';

const byteView = (page: Page): Promise<string> =>
  page.locator('input[name="byte-view"]:checked').evaluate((radio) => (radio as HTMLInputElement).value);

const params = (page: Page): URLSearchParams => new URL(page.url()).searchParams;

/**
 * Replaces `navigator.clipboard` with one that accepts every write (kept in `window.__copied`) or refuses it, so "Copy
 * link" is checked the same on every project: headless Chromium refuses a write without a permission grant, which
 * Firefox does not support.
 */
async function stubClipboard(page: Page, accept: boolean): Promise<void> {
  await page.addInitScript((ok) => {
    const copied: string[] = [];
    Object.assign(window, { __copied: copied });
    Object.defineProperty(navigator, 'clipboard', {
      configurable: true,
      value: {
        writeText: (text: string): Promise<void> => {
          if (!ok) return Promise.reject(new DOMException('denied', 'NotAllowedError'));
          copied.push(text);
          return Promise.resolve();
        },
      },
    });
  }, accept);
}

/** The last text the stubbed clipboard accepted. */
const lastCopied = (page: Page): Promise<string | undefined> =>
  page.evaluate(() => (window as unknown as { __copied: string[] }).__copied.at(-1));

test('a deep link restores tokenizer, text, stage and step, byte view, UI locale and text language', async ({
  page,
}) => {
  const query = new URLSearchParams({ t: 'xai-grok2', q: RAMEN, s: '5.3', b: 'dec', lang: 'ja', tl: 'ja' });
  await page.goto(`/?${query.toString()}`);
  await expect(page.locator('html')).toHaveAttribute('lang', 'ja');
  await expect(page.getByTestId('picker-button')).toContainText('Grok-2');
  await expect(page.locator('#text-input')).toHaveValue(RAMEN);
  await expect(page.locator('#text-input')).toHaveAttribute('lang', 'ja');
  await expect(page.locator('[data-source="live"]')).toBeVisible({ timeout: LIVE_READY_TIMEOUT_MS });
  expect(await checkedStop(page)).toBe(5);
  await expect(grid(page)).toHaveAttribute('data-stage', '5');
  await expect(scrubber(page)).toHaveValue('3');
  expect(await byteView(page)).toBe('dec');
  await expect(grid(page).locator('[data-tier="dec"]').first()).toBeVisible();
  await expect(grid(page).locator('[data-tier="hex"]')).toHaveCount(0);
  // Nothing changed yet: the address bar is still the link the page opened with.
  expect(params(page).get('q')).toBe(RAMEN);
});

test('invalid URL values are ignored and the defaults stay', async ({ page }) => {
  await page.goto('/?t=gpt-9&s=9.1&b=octal&tl=xx&lang=en');
  await expect(page.locator('[data-source]')).toBeVisible();
  await expect(page.getByTestId('picker-button')).toContainText('o200k_base');
  await expect(page.locator('#text-input')).toHaveValue('台灣台南');
  expect(await checkedStop(page)).toBe(6);
  expect(await byteView(page)).toBe('hex');
});

test('state changes reach the URL after 500 ms, never the text; "Copy link" writes the text with a confirmation', async ({
  page,
}) => {
  await stubClipboard(page, true);
  await openShell(page, 'en');
  expect(page.url()).not.toContain('?t=');
  await page.locator('#text-input').fill('熱鬧');
  await page.locator('#text-input').blur();
  await page.keyboard.press('Digit3');
  await expect.poll(() => params(page).get('s')).toBe('3');
  expect(params(page).get('t')).toBe('openai-o200k_base');
  expect(params(page).get('lang')).toBe('en');
  expect(params(page).has('q')).toBe(false);

  await page.getByTestId('copy-link').click();
  await expect(page.getByTestId('copy-link-status')).toHaveText('Link copied');
  expect(params(page).get('q')).toBe('熱鬧');
  expect(params(page).get('s')).toBe('3');
  expect(await lastCopied(page)).toBe(page.url());

  // A text over 2,000 code points is left out, and the confirmation says so.
  await page.locator('#text-input').fill('a'.repeat(2001));
  await page.getByTestId('copy-link').click();
  await expect(page.getByTestId('copy-link-status')).toHaveText(
    'Link copied without the text (longer than 2,000 characters)',
  );
  expect(params(page).has('q')).toBe(false);
});

test('"Copy link" says the link is in the address bar when the clipboard refuses it', async ({ page }) => {
  await stubClipboard(page, false);
  await openShell(page, 'en');
  await page.getByTestId('copy-link').click();
  await expect(page.getByTestId('copy-link-status')).toHaveText('Could not copy — the link is in the address bar');
  expect(params(page).get('q')).toBe('台灣台南');
});

test('a q from a deep link or from "Copy link" leaves the address bar once the text is edited', async ({ page }) => {
  await stubClipboard(page, true);
  await page.goto(`/?${new URLSearchParams({ q: RAMEN, lang: 'en' }).toString()}`);
  await expect(page.locator('[data-source="live"]')).toBeVisible({ timeout: LIVE_READY_TIMEOUT_MS });
  expect(params(page).get('q')).toBe(RAMEN);
  await page.locator('#text-input').fill('熱鬧');
  await expect.poll(() => params(page).has('q')).toBe(false);
  expect(params(page).get('lang')).toBe('en');

  await page.getByTestId('copy-link').click();
  await expect(page.getByTestId('copy-link-status')).toHaveText('Link copied');
  expect(params(page).get('q')).toBe('熱鬧');
  await page.locator('#text-input').fill('熱鬧台南');
  await expect.poll(() => params(page).has('q')).toBe(false);
});
