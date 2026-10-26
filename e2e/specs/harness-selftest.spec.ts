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

// The page-error guard across navigations: a document's errors raised while a navigation replaces it (WebKit reports
// its cancelled Worker and dynamic imports as uncaught) are kept apart, and the next document's errors still count.
test('the page-error guard keeps a replaced document’s errors apart and records the next document’s', async ({
  page,
}) => {
  const guards = await watchPage(page);
  // Two navigations back to back, the second while the first page still loads its Worker and lazy chunks.
  await page.goto('/?lang=en');
  await page.goto('/?lang=en&t=openai-cl100k_base');
  // A third whose document is held back: the old document is still alive and throws while it is being replaced. The
  // throw comes 1.5 s after goto() is called, past the guard's event flush (at most 1 s, page-guards.ts) that precedes
  // the navigation, and the document is held 3 s, so the error is raised mid-navigation even on a loaded machine.
  await page.route(
    (url) => url.searchParams.get('t') === 'xai-grok2',
    async (route) => {
      await new Promise((resolve) => setTimeout(resolve, 3_000));
      await route.continue();
    },
  );
  await page.evaluate(() => {
    setTimeout(() => {
      throw new Error('replaced document');
    }, 1_500);
  });
  await page.goto('/?lang=en&t=xai-grok2');
  expect(guards.teardownErrors()).toContain('Error: replaced document');
  await page.evaluate(() => {
    setTimeout(() => {
      throw new Error('current document');
    }, 0);
  });
  await expect.poll(() => guards.pageErrors()).toEqual(['Error: current document']);
});

// Filed by when the error was raised, not when its event arrives: an error the current document raised just before a
// navigation call (its event still on the wire, as a Firefox DOMContentLoaded error can be after `load` resolved the
// previous goto) is the current document's, not teardown.
test('the page-error guard files an error raised just before a navigation call under the document that raised it', async ({
  page,
}) => {
  const guards = await watchPage(page);
  await page.goto('/?lang=en');
  // The task is due before reload() is called and holds the main thread for 100 ms, so its error event is still on the
  // wire when the navigation helper is entered.
  await page.evaluate(() => {
    setTimeout(() => {
      const end = performance.now() + 100;
      while (performance.now() < end);
      throw new Error('before the reload');
    }, 0);
  });
  await page.reload();
  expect(guards.pageErrors()).toEqual(['Error: before the reload']);
  expect(guards.teardownErrors()).not.toContain('Error: before the reload');
});
