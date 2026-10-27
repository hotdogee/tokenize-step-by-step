/**
 * WP06 acceptance, as PA-19 amends it: the notices strip shows the union of the notices of every tokenizer on screen
 * (05 §15) — "Powered by xAI" is visible by default (the xAI row shows Grok-2) and absent only when the xAI row shows
 * Grok-1 and the board's tokenizer is not Grok-2 — plus the shell's keyboard contract (AD-22): `t` opens Advanced and
 * the picker, `?` the help dialog, and "Single-key shortcuts: off" disables both while Esc keeps closing dialogs.
 */
import { expect, test } from '@playwright/test';
import { chooseExample } from './board-helpers.ts';
import {
  LIVE_READY_TIMEOUT_MS,
  openAdvanced,
  openShell,
  pickTokenizer,
  rowSource,
  switchTokenizer,
} from './shell-helpers.ts';

test('"Powered by xAI" is visible by default and gone only when no tokenizer on screen is Grok-2', async ({ page }) => {
  await openShell(page, 'en');
  await expect(page.getByText('Powered by xAI')).toBeVisible();
  await expect(page.getByTestId('notices')).toHaveAttribute('aria-label', 'Notices for 5 tokenizers');
  await page.getByTestId('row-select-xai').selectOption('xai-grok1');
  await expect(page.getByText('Powered by xAI')).toHaveCount(0);
  await switchTokenizer(page, 'Grok-2');
  await expect(page.getByText('Powered by xAI')).toBeVisible();
  await switchTokenizer(page, 'o200k_base');
  await expect(page.getByText('Powered by xAI')).toHaveCount(0);
  await page.getByTestId('row-select-meta').selectOption('meta-llama3');
  await expect(page.getByText('Built with Meta Llama 3')).toBeVisible();
});

test('the picker announces progress and the loaded tokenizer', async ({ page }) => {
  await openShell(page, 'en');
  await openAdvanced(page);
  // The download is the tokenizer's vocabulary (/tok/<id>/<sha12>.bin), fetched by the Worker: hold it so the progress
  // bar is observable instead of racing a local fetch.
  let release: () => void = () => undefined;
  const held = new Promise<void>((resolve) => {
    release = resolve;
  });
  await page.route('**/tok/openai-cl100k_base/*.bin', async (route) => {
    await held;
    await route.continue();
  });
  await page.getByTestId('picker-button').click();
  await page
    .getByRole('dialog')
    .getByRole('option', { name: /cl100k_base/ })
    .click();
  // Held before the first byte: the bar is at 0 % (scaleX(0), so not "visible" to Playwright) but announced.
  const progress = page.getByRole('progressbar', { name: 'Loading cl100k_base (GPT-4 / GPT-3.5)…' });
  await expect(progress).toBeAttached();
  await expect(progress).toHaveAttribute('aria-valuetext', /cl100k_base/);
  release();
  await expect(page.getByTestId('status')).toContainText('cl100k_base (GPT-4 / GPT-3.5) ready');
  await expect(page.getByRole('progressbar')).toHaveCount(0);
  // 台灣台南 is an example: cl100k answers it with the oracle's 5 tokens, 2 of them partial (灣 = E7 81 + A3).
  await expect(page.getByTestId('counts')).toContainText('5 tokens');
  await expect(page.getByTestId('counts')).toContainText('2 partial-character tokens');
  // Text outside the examples is tokenized live by the engine: cl100k gives not / an / example (1962 459 3187).
  await page.locator('#text-input').fill('not an example');
  await expect(page.getByTestId('counts')).toContainText('3 tokens');
  await expect(page.getByTestId('counts')).not.toContainText('waiting for the tokenizer');
});

test('the picker listbox works from the keyboard and returns focus on close', async ({ page }) => {
  await openShell(page, 'en');
  await page.keyboard.press('t'); // opens Advanced, then the picker (PA-19)
  const dialog = page.getByRole('dialog');
  await expect(dialog).toBeVisible();
  await expect(page.locator('details#advanced')).toHaveAttribute('open', '');
  await expect(dialog.getByRole('option', { name: /o200k_base/ })).toBeFocused();
  await page.keyboard.press('ArrowDown');
  await expect(dialog.getByRole('option', { name: /cl100k_base/ })).toBeFocused();
  await page.keyboard.press('End');
  await expect(dialog.getByRole('option', { name: /Grok-1/ })).toBeFocused();
  await page.keyboard.press('Escape');
  await expect(dialog).toBeHidden();
  // Opened from the button: focus goes back to it.
  await page.getByTestId('picker-button').focus();
  await page.keyboard.press('Enter');
  await expect(dialog).toBeVisible();
  await page.keyboard.press('g');
  await expect(dialog.getByRole('option', { name: /Gemma 4/ })).toBeFocused(); // typeahead
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
  await expect(rowSource(page)).toHaveAttribute('data-source', 'live', { timeout: LIVE_READY_TIMEOUT_MS });
  await page.keyboard.press('t');
  await expect(page.getByRole('dialog')).toHaveCount(0);
});

test('/ focuses the text box and an example applies its verbatim text, the text language staying auto', async ({
  page,
}) => {
  await openShell(page, 'en');
  await page.keyboard.press('Slash');
  await expect(page.locator('#text-input')).toBeFocused();
  await chooseExample(page, 'ja-text');
  await expect(page.locator('#text-input')).toHaveValue('日本語のテキスト');
  await expect(page.locator('#text-input')).toHaveAttribute('lang', 'ja'); // auto resolves kana to ja
  await expect(page.getByTestId('text-lang-note')).toContainText('Auto');
  await expect(page.getByTestId('compare-head')).toContainText('24 bytes');
});

test('picking a tokenizer in Advanced keeps the table on its rows', async ({ page }) => {
  await openShell(page, 'en');
  await pickTokenizer(page, 'Llama 3');
  await expect(page.locator('[data-testid="compare"] [data-row="meta"]')).toHaveAttribute(
    'data-tokenizer',
    'meta-llama4-muse',
  );
});
