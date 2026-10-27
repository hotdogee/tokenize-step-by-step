import { expect, test } from '@playwright/test';

// First functional spec for WP11 to build on: the shell renders, boot.js ran before first paint, the CSP holds.
test('shows the title and the default example with boot attributes and no CSP violations', async ({ page }) => {
  const violations: string[] = [];
  page.on('console', (message) => {
    if (message.type() === 'error' && message.text().includes('Content Security Policy'))
      violations.push(message.text());
  });
  await page.goto('/');
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('What is a token?');
  // The default example is the textarea's value, the checked item of the Examples menu and the table's header box
  // (PA-19); before hydration the static textarea's text node matches a text locator too, so each has its own locator.
  await expect(page.locator('#text-input')).toHaveValue('台灣台南');
  await expect(page.getByTestId('examples-button')).toBeVisible();
  await expect(page.locator('[data-testid="examples-menu"] [data-key="zh-tw-tainan"]')).toHaveAttribute(
    'aria-checked',
    'true',
  );
  await expect(page.getByTestId('compare-head')).toContainText('12 bytes');
  await expect(page.locator('html')).toHaveAttribute('lang', /^(en|ja|zh-TW)$/);
  await expect(page.locator('html')).toHaveAttribute('data-theme', /^(auto|light|dark)$/);
  expect(violations).toEqual([]);
});
