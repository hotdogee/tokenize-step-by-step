import { expect, test } from '@playwright/test';
import { expectNoAxeViolations } from '../support/axe.ts';
import { LANG_PATTERN, PAGES, THEME_PATTERN } from '../support/expected.ts';
import { watchPage } from '../support/page-guards.ts';

// Smoke for both HTML entries against `vite preview` (+ headersMiddleware, so the strict CSP is live): title, `lang`,
// boot attributes before DOMContentLoaded, zero CSP violations, zero axe (WCAG 2.2 AA) violations.
for (const { path, title } of PAGES) {
  test(`${path} renders with boot attributes, no CSP violations and no axe violations`, async ({ page }, testInfo) => {
    const guards = await watchPage(page);
    const response = await page.goto(path);
    expect(response?.status()).toBe(200);
    await expect(page).toHaveTitle(title);
    await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
    await expect(page.locator('html')).toHaveAttribute('lang', LANG_PATTERN);

    const boot = await guards.bootSnapshot();
    expect(boot?.lang, 'lang at DOMContentLoaded').toMatch(LANG_PATTERN);
    expect(boot?.theme, 'data-theme at DOMContentLoaded (set by boot.js)').toMatch(THEME_PATTERN);

    await page.waitForLoadState('load');
    expect(await guards.cspViolations()).toEqual([]);
    await expectNoAxeViolations(page, testInfo, path === '/' ? 'home' : path.replaceAll('/', ''));
  });
}
