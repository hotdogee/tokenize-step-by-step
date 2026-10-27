/**
 * PA-15 — the static first paint of `/`. index.html carries the server-rendered first state of the page per UI locale
 * (`<template id="fp-<locale>">`: PA-19's comparison table with its five precomputed default rows, Advanced closed);
 * the classic clone script after `#app` puts the visitor's into `#app` before anything paints, and the app — whose
 * module scripts the page no longer waits for — hydrates it once painted (apps/web/plugins/first-paint.ts,
 * src/app/first-paint-script.ts, src/app/main.ts).
 *
 * The module scripts are held with `page.route` where a test needs the page before the app runs.
 */
import { devices, expect, test, type Page, type Route } from '@playwright/test';
import { LIVE_READY_TIMEOUT_MS, rowSource } from './shell-helpers.ts';

/** Classic scripts the page runs before it paints (boot.js in <head>, the clone script after #app). */
const CLASSIC = /\/assets\/(?:boot|first-paint)-[0-9a-f]{8}\.js$/;

/** Holds every module script request (the app) until `release()`; the classic scripts pass. */
async function holdModules(page: Page): Promise<{ held: () => number; release: () => Promise<void> }> {
  let released = false;
  const waiting: Route[] = [];
  await page.route(/\/assets\/[^/?]+\.js(?:\?.*)?$/, async (route) => {
    if (released || CLASSIC.test(route.request().url())) await route.continue();
    else waiting.push(route);
  });
  return {
    held: () => waiting.length,
    release: async () => {
      released = true;
      for (const route of waiting.splice(0)) await route.continue();
    },
  };
}

/** Records CSP violations from the first script on. */
async function recordCsp(page: Page): Promise<() => Promise<string[]>> {
  await page.addInitScript(() => {
    const w = window as unknown as { __csp: string[] };
    w.__csp = [];
    document.addEventListener('securitypolicyviolation', (event) => {
      w.__csp.push(`${event.violatedDirective} ${event.blockedURI}`);
    });
  });
  return () => page.evaluate(() => (window as unknown as { __csp: string[] }).__csp);
}

/** Resolves once the browser has reported the first contentful paint. */
async function firstContentfulPaint(page: Page): Promise<number> {
  const handle = await page.waitForFunction(() => {
    const [entry] = performance.getEntriesByName('first-contentful-paint');
    return entry?.startTime;
  });
  return (await handle.jsonValue()) ?? Number.NaN;
}

/** What the page looks like now: the static first paint's state and the module scripts that have arrived. */
function snapshot(page: Page) {
  return page.evaluate(() => {
    const app = document.getElementById('app');
    return {
      lang: document.documentElement.lang,
      painted: (app?.childElementCount ?? 0) > 0,
      boot: app?.dataset['boot'] ?? null,
      label: app?.querySelector('label[for="text-input"]')?.textContent ?? null,
      text: app?.textContent ?? '',
      modulesArrived: performance
        .getEntriesByType('resource')
        .filter((entry) => /\/assets\/[^/]+\.js$/.test(entry.name))
        .filter((entry) => !/\/assets\/(?:boot|first-paint)-/.test(entry.name)).length,
    };
  });
}

test('paints the precomputed default rows before any module script has arrived (chromium, CPU ×4)', async ({
  page,
  browserName,
}) => {
  test.skip(browserName !== 'chromium', 'CPU throttling is a Chrome DevTools Protocol feature');
  const cdp = await page.context().newCDPSession(page);
  await cdp.send('Emulation.setCPUThrottlingRate', { rate: 4 });
  const csp = await recordCsp(page);
  const modules = await holdModules(page);
  await page.goto('/', { waitUntil: 'commit' });
  const fcp = await firstContentfulPaint(page);
  const before = await snapshot(page);
  expect(fcp).toBeGreaterThan(0);
  expect(modules.held()).toBeGreaterThan(0);
  expect(before.modulesArrived).toBe(0);
  expect(before.painted).toBe(true);
  expect(before.boot).toBeNull();
  // The table is there before the modules: the OpenAI row's 4 tokens, precomputed (PA-19; no board in the first paint).
  await expect(page.getByTestId('compare')).toBeVisible();
  await expect(page.getByTestId('board-grid')).toHaveCount(0);
  await expect(page.locator('[data-row="openai"] .cmp-cap')).toContainText('4 tokens');
  await expect(rowSource(page)).toHaveAttribute('data-source', 'precomputed');
  await expect(page.getByTestId('compare-head')).toContainText('12');
  await modules.release();
  await expect(page.locator('#app')).toHaveAttribute('data-boot', 'hydrated');
  // The load trigger and the precomputed → live answer work on the hydrated page.
  await expect(rowSource(page)).toHaveAttribute('data-source', 'live', { timeout: LIVE_READY_TIMEOUT_MS });
  await cdp.send('Emulation.setCPUThrottlingRate', { rate: 1 });
  expect(await csp()).toEqual([]);
});

for (const [locale, label, english] of [
  ['zh-TW', '要分詞的文字', 'Text to tokenize'],
  ['ja', 'トークン化するテキスト', 'Text to tokenize'],
] as const) {
  test.describe(`a ${locale} visitor`, () => {
    test.use({ locale });

    test(`sees ${locale} at first paint, with no English flash`, async ({ page }) => {
      const modules = await holdModules(page);
      await page.goto('/', { waitUntil: 'commit' });
      await firstContentfulPaint(page);
      const before = await snapshot(page);
      expect(before.lang).toBe(locale);
      expect(before.label).toBe(label);
      expect(before.text).not.toContain(english);
      expect(before.boot).toBeNull();
      await modules.release();
      await expect(page.locator('#app')).toHaveAttribute('data-boot', 'hydrated');
      expect((await snapshot(page)).label).toBe(label);
    });
  });
}

test('hydration adopts every node of the static first paint, with zero CSP violations', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  const csp = await recordCsp(page);
  const modules = await holdModules(page);
  await page.goto('/', { waitUntil: 'commit' });
  await firstContentfulPaint(page);
  const count = await page.evaluate(() => {
    const nodes = [...document.querySelectorAll('#app *')];
    (window as unknown as { __static: Element[] }).__static = nodes;
    return nodes.length;
  });
  expect(count).toBeGreaterThan(200);
  await modules.release();
  await expect(page.locator('#app')).toHaveAttribute('data-boot', 'hydrated');
  // Let the board measure its real K (a frame after hydration) and the effects settle.
  await page.evaluate(() => new Promise((resolve) => setTimeout(resolve, 300)));
  const lost = await page.evaluate(() => {
    const app = document.getElementById('app');
    return (window as unknown as { __static: Element[] }).__static
      .filter((node) => !node.isConnected || app?.contains(node) !== true)
      .map((node) => node.outerHTML.slice(0, 120));
  });
  expect(lost).toEqual([]);
  expect(errors).toEqual([]);
  expect(await csp()).toEqual([]);
});

test('text typed into the static text box before the app runs is kept', async ({ page }) => {
  const modules = await holdModules(page);
  await page.goto('/', { waitUntil: 'commit' });
  await firstContentfulPaint(page);
  const textbox = page.locator('#text-input');
  await textbox.click();
  await textbox.press('End');
  await textbox.pressSequentially('!');
  await modules.release();
  await expect(page.locator('#app')).toHaveAttribute('data-boot', 'hydrated');
  await expect(textbox).toHaveValue('台灣台南!');
  await expect(page.getByTestId('compare-head')).toContainText('13');
});

test('a page that starts in another state mounts from scratch', async ({ page }) => {
  await page.goto('/?b=dec');
  await expect(page.locator('#app')).toHaveAttribute('data-boot', 'mounted');
  await page.evaluate(() => {
    localStorage.setItem('tsbs:rows', 'xai-grok1');
  });
  await page.goto('/');
  await expect(page.locator('#app')).toHaveAttribute('data-boot', 'mounted');
  await page.evaluate(() => {
    localStorage.removeItem('tsbs:rows');
  });
  // A link with t or s opens Advanced (PA-19): no static paint holds the board, so it mounts.
  await page.goto('/?t=openai-o200k_base&s=6&lang=en');
  await expect(page.locator('#app')).toHaveAttribute('data-boot', 'mounted');
  await expect(page.locator('details#advanced')).toHaveAttribute('open', '');
  // The URL the app writes back for the default state (every parameter at its default) still gets the static paint.
  await page.goto('/?lang=en&tl=auto&b=hex');
  await expect(page.locator('#app')).toHaveAttribute('data-boot', 'hydrated');
});

test.describe('on the Lighthouse mobile viewport (412 × 823, CPU ×4)', () => {
  const { userAgent, isMobile, hasTouch } = devices['Pixel 5'];
  test.use({ userAgent, isMobile, hasTouch, viewport: { width: 412, height: 823 }, deviceScaleFactor: 1.75 });

  test('the static first paint shifts nothing when the app takes over (CLS ≤ 0.02)', async ({ page, browserName }) => {
    test.skip(browserName !== 'chromium', 'CPU throttling and layout-shift entries are Chromium features');
    const cdp = await page.context().newCDPSession(page);
    await cdp.send('Emulation.setCPUThrottlingRate', { rate: 4 });
    await page.addInitScript(() => {
      const w = window as unknown as { __cls: number };
      w.__cls = 0;
      new PerformanceObserver((list) => {
        for (const entry of list.getEntries() as Array<PerformanceEntry & { value: number; hadRecentInput: boolean }>)
          if (!entry.hadRecentInput) w.__cls += entry.value;
      }).observe({ type: 'layout-shift', buffered: true });
    });
    await page.goto('/');
    await expect(page.locator('#app')).toHaveAttribute('data-boot', 'hydrated');
    await expect(rowSource(page)).toHaveAttribute('data-source', 'live', { timeout: LIVE_READY_TIMEOUT_MS });
    await page.evaluate(() => new Promise((resolve) => setTimeout(resolve, 500)));
    await cdp.send('Emulation.setCPUThrottlingRate', { rate: 1 });
    const cls = await page.evaluate(() => (window as unknown as { __cls: number }).__cls);
    expect(cls).toBeLessThanOrEqual(0.02);
  });
});

test.describe('at 360 px without touch emulation (a shift then counts as CLS)', () => {
  test.use({ viewport: { width: 360, height: 780 }, isMobile: false, hasTouch: false });

  for (const locale of ['en', 'ja'] as const)
    test(`the static first paint (${locale}) has no layout shift at all when the app takes over`, async ({
      page,
      browserName,
    }) => {
      test.skip(browserName !== 'chromium', 'layout-shift entries are a Chromium feature');
      await page.addInitScript(() => {
        const w = window as unknown as { __shifts: Array<{ value: number; input: boolean }> };
        w.__shifts = [];
        new PerformanceObserver((list) => {
          for (const entry of list.getEntries() as Array<PerformanceEntry & { value: number; hadRecentInput: boolean }>)
            w.__shifts.push({ value: entry.value, input: entry.hadRecentInput }); // input or not: none is expected
        }).observe({ type: 'layout-shift', buffered: true });
      });
      await page.goto(`/?lang=${locale}`);
      await expect(page.locator('#app')).toHaveAttribute('data-boot', 'hydrated');
      await expect(rowSource(page)).toHaveAttribute('data-source', 'live', { timeout: LIVE_READY_TIMEOUT_MS });
      // 12 bytes of 36 px do not fit 360 px: the scroll hint shows, on the line the static paint held for it.
      await expect(page.getByTestId('compare-hint')).toBeVisible();
      await page.evaluate(() => new Promise((resolve) => setTimeout(resolve, 500)));
      expect(await page.evaluate(() => (window as unknown as { __shifts: unknown[] }).__shifts)).toEqual([]);
    });
});
