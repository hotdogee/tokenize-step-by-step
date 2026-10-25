/**
 * WP06 acceptance: the notices strip follows the selection rule (05 §15) — "Powered by xAI" is visible after selecting
 * Grok-2 and absent after selecting o200k — plus the shell's keyboard contract (AD-22): `t` opens the picker, `?` the
 * help dialog, and "Single-key shortcuts: off" disables both while Esc keeps closing dialogs.
 */
import { expect, test } from '@playwright/test';
import { openShell, pickTokenizer } from './shell-helpers.ts';

test('"Powered by xAI" is visible iff Grok-2 is selected', async ({ page }) => {
  await openShell(page, 'en');
  await expect(page.getByText('Powered by xAI')).toHaveCount(0);
  await pickTokenizer(page, 'Grok-2');
  await expect(page.getByText('Powered by xAI')).toBeVisible();
  await expect(page.getByTestId('notices')).toHaveAttribute('aria-label', /Grok-2/);
  await pickTokenizer(page, 'o200k_base');
  await expect(page.getByText('Powered by xAI')).toHaveCount(0);
  await pickTokenizer(page, 'Llama 3');
  await expect(page.getByText('Built with Meta Llama 3')).toBeVisible();
});

test('the picker announces progress and the loaded tokenizer', async ({ page }) => {
  await openShell(page, 'en');
  // Until the Worker client (WP07) the download is the tokenizer's precomputed examples file: hold it so the progress
  // bar is observable instead of racing a local fetch.
  let release: () => void = () => undefined;
  const held = new Promise<void>((resolve) => {
    release = resolve;
  });
  await page.route('**/examples/openai-cl100k_base.*.json', async (route) => {
    await held;
    await route.continue();
  });
  await page.getByTestId('picker-button').click();
  await page.getByRole('option', { name: /cl100k_base/ }).click();
  // Held before the first byte: the bar is at 0 % (scaleX(0), so not "visible" to Playwright) but announced.
  const progress = page.getByRole('progressbar', { name: 'Loading cl100k_base (GPT-4 / GPT-3.5)…' });
  await expect(progress).toBeAttached();
  await expect(progress).toHaveAttribute('aria-valuetext', /cl100k_base/);
  release();
  await expect(page.getByTestId('status')).toContainText('cl100k_base (GPT-4 / GPT-3.5) ready');
  await expect(page.getByRole('progressbar')).toHaveCount(0);
  // 台灣台南 is an example chip: cl100k answers it with the oracle's 5 tokens, 2 of them partial (灣 = E7 81 + A3).
  await expect(page.getByTestId('counts')).toContainText('5 tokens');
  await expect(page.getByTestId('counts')).toContainText('2 partial-character tokens');
  // Text outside the chips has no result before the engines exist: the counts wait instead of showing stale tokens.
  await page.locator('#text-input').fill('not an example');
  await expect(page.getByTestId('counts')).toContainText('waiting for the tokenizer');
});

test('the picker listbox works from the keyboard and returns focus on close', async ({ page }) => {
  await openShell(page, 'en');
  await page.keyboard.press('t');
  const dialog = page.getByRole('dialog');
  await expect(dialog).toBeVisible();
  await expect(page.getByRole('option', { name: /o200k_base/ })).toBeFocused();
  await page.keyboard.press('ArrowDown');
  await expect(page.getByRole('option', { name: /cl100k_base/ })).toBeFocused();
  await page.keyboard.press('End');
  await expect(page.getByRole('option', { name: /Grok-1/ })).toBeFocused();
  await page.keyboard.press('Escape');
  await expect(dialog).toBeHidden();
  // Opened from the button: focus goes back to it.
  await page.getByTestId('picker-button').focus();
  await page.keyboard.press('Enter');
  await expect(dialog).toBeVisible();
  await page.keyboard.press('g');
  await expect(page.getByRole('option', { name: /Gemma 4/ })).toBeFocused(); // typeahead
  await page.keyboard.press('Escape');
  await expect(page.getByTestId('picker-button')).toBeFocused();
});

test('single-key shortcuts can be turned off (WCAG 2.1.4); Esc still closes dialogs', async ({ page }) => {
  await openShell(page, 'en');
  await page.keyboard.press('Shift+Slash');
  const dialog = page.getByRole('dialog');
  await expect(dialog).toBeVisible();
  await dialog.getByRole('switch', { name: 'Single-key shortcuts' }).uncheck();
  await page.keyboard.press('Escape');
  await expect(dialog).toBeHidden();
  await page.locator('body').click({ position: { x: 5, y: 5 } });
  await page.keyboard.press('Shift+Slash');
  await page.keyboard.press('t');
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await page.reload();
  await expect(page.locator('[data-source="live"]')).toBeVisible();
  await page.keyboard.press('t');
  await expect(page.getByRole('dialog')).toHaveCount(0);
});

test('/ focuses the text box and an example chip applies its verbatim text', async ({ page }) => {
  await openShell(page, 'en');
  await page.keyboard.press('Slash');
  await expect(page.locator('#text-input')).toBeFocused();
  await page.locator('[data-key="ja-text"]').click();
  await expect(page.locator('#text-input')).toHaveValue('日本語のテキスト');
  await expect(page.locator('#text-input')).toHaveAttribute('lang', 'ja');
  await expect(page.getByTestId('counts')).toContainText('24 bytes');
});
