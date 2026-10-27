/**
 * Wave 2 integration (PA-8): the page's default client is the Worker `TokenizerClient` with the real engines, so typed
 * text that is no example chip is tokenized live and the board shows the oracle's ids; the Worker's host chunk and the
 * byte-level engine chunk load after first paint; the picker's wire-size column comes from the Worker's `ready.assets`;
 * `?mock=1` keeps the precomputed-examples client (free text then waits for the tokenizer). Zero CSP violations, no
 * page errors.
 */
import { expect, test, type Page } from '@playwright/test';
import { watchPage } from '../support/page-guards.ts';
import { grid } from './board-helpers.ts';
import { openShell, rowSource } from './shell-helpers.ts';

/**
 * The Python oracle's ids (tiktoken 0.14.0 on the pinned o200k_base.tiktoken, encode_ordinary), computed with
 *   cd tools/oracle && uv run --project . python -c "from oracles.tiktoken_family import _openai_encoding; print(_openai_encoding('o200k_base', 'openai-o200k_base', 'o200k_base.tiktoken').encode_ordinary('こんにちは台灣 123 abc'))"
 * → こんにちは · 台 · 灣 · ␠ · 123 · ␠abc (the digits do not take the space: \p{N}{1,3} has no leading-space branch).
 */
const TEXT = 'こんにちは台灣 123 abc';
const O200K_IDS = [95839, 3735, 133072, 220, 7633, 75094];

/** The ids of the token tier, in order: one per token (the first fragment of a wrapped token), read from its label. */
async function boardIds(page: Page): Promise<number[]> {
  const labels = await grid(page)
    .locator('[data-tier="token"][data-first]')
    .evaluateAll((cells) => cells.map((cell) => cell.getAttribute('aria-label') ?? ''));
  return labels.map((label) => Number(/\bid (\d+)/.exec(label)?.[1] ?? Number.NaN));
}

test('typed text is tokenized live in the Worker: こんにちは台灣 123 abc on o200k shows the oracle ids', async ({
  page,
}) => {
  const guards = await watchPage(page);
  const requests: string[] = [];
  page.on('request', (request) => requests.push(new URL(request.url()).pathname));
  await openShell(page, 'en', { advanced: true });
  expect(requests.some((path) => /^\/assets\/entry-[\w-]+\.js$/.test(path))).toBe(true);
  expect(requests.some((path) => /^\/assets\/bytelevel-[\w-]+\.js$/.test(path))).toBe(true);
  expect(requests.some((path) => /^\/tok\/openai-o200k_base\/[0-9a-f]{12}\.bin$/.test(path))).toBe(true);
  expect(requests.some((path) => path.startsWith('/assets/spm-'))).toBe(false); // engines load per family, lazily

  await page.locator('#text-input').fill(TEXT);
  await expect(page.getByTestId('counts')).toContainText('6 tokens');
  await expect(page.getByTestId('counts')).toContainText('29 bytes');
  await expect(page.locator('#advanced [data-source="live"]')).toBeVisible();
  await expect(grid(page)).not.toHaveAttribute('data-pending', '');
  await expect.poll(() => boardIds(page)).toEqual(O200K_IDS);
  expect(await guards.cspViolations()).toEqual([]);
  expect(guards.pageErrors()).toEqual([]);
});

test("the picker's wire sizes come from the Worker's asset summary", async ({ page }) => {
  await openShell(page, 'en', { advanced: true });
  await page.getByTestId('picker-button').click();
  const dialog = page.getByRole('dialog');
  await expect(dialog).toBeVisible();
  // vocab-manifest.generated.json: cl100k_base bytesCompressed 452,962 B → 442 KB; Gemma 4 1,658,262 B → 1.6 MB.
  await expect(dialog.getByRole('option', { name: /cl100k_base/ })).toContainText(/\d+ KB download/);
  await expect(dialog.getByRole('option', { name: /Gemma 4/ })).toContainText(/\d\.\d MB download/);
  await page.keyboard.press('Escape');
});

test('?mock=1 keeps the precomputed-examples client: chips answer, free text waits for the tokenizer', async ({
  page,
}) => {
  const requests: string[] = [];
  page.on('request', (request) => requests.push(new URL(request.url()).pathname));
  await page.goto('/?lang=en&mock=1');
  await expect(rowSource(page)).toHaveAttribute('data-source', 'live');
  const openai = page.locator('[data-testid="compare"] [data-row="openai"]');
  await expect(openai.locator('.cmp-cap')).toContainText('4 tokens');
  expect(requests.some((path) => path.startsWith('/tok/'))).toBe(false);
  await page.locator('#text-input').fill(TEXT);
  await expect(openai.getByTestId('row-status')).toHaveText('tokens: waiting for the tokenizer');
  expect(requests.some((path) => /^\/examples\/openai-o200k_base\.[0-9a-f]+\.json$/.test(path))).toBe(true);
  expect(requests.some((path) => path.startsWith('/tok/'))).toBe(false);
});
