/**
 * WP13 integration — loading (06 §3, AD-16, 05 §12, 05 §14):
 *
 * - the vocabulary load trigger: the Worker script and the first `/tok/*` request start after every LCP entry;
 * - precomputed → live: with `/tok/*` held, every example chip shows its precomputed result (badge "precomputed") on
 *   every tokenizer; once the engine answers, the same chips' live results have identical token cells (ids, kinds,
 *   partial flags, variants) — gemma4's whitespace pieces stay Normal (AD-31);
 * - a second visit with `/tok/*` blocked at the network layer loads o200k from the Cache API (chromium), and About ›
 *   Diagnostics shows the cached file with its size, the last load and the Worker's features — without a Worker;
 * - the views name intermediate parts through the Worker's vocabulary lookup (TokenizationView `idOf`).
 */
import { expect, test, type Page, type Route } from '@playwright/test';
import type { TokenizerId } from '@tsbs/core';
import { watchPage } from '../support/page-guards.ts';
import { grid } from './board-helpers.ts';
import { domParts } from './pipeline-helpers.ts';
import { LIVE_READY_TIMEOUT_MS, openShell, pickTokenizer } from './shell-helpers.ts';

/** Picker names (part of each tokenizer's display name) in the brief's lab order. */
const TOKENIZERS: ReadonlyArray<readonly [TokenizerId, string]> = [
  ['openai-o200k_base', 'o200k_base'],
  ['openai-cl100k_base', 'cl100k_base'],
  ['anthropic-claude-legacy', 'Claude 1/2'],
  ['google-gemma4', 'Gemma 4'],
  ['google-gemma2', 'Gemma 1/2'],
  ['meta-llama4-muse', 'Llama 4'],
  ['meta-llama3', 'Llama 3'],
  ['xai-grok2', 'Grok-2'],
  ['xai-grok1', 'Grok-1'],
];

/** The 19 example chips (05 §6), as the registry orders them. */
const CHIPS = [
  'zh-tw-tainan',
  'zh-tw-taiwan-formal',
  'zh-tw-renao',
  'cjk-saba',
  'cjk-turtle',
  'cjk-ext-g-biang',
  'emoji-family-zwj',
  'emoji-flag-tw',
  'emoji-heart-vs16',
  'ja-text',
  'ja-shibuya-ramen',
  'mixed-hello-taiwan-tokyo',
  'zh-date',
  'en-contraction-code',
  'bopomofo',
  'fullwidth-latin',
  'zh-tw-paragraph',
  'ja-paragraph',
  'en-paragraph',
] as const;

/** Every token cell's identity: index, label (id, kind words, position), variant, partial flag and chip classes. */
function tokenCells(page: Page): Promise<string[]> {
  return grid(page)
    .locator('[data-tier="token"][data-first]')
    .evaluateAll((cells) =>
      cells.map((cell) =>
        [
          cell.getAttribute('data-index'),
          cell.getAttribute('aria-label'),
          cell.getAttribute('data-variant'),
          cell.hasAttribute('data-partial') ? 'partial' : '',
          // Class order follows each element's update history, so the set is compared, sorted.
          (cell.firstElementChild?.getAttribute('class') ?? '')
            .split(/\s+/)
            .filter((name) => name !== '' && !name.startsWith('svelte-'))
            .sort()
            .join(' '),
        ].join(' | '),
      ),
    );
}

/** Applies a chip and waits for its result from `source`; returns the token cells. */
async function chipCells(page: Page, key: string, source: 'precomputed' | 'live'): Promise<string[]> {
  await page.locator(`[data-key="${key}"]`).click();
  await expect(page.locator(`[data-source="${source}"]`)).toBeVisible({ timeout: LIVE_READY_TIMEOUT_MS });
  await expect(grid(page)).not.toHaveAttribute('data-pending', '');
  return tokenCells(page);
}

test('the Worker script and the vocabulary download start after the LCP entry (06 §3 load trigger)', async ({
  page,
  browserName,
}) => {
  test.skip(browserName === 'webkit', 'WebKit reports no largest-contentful-paint entries');
  await page.addInitScript(() => {
    const store = window as unknown as { __tsbsLcp: number[] };
    store.__tsbsLcp = [];
    new PerformanceObserver((list) => {
      for (const entry of list.getEntries()) store.__tsbsLcp.push(performance.timeOrigin + entry.startTime);
    }).observe({ type: 'largest-contentful-paint', buffered: true });
  });
  const starts: Array<{ readonly path: string; readonly at: number }> = [];
  page.on('requestfinished', (request) => {
    const path = new URL(request.url()).pathname;
    if (path.startsWith('/tok/') || /^\/assets\/entry-[\w-]+\.js$/.test(path))
      starts.push({ path, at: request.timing().startTime });
  });
  await openShell(page, 'en');
  await expect.poll(() => starts.some((s) => s.path.startsWith('/tok/'))).toBe(true);
  const lcp = await page.evaluate(() => (window as unknown as { __tsbsLcp: number[] }).__tsbsLcp);
  expect(lcp.length).toBeGreaterThan(0);
  const lastLcp = Math.max(...lcp);
  const tok = Math.min(...starts.filter((s) => s.path.startsWith('/tok/')).map((s) => s.at));
  const worker = Math.min(...starts.filter((s) => s.path.startsWith('/assets/entry-')).map((s) => s.at));
  expect(tok, 'first /tok/* request after the last LCP entry').toBeGreaterThan(lastLcp);
  expect(worker, 'Worker entry script after the last LCP entry').toBeGreaterThan(lastLcp);
});

for (const [id, name] of TOKENIZERS) {
  test(`precomputed and live results are identical for every chip — ${id}`, async ({ page }) => {
    test.slow();
    const guards = await watchPage(page);
    // Hold every vocabulary download until the precomputed pass is done.
    const held: Route[] = [];
    let holding = true;
    await page.route('**/tok/**', async (route) => {
      if (holding) held.push(route);
      else await route.continue();
    });
    await page.goto('/?lang=en');
    await expect(page.locator('[data-source="precomputed"]')).toBeVisible();
    if (id !== 'openai-o200k_base') {
      await pickTokenizer(page, name);
      await expect(page.getByTestId('picker-button')).toContainText(name);
    }
    const precomputed = new Map<string, string[]>();
    for (const key of CHIPS) precomputed.set(key, await chipCells(page, key, 'precomputed'));
    expect(held.length, 'the vocabulary download was held').toBeGreaterThan(0);

    holding = false;
    for (const route of held.splice(0)) await route.continue();
    await expect(page.locator('[data-source="live"]')).toBeVisible({ timeout: LIVE_READY_TIMEOUT_MS * 2 });
    for (const key of CHIPS) {
      const live = await chipCells(page, key, 'live');
      const before = precomputed.get(key) ?? [];
      expect(live.length, `${id} × ${key} has tokens`).toBeGreaterThan(0);
      if (!key.endsWith('-paragraph')) {
        expect(live, `${id} × ${key}`).toEqual(before);
        continue;
      }
      // Paragraph boards are virtualized (PA-11): the rows in view may differ between the two passes, so the cells of
      // the token indices mounted in both are compared (each label also carries the token count, "token i of n").
      const byIndex = new Map(before.map((cell) => [cell.split(' | ')[0], cell]));
      const common = live.filter((cell) => byIndex.has(cell.split(' | ')[0]));
      expect(common.length, `${id} × ${key}: cells mounted in both passes`).toBeGreaterThan(0);
      for (const cell of common) expect(cell, `${id} × ${key}`).toBe(byIndex.get(cell.split(' | ')[0]));
    }

    if (id === 'google-gemma4') {
      // AD-31: the fixture labels these USER_DEFINED (Gemma 3 provenance); HF semantics and the board show Normal.
      for (const [text, tokenId] of [
        ['\t', 255968],
        ['\n\n', 108],
        ['   ', 139],
      ] as const) {
        // Set as a paste would (Playwright's fill() of "\t" on WebKit makes the editor try an inline style attribute,
        // which the strict CSP rightly refuses; a user cannot type a tab into the textarea anyway).
        await page.locator('#text-input').evaluate((el, value) => {
          const input = el as HTMLTextAreaElement;
          input.value = value;
          input.dispatchEvent(new InputEvent('input', { bubbles: true, inputType: 'insertFromPaste', data: value }));
        }, text);
        await expect(page.getByTestId('counts')).toContainText(`${String(text.length)} byte`);
        await expect(grid(page)).not.toHaveAttribute('data-pending', '');
        const cells = await tokenCells(page);
        expect(cells, JSON.stringify(text)).toHaveLength(1);
        expect(cells[0]).toContain(`id ${String(tokenId)}`);
        expect(cells[0]).not.toMatch(/pre-matched|never merges/);
      }
    }
    expect(await guards.cspViolations()).toEqual([]);
  });
}

test('a second visit with /tok/* blocked loads o200k from the Cache API; About › Diagnostics reads it without a Worker', async ({
  page,
  browserName,
}) => {
  test.skip(browserName !== 'chromium', 'Cache API persistence across reloads is asserted on chromium (06 §1)');
  await openShell(page, 'en');
  await expect
    .poll(() =>
      page.evaluate(async () => {
        for (const name of await caches.keys()) {
          const cache = await caches.open(name);
          if ((await cache.keys()).some((request) => new URL(request.url).pathname.startsWith('/tok/'))) return true;
        }
        return false;
      }),
    )
    .toBe(true);
  const blocked: string[] = [];
  await page.route('**/tok/**', async (route) => {
    blocked.push(route.request().url());
    await route.abort();
  });
  await page.reload();
  await expect(page.locator('[data-source="live"]')).toBeVisible({ timeout: LIVE_READY_TIMEOUT_MS });
  await expect(page.getByTestId('error-toast')).toHaveCount(0);
  const last = JSON.parse((await page.evaluate(() => sessionStorage.getItem('tsbs:lastLoaded'))) ?? '{}') as {
    fromCache?: boolean;
    tokenizer?: string;
  };
  expect(last).toMatchObject({ tokenizer: 'openai-o200k_base', fromCache: true });
  expect(blocked).toEqual([]); // served from the Cache API, never asked the network

  const workers: string[] = [];
  page.on('worker', (worker) => workers.push(worker.url()));
  await page.goto('/about/?lang=en');
  const diagnostics = page.getByTestId('diagnostics');
  await expect(diagnostics.getByTestId('diagnostics-cache')).toContainText(
    /\/tok\/openai-o200k_base\/[0-9a-f]+\.bin \(\d/,
  );
  await expect(diagnostics.getByTestId('diagnostics-last-load')).toContainText('from the cache');
  await expect(diagnostics.getByTestId('diagnostics-worker')).toContainText('Web Crypto');
  await expect(diagnostics.getByTestId('diagnostics-unicode')).toContainText(
    /Pre-tokenizer Unicode 16\.0; your browser/,
  );
  await expect(diagnostics.getByTestId('diagnostics-build')).toContainText(/^Build \w+/);
  expect(workers).toEqual([]);
});

test('stop 4 names every part through the Worker vocabulary lookup (TokenizationView idOf)', async ({ page }) => {
  await openShell(page, 'en');
  await page.locator('body').press('Digit4');
  await expect(grid(page)).toHaveAttribute('data-stage', '4');
  // 台灣台南 on o200k before any merge: twelve single bytes, each a vocabulary entry no fixture replay can name.
  await expect.poll(async () => (await domParts(page)).length).toBe(12);
  await expect.poll(async () => (await domParts(page)).filter((part) => part.endsWith('|-'))).toEqual([]);
});
