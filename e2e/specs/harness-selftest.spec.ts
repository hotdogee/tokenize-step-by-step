import { expect, test } from '@playwright/test';
import { scanAxe } from '../support/axe.ts';
import { EXPECTED_CSP } from '../support/expected.ts';
import { watchPage } from '../support/page-guards.ts';

// The guards must not be vacuous: a page that breaks the strict CSP and WCAG is reported by both (served through routing
// on the preview origin, under the production CSP).
const BROKEN = `<!doctype html>
<html>
  <head><title>broken</title><style>p { color: red }</style></head>
  <body><p style="color: blue">inline</p><img src="/favicon.svg"><script>document.title = 'ran';</script></body>
</html>
`;

test('the CSP and axe guards report violations on a deliberately broken page', async ({ page }) => {
  await page.route('**/__selftest/', (route) =>
    route.fulfill({
      status: 200,
      headers: { 'content-type': 'text/html; charset=utf-8', 'content-security-policy': EXPECTED_CSP },
      body: BROKEN,
    }),
  );
  const guards = await watchPage(page);
  await page.goto('/__selftest/');
  await page.waitForLoadState('load');
  await expect(page).toHaveTitle('broken');
  const violations = await guards.cspViolations();
  expect(violations.some((violation) => violation.startsWith('style-src'))).toBe(true);
  expect(violations.some((violation) => violation.startsWith('script-src'))).toBe(true);
  const { findings } = await scanAxe(page);
  expect(findings.map((finding) => finding.id)).toEqual(expect.arrayContaining(['html-has-lang', 'image-alt']));
});
