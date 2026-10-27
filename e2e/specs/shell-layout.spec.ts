/**
 * WP06 acceptance, as PA-19 amends it: zh-TW / ja copy has no horizontal overflow at 360 px (page, the notices strip with
 * the union of the tokenizers on screen, help and picker dialogs, About), the page chrome reflows at 320 px (the
 * comparison table, and the board while Advanced is open, claim the 1.4.10 exemption with `data-reflow-exempt`), and in
 * zh-TW a UI label and a glyph cell resolve to the same TC font family (05 §10).
 */
import { expect, test, type Locator, type Page } from '@playwright/test';
import { openAbout, openAdvanced, openShell, pickTokenizer } from './shell-helpers.ts';

const pageOverflow = (page: Page) =>
  page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);

/** Horizontal overflow of an element: content wider than its box, or the box past the viewport's right edge. */
const elementOverflow = (locator: Locator) =>
  locator.evaluate((element) => {
    const rect = element.getBoundingClientRect();
    return Math.max(element.scrollWidth - element.clientWidth, Math.ceil(rect.right - window.innerWidth), 0);
  });

for (const locale of ['zh-TW', 'ja'] as const) {
  test.describe(`${locale} at 360 px`, () => {
    test.use({ viewport: { width: 360, height: 780 } });

    test('the page, the notices strip and the help dialog have no horizontal overflow', async ({ page }) => {
      await openShell(page, locale);
      expect(await pageOverflow(page)).toBe(0);
      const notices = page.getByTestId('notices');
      await expect(notices).toContainText('Powered by xAI');
      expect(await elementOverflow(notices)).toBe(0);
      // The union grows with Gemma 1/2 and Llama 3 switched in (their legal notices).
      await page.getByTestId('row-select-google').selectOption('google-gemma2');
      await page.getByTestId('row-select-meta').selectOption('meta-llama3');
      await expect(notices).toContainText('Built with Meta Llama 3');
      expect(await elementOverflow(notices)).toBe(0);
      expect(await pageOverflow(page)).toBe(0);
      await page.keyboard.press('Shift+Slash');
      const dialog = page.getByRole('dialog');
      await expect(dialog).toBeVisible();
      expect(await elementOverflow(dialog)).toBe(0);
    });

    test('the picker dialog has no horizontal overflow', async ({ page }) => {
      await openShell(page, locale);
      await openAdvanced(page);
      await page.getByTestId('picker-button').click();
      const dialog = page.getByRole('dialog');
      await expect(dialog).toBeVisible();
      expect(await elementOverflow(dialog)).toBe(0);
    });

    test('About has no horizontal overflow', async ({ page }) => {
      await openAbout(page, locale);
      expect(await pageOverflow(page)).toBe(0);
    });
  });
}

test.describe('320 px reflow (WCAG 1.4.10)', () => {
  test.use({ viewport: { width: 320, height: 568 } });

  for (const locale of ['en', 'zh-TW', 'ja'] as const) {
    test(`page chrome fits 320 px in ${locale}; the table (and the board in Advanced) are the exempt regions`, async ({
      page,
    }) => {
      await openShell(page, locale);
      expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(320);
      await expect(page.locator('[data-reflow-exempt]')).toHaveCount(1);
      await pickTokenizer(page, 'Llama 3');
      await expect(page.locator('[data-reflow-exempt]')).toHaveCount(2);
      expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(320);
    });
  }

  test('About fits 320 px', async ({ page }) => {
    await openAbout(page, 'en');
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(320);
  });
});

test('in zh-TW a UI label and a glyph cell resolve to the same TC font family (05 §10)', async ({ page }) => {
  await openShell(page, 'zh-TW');
  const label = await page
    .locator('label[for="text-input"]')
    .evaluate((element) => getComputedStyle(element).fontFamily);
  const glyph = await page
    .locator('#cmp-r-char [role="columnheader"][lang="zh-Hant-TW"]')
    .first()
    .evaluate((element) => getComputedStyle(element).fontFamily);
  expect(label).toBe(glyph);
  expect(label).toMatch(/^"?PingFang TC"?, "?Noto Sans TC"?/);
});
