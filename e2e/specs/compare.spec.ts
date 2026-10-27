/**
 * PA-19 — the comparison table, the default view of `/`: one row per lab on its newest local tokenizer, with the
 * counts of 台灣台南 the oracle gives (o200k 4, Claude 1/2 legacy 5, Gemma 4 3, Llama 4 / Muse 3, Grok-2 5; cl100k 5
 * once the OpenAI row is switched); a row's select loads the other tokenizer and writes `r=`; the captions stay at the
 * left edge while the rows scroll sideways; on a short viewport the header box stays under the sticky app header and
 * the scrollbar at the bottom of the viewport while the page scrolls; the Advanced disclosure opens from a link with
 * `s=` and from the `5` key; 320 px reflow (the table and, with Advanced open, the board are the only exempt regions);
 * axe on the long table in three locales × two themes; a focused chip is never under the header or the pinned box
 * (WCAG 2.4.11); typing at 8 characters a second never dims a live row.
 */
import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Page } from '@playwright/test';
import { chooseExample } from './board-helpers.ts';
import { LOCALES, LIVE_READY_TIMEOUT_MS, openShell, rowSource, THEMES, useTheme } from './shell-helpers.ts';

const table = (page: Page) => page.getByTestId('compare');
const row = (page: Page, lab: string) => page.locator(`[data-testid="compare"] [data-row="${lab}"]`);
const chips = (page: Page, lab: string) => row(page, lab).locator('[role="gridcell"][data-index]');
const params = (page: Page): URLSearchParams => new URL(page.url()).searchParams;
const LABS = ['openai', 'anthropic', 'google', 'meta', 'xai'] as const;

interface Rect {
  readonly top: number;
  readonly bottom: number;
  readonly left: number;
  readonly right: number;
}

/** Viewport rectangles of the elements `selectors` name (null when absent), in one round trip. */
function rects<K extends string>(page: Page, selectors: Record<K, string>): Promise<Record<K, Rect | null>> {
  const named: Record<string, string> = selectors;
  return page.evaluate((named: Record<string, string>) => {
    const out: Record<string, Rect | null> = {};
    for (const [key, selector] of Object.entries(named)) {
      const element = selector === ':focus' ? document.activeElement : document.querySelector(selector);
      if (element === null || element === document.body) out[key] = null;
      else {
        const { top, bottom, left, right } = element.getBoundingClientRect();
        out[key] = { top, bottom, left, right };
      }
    }
    return out;
  }, named);
}

test('the default rows of 台灣台南 show the oracle counts, and a row switch loads the other tokenizer', async ({
  page,
}) => {
  await openShell(page, 'en');
  for (const [lab, tokenizer, tokens] of [
    ['openai', 'openai-o200k_base', 4],
    ['anthropic', 'anthropic-claude-legacy', 5],
    ['google', 'google-gemma4', 3],
    ['meta', 'meta-llama4-muse', 3],
    ['xai', 'xai-grok2', 5],
  ] as const) {
    await expect(row(page, lab)).toHaveAttribute('data-tokenizer', tokenizer);
    await expect(row(page, lab).locator('.cmp-cap')).toContainText(`${String(tokens)} tokens`);
    await expect(chips(page, lab)).toHaveCount(tokens);
  }
  // The caption's short form; the long one for assistive tech.
  await expect(row(page, 'anthropic').getByTestId('row-partial').locator('[aria-hidden="true"]').nth(1)).toHaveText(
    '2 partial',
  );
  await expect(row(page, 'anthropic').getByTestId('row-partial').locator('.visually-hidden')).toHaveText(
    '2 partial-character tokens',
  );
  await expect(row(page, 'anthropic').getByTestId('row-select-anthropic').locator('option').first()).toHaveText(
    'Claude 1/2 legacy',
  );
  await expect(row(page, 'anthropic').locator('[data-fidelity="legacy"]')).toBeVisible();
  await expect(page.getByText('Powered by xAI')).toBeVisible();

  const requests: string[] = [];
  page.on('request', (request) => requests.push(new URL(request.url()).pathname));
  await page.getByTestId('row-select-openai').selectOption('openai-cl100k_base');
  await expect(row(page, 'openai')).toHaveAttribute('data-tokenizer', 'openai-cl100k_base');
  await expect(row(page, 'openai').locator('.cmp-cap')).toContainText('5 tokens');
  await expect(rowSource(page)).toHaveAttribute('data-source', 'live', { timeout: LIVE_READY_TIMEOUT_MS });
  expect(requests.some((path) => path.startsWith('/tok/openai-cl100k_base/'))).toBe(true);
  await expect.poll(() => params(page).get('r')).toBe('openai-cl100k_base');
  expect(await page.evaluate(() => localStorage.getItem('tsbs:rows'))).toBe('openai-cl100k_base');

  // The Anthropic row's API mode: the prompt and its Live check button, no chips.
  await page.getByTestId('row-select-anthropic').selectOption('anthropic-api');
  await expect(row(page, 'anthropic')).toContainText('Current Claude models count tokens through the API.');
  await expect(chips(page, 'anthropic')).toHaveCount(0);
  await row(page, 'anthropic').getByTestId('row-live-check').click();
  await expect(page.getByTestId('live-check-toggle')).toHaveAttribute('aria-expanded', 'true');
  await expect.poll(() => params(page).get('r')).toBe('openai-cl100k_base,anthropic-api');
});

test('typing at 8 characters a second never dims a live row: each answer arrives inside the debounce', async ({
  page,
}) => {
  await openShell(page, 'en');
  await page.locator('#text-input').fill('Hello world');
  for (const lab of LABS)
    await expect(rowSource(page, lab)).toHaveAttribute('data-source', 'live', { timeout: LIVE_READY_TIMEOUT_MS });
  // The lowest opacity any row shows, sampled every frame while typing.
  await page.evaluate(() => {
    const probe = window as unknown as { tsbsMinOpacity: number; tsbsStop: boolean };
    probe.tsbsMinOpacity = 1;
    probe.tsbsStop = false;
    const sample = (): void => {
      for (const element of document.querySelectorAll('#compare .cmp-row'))
        probe.tsbsMinOpacity = Math.min(probe.tsbsMinOpacity, Number(getComputedStyle(element).opacity));
      if (!probe.tsbsStop) requestAnimationFrame(sample);
    };
    requestAnimationFrame(sample);
  });
  await page.locator('#text-input').press('End');
  await page.keyboard.type(' and more', { delay: 125 });
  for (const lab of LABS) await expect(row(page, lab)).toHaveAttribute('data-state', 'current');
  const lowest = await page.evaluate(() => {
    const probe = window as unknown as { tsbsMinOpacity: number; tsbsStop: boolean };
    probe.tsbsStop = true;
    return probe.tsbsMinOpacity;
  });
  expect(lowest).toBe(1);
});

test('the captions stay at the left edge while the rows scroll sideways, the header box in step', async ({ page }) => {
  await openShell(page, 'en');
  await chooseExample(page, 'zh-tw-paragraph');
  await table(page)
    .locator('.cmp-tbody')
    .evaluate((body) => {
      body.scrollLeft = 480;
    });
  await expect
    .poll(() =>
      table(page)
        .locator('.cmp-thead')
        .evaluate((head) => head.scrollLeft),
    )
    .toBeCloseTo(480, 0);
  const left = await table(page).evaluate((section) => section.getBoundingClientRect().left);
  const width = page.viewportSize()?.width ?? 0;
  for (const lab of ['openai', 'anthropic', 'google', 'meta', 'xai']) {
    const caption = await row(page, lab).locator('.cmp-cap').boundingBox();
    expect(caption?.x, lab).toBeCloseTo(left, 0);
    // The select stays within the viewport's width (the rows below the fold are off screen vertically, not sideways).
    const select = await row(page, lab).locator('select').boundingBox();
    expect(select?.x ?? -1, lab).toBeGreaterThanOrEqual(0);
    expect((select?.x ?? 0) + (select?.width ?? Number.POSITIVE_INFINITY), lab).toBeLessThanOrEqual(width);
  }
  await expect(page.getByTestId('compare-hint')).toHaveText('·scroll sideways for the rest of the text');
  await expect(page.getByTestId('compare-hint')).toBeVisible();
});

test.describe('on a 560 px tall viewport', () => {
  test.use({ viewport: { width: 1280, height: 560 } });

  test('the header box pins under the app header and the scrollbar to the bottom while the page scrolls', async ({
    page,
  }) => {
    await openShell(page, 'en');
    await chooseExample(page, 'zh-tw-paragraph');
    const before = await rects(page, { header: 'header', head: '.cmp-thead', table: '#compare' });
    expect(before.head?.top).toBeGreaterThan(100); // in the flow under the input panel
    // 10 px past the point where the box meets the app header: pinned, with the rest of the table still below the fold.
    const pinAt = (before.head?.top ?? 0) - (before.header?.bottom ?? 0) + 10;
    await page.evaluate((y) => {
      window.scrollTo(0, y);
    }, pinAt);
    await expect(table(page).locator('.cmp-thead')).toHaveClass(/pinned/);
    const pinned = await rects(page, { header: 'header', head: '.cmp-thead', bar: '.cmp-sbar', table: '#compare' });
    expect(pinned.header?.top).toBeCloseTo(0, 0);
    expect(pinned.head?.top).toBeCloseTo(pinned.header?.bottom ?? -1, 0);
    expect(pinned.bar?.bottom).toBeCloseTo(560, 0);
    expect(pinned.table?.top ?? 0).toBeLessThan(pinned.header?.bottom ?? 0); // the table has scrolled under them
    // Past the table's end the box and the bar leave with it.
    await page.evaluate(() => {
      window.scrollTo(0, document.documentElement.scrollHeight);
    });
    const end = await rects(page, { header: 'header', head: '.cmp-thead', bar: '.cmp-sbar', table: '#compare' });
    expect(end.bar?.bottom).toBeCloseTo(end.table?.bottom ?? -1, 0);
    expect(end.header?.top).toBeCloseTo(0, 0);
  });

  test('a focused chip is never under the app header or the pinned header box (WCAG 2.4.11)', async ({ page }) => {
    await openShell(page, 'en');
    await chooseExample(page, 'zh-tw-paragraph');
    await page.evaluate(() => {
      window.scrollTo(0, document.documentElement.scrollHeight);
    });
    await table(page).locator('[role="gridcell"][tabindex="0"]').focus();
    for (const key of ['ArrowDown', 'ArrowDown', 'ArrowDown', 'ArrowDown', 'PageUp', 'End', 'Home', 'PageDown']) {
      await page.keyboard.press(key);
      const { cell, header, head, bar } = await rects(page, {
        cell: ':focus',
        header: 'header',
        head: '.cmp-thead',
        bar: '.cmp-sbar',
      });
      expect(cell, key).not.toBeNull();
      expect(cell?.top ?? 0, `${key}: below the app header`).toBeGreaterThanOrEqual((header?.bottom ?? 0) - 0.5);
      expect(cell?.top ?? 0, `${key}: below the header box`).toBeGreaterThanOrEqual((head?.bottom ?? 0) - 0.5);
      expect(cell?.bottom ?? 0, `${key}: above the scrollbar`).toBeLessThanOrEqual((bar?.top ?? 560) + 0.5);
      expect(cell?.right ?? 0, `${key}: in the viewport`).toBeLessThanOrEqual(1280);
      expect(cell?.left ?? -1, `${key}: in the viewport`).toBeGreaterThanOrEqual(0);
    }
  });
});

test('Advanced opens from a link with s= and from the 5 key', async ({ page }) => {
  await page.goto('/?lang=en&s=5.2');
  await expect(page.locator('details#advanced')).toHaveAttribute('open', '');
  await expect(page.getByTestId('board-grid')).toHaveAttribute('data-stage', '5');
  await openShell(page, 'en');
  await expect(page.locator('details#advanced')).not.toHaveAttribute('open', '');
  await page.locator('body').press('Digit5');
  await expect(page.locator('details#advanced')).toHaveAttribute('open', '');
  await expect(page.getByTestId('board-grid')).toHaveAttribute('data-stage', '5');
  await expect.poll(() => params(page).get('s')).toMatch(/^5\.\d+$/);
});

test('Enter on a chip opens Advanced on that row’s tokenizer with the board’s token cell at the same byte focused', async ({
  page,
}) => {
  await openShell(page, 'en');
  await chips(page, 'openai').first().focus();
  await page.keyboard.press('ArrowRight'); // 灣, bytes 3–5
  await page.keyboard.press('ArrowDown'); // Claude 1/2 legacy: E7 81, bytes 3–4
  await expect(page.locator(':focus')).toHaveAttribute('data-lab', 'anthropic');
  await page.keyboard.press('Enter');
  await expect(page.locator('details#advanced')).toHaveAttribute('open', '');
  await expect(page.getByTestId('board-grid')).toHaveAttribute('data-tokenizer', 'anthropic-claude-legacy', {
    timeout: LIVE_READY_TIMEOUT_MS,
  });
  await expect(page.locator(':focus')).toHaveAttribute('data-tier', 'token', { timeout: LIVE_READY_TIMEOUT_MS });
  await expect(page.locator(':focus')).toHaveAttribute('data-index', '1');
  await page.keyboard.press('Escape');
  await expect(page.locator('#text-input')).toBeFocused();
});

test.describe('320 px reflow (WCAG 1.4.10)', () => {
  test.use({ viewport: { width: 320, height: 640 } });

  test('the page fits 320 px; the table scrolls inside itself, the board joins it in Advanced', async ({ page }) => {
    await openShell(page, 'en');
    await chooseExample(page, 'zh-tw-paragraph');
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(320);
    await expect(page.locator('[data-reflow-exempt]')).toHaveCount(1);
    await page.getByTestId('advanced-summary').click();
    await expect(page.getByTestId('board-grid')).toBeVisible();
    await expect(page.locator('[data-reflow-exempt]')).toHaveCount(2);
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(320);
  });
});

for (const theme of THEMES)
  for (const locale of LOCALES)
    test(`the long table is axe clean in ${locale} (${theme})`, async ({ page }) => {
      await useTheme(page, theme);
      await openShell(page, locale);
      await chooseExample(page, 'zh-tw-paragraph');
      const results = await new AxeBuilder({ page })
        .include('#compare')
        .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa'])
        .analyze();
      expect(results.violations.map((v) => `${v.id}: ${v.nodes.map((n) => n.target.join(' ')).join(', ')}`)).toEqual(
        [],
      );
    });
