/**
 * WP06 acceptance: axe clean (WCAG 2.2 AA tags) on `/` (the comparison table, PA-19) and `/about/` in 3 locales × 2
 * themes, plus `/` with Advanced (the board) and the Examples menu open, and the open dialogs.
 * Runs against `vite preview` with headersMiddleware (the strict CSP applies).
 */
import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Page } from '@playwright/test';
import { LOCALES, openAbout, openShell, THEMES, useTheme } from './shell-helpers.ts';

const TAGS = ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa'];

async function violations(page: Page): Promise<string[]> {
  const results = await new AxeBuilder({ page }).withTags(TAGS).analyze();
  return results.violations.map(
    (violation) => `${violation.id}: ${violation.nodes.map((node) => node.target.join(' ')).join(', ')}`,
  );
}

for (const theme of THEMES) {
  for (const locale of LOCALES) {
    test(`/ is axe clean in ${locale} (${theme})`, async ({ page }) => {
      await useTheme(page, theme);
      await openShell(page, locale);
      await expect(page.locator('html')).toHaveAttribute('data-theme', theme);
      expect(await violations(page)).toEqual([]);
    });

    test(`/about/ is axe clean in ${locale} (${theme})`, async ({ page }) => {
      await useTheme(page, theme);
      await openAbout(page, locale);
      expect(await violations(page)).toEqual([]);
    });
  }
}

for (const theme of THEMES) {
  test(`/ with Advanced open (the board) and the Examples menu open is axe clean (${theme})`, async ({ page }) => {
    await useTheme(page, theme);
    await openShell(page, 'en', { advanced: true });
    expect(await violations(page)).toEqual([]);
    await page.getByTestId('examples-button').click();
    await expect(page.getByTestId('examples-menu')).toBeVisible();
    expect(await violations(page)).toEqual([]);
  });

  test(`the picker and help dialogs are axe clean (${theme})`, async ({ page }) => {
    await useTheme(page, theme);
    await openShell(page, 'zh-TW', { advanced: true });
    await page.getByTestId('picker-button').click();
    await expect(page.getByRole('dialog')).toBeVisible();
    expect(await violations(page)).toEqual([]);
    await page.keyboard.press('Escape');
    await page.getByRole('button', { name: '鍵盤快捷鍵與說明' }).click();
    await expect(page.getByRole('dialog')).toBeVisible();
    expect(await violations(page)).toEqual([]);
  });
}

test('the theme and language menus are axe clean when open', async ({ page }) => {
  await useTheme(page, 'dark');
  await openShell(page, 'ja');
  await page.getByRole('button', { name: '表示言語' }).click();
  await expect(page.getByRole('radio', { name: 'English' })).toBeVisible();
  expect(await violations(page)).toEqual([]);
});
