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
  // The default example is the textarea's value and an example chip; before hydration the static textarea's text node
  // matches a text locator too, so each is asserted by its own locator.
  await expect(page.locator('#text-input')).toHaveValue('台灣台南');
  await expect(page.getByTestId('example-chips').getByText('台灣台南')).toBeVisible();
  await expect(page.locator('html')).toHaveAttribute('lang', /^(en|ja|zh-TW)$/);
  await expect(page.locator('html')).toHaveAttribute('data-theme', /^(auto|light|dark)$/);
  expect(violations).toEqual([]);
});
