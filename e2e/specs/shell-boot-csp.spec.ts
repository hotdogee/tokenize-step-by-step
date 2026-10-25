/**
 * WP06 acceptance: boot.js sets `<html lang>` and `data-theme` before first paint, and the pages run with the strict CSP
 * with zero violations (vite preview + headersMiddleware here; e2e-headers repeats it on wrangler dev, 06 §4).
 */
import { expect, test, type Page } from '@playwright/test';
import { LIVE_READY_TIMEOUT_MS } from './shell-helpers.ts';

/** Records CSP violations and the <html> attributes at the moment <body> is created (before any paint). */
async function instrument(page: Page): Promise<{ consoleViolations: string[] }> {
  const consoleViolations: string[] = [];
  page.on('console', (message) => {
    if (message.text().includes('Content Security Policy')) consoleViolations.push(message.text());
  });
  await page.addInitScript(() => {
    const w = window as unknown as {
      __csp: string[];
      __atBody: { lang: string; theme: string | undefined } | null;
    };
    w.__csp = [];
    w.__atBody = null;
    document.addEventListener('securitypolicyviolation', (event) => {
      w.__csp.push(`${event.violatedDirective} ${event.blockedURI}`);
    });
    const observer = new MutationObserver(() => {
      // document.body is null until the parser reaches <body> (the DOM typings say otherwise).
      const body = document.body as HTMLElement | null;
      if (body !== null && w.__atBody === null) {
        w.__atBody = { lang: document.documentElement.lang, theme: document.documentElement.dataset['theme'] };
        observer.disconnect();
      }
    });
    observer.observe(document, { childList: true, subtree: true });
  });
  return { consoleViolations };
}

const read = (page: Page) =>
  page.evaluate(() => {
    const w = window as unknown as { __csp: string[]; __atBody: { lang: string; theme: string | undefined } | null };
    return { csp: w.__csp, atBody: w.__atBody };
  });

for (const path of ['/', '/about/', '/404.html']) {
  test(`${path} sets lang/data-theme before first paint and has zero CSP violations`, async ({ page }) => {
    const { consoleViolations } = await instrument(page);
    await page.addInitScript(() => {
      localStorage.setItem('tsbs:theme', 'dark');
    });
    const response = await page.goto(`${path}?lang=ja`);
    expect(response?.headers()['content-security-policy']).toContain("style-src 'self'");
    await expect(page.locator('h1')).toBeVisible();
    // Let the app settle: the default tokenizer loads after first paint (06 §3).
    if (path === '/')
      await expect(page.locator('[data-source="live"]')).toBeVisible({ timeout: LIVE_READY_TIMEOUT_MS });
    const { csp, atBody } = await read(page);
    expect(atBody).toEqual({ lang: 'ja', theme: 'dark' });
    expect(csp).toEqual([]);
    expect(consoleViolations).toEqual([]);
  });
}

test('the boot script is the first element of <head> and there is no inline script or style', async ({ page }) => {
  const response = await page.goto('/');
  const html = (await response?.text()) ?? '';
  expect(html).toMatch(/<head>\s*<script src="\/assets\/boot-[0-9a-f]{8}\.js"><\/script>/);
  expect(html).not.toMatch(/<script(?![^>]*\ssrc=)[^>]*>/);
  expect(html).not.toMatch(/<style[\s>]|\sstyle=/);
});

test('switching theme and language at runtime causes no CSP violation', async ({ page }) => {
  const { consoleViolations } = await instrument(page);
  await page.goto('/?lang=en');
  await expect(page.locator('[data-source="live"]')).toBeVisible({ timeout: LIVE_READY_TIMEOUT_MS });
  await page.getByRole('button', { name: 'Colour theme' }).click();
  await page.getByRole('radio', { name: 'Dark' }).check();
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
  await page.keyboard.press('Escape');
  await page.getByRole('button', { name: 'Interface language' }).click();
  await page.getByRole('radio', { name: '日本語' }).check();
  await expect(page.locator('html')).toHaveAttribute('lang', 'ja');
  await expect(page).toHaveTitle(/トークン化を一歩ずつ/);
  const { csp } = await read(page);
  expect(csp).toEqual([]);
  expect(consoleViolations).toEqual([]);
});
