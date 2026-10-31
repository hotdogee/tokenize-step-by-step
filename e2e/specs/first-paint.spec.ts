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

test('text typed mid-line before the app runs keeps its caret: the next key lands there', async ({ page }) => {
  const modules = await holdModules(page);
  await page.goto('/', { waitUntil: 'commit' });
  await firstContentfulPaint(page);
  const textbox = page.locator('#text-input');
  await textbox.click();
  await textbox.press('Home');
  await textbox.pressSequentially('ab');
  await modules.release();
  await expect(page.locator('#app')).toHaveAttribute('data-boot', 'hydrated');
  await textbox.pressSequentially('c');
  await expect(textbox).toHaveValue('abc台灣台南');
});

test('Advanced opened before the app runs stays open: it never paints closed, the board loads, the URL follows', async ({
  page,
}) => {
  const logged: string[] = [];
  page.on('pageerror', (error) => logged.push(error.message));
  page.on('console', (message) => {
    if (message.type() === 'warning' || message.type() === 'error') logged.push(message.text());
  });
  const csp = await recordCsp(page);
  const modules = await holdModules(page);
  await page.goto('/?lang=en', { waitUntil: 'commit' });
  await firstContentfulPaint(page);
  const advanced = page.locator('details#advanced');
  const summary = page.getByTestId('advanced-summary');
  await summary.click();
  await expect(advanced).toHaveAttribute('open', '');
  const before = await summary.boundingBox();
  // Every frame from here on: hydration closes the element, and a frame painted in that state is the snap the visitor saw.
  await advanced.evaluate((details) => {
    const frames: boolean[] = [];
    (window as unknown as { __open: boolean[] }).__open = frames;
    const tick = (): void => {
      frames.push((details as HTMLDetailsElement).open);
      requestAnimationFrame(tick);
    };
    tick();
  });
  await modules.release();
  await expect(page.locator('#app')).toHaveAttribute('data-boot', 'hydrated');
  await expect(advanced).toHaveAttribute('open', '');
  await expect(page.getByTestId('board-grid')).toBeVisible();
  expect(await page.evaluate(() => (window as unknown as { __open: boolean[] }).__open)).not.toContain(false);
  expect(await summary.boundingBox()).toEqual(before); // the body grew below the summary; nothing moved it
  // The same URL as a click on the hydrated page: `t` and `s` while it is open, gone when it closes.
  await expect.poll(() => new URL(page.url()).searchParams.get('s')).toBe('6');
  expect(new URL(page.url()).searchParams.get('t')).toBe('openai-o200k_base');
  await summary.click();
  await expect(advanced).not.toHaveAttribute('open', '');
  await expect.poll(() => new URL(page.url()).searchParams.has('s')).toBe(false);
  expect(new URL(page.url()).searchParams.has('t')).toBe(false);
  expect(logged).toEqual([]);
  expect(await csp()).toEqual([]);
});

test('a row switched before the app runs stays switched: it loads, answers and persists', async ({ page }) => {
  const modules = await holdModules(page);
  await page.goto('/?lang=en', { waitUntil: 'commit' });
  await firstContentfulPaint(page);
  const select = page.getByTestId('row-select-openai');
  await select.selectOption('openai-cl100k_base');
  await modules.release();
  await expect(page.locator('#app')).toHaveAttribute('data-boot', 'hydrated');
  await expect(select).toHaveValue('openai-cl100k_base');
  const row = page.locator('[data-testid="compare"] [data-row="openai"]');
  await expect(row).toHaveAttribute('data-tokenizer', 'openai-cl100k_base');
  await expect(row.locator('.cmp-cap')).toContainText('5 tokens');
  await expect(rowSource(page)).toHaveAttribute('data-source', 'live', { timeout: LIVE_READY_TIMEOUT_MS });
  expect(await page.evaluate(() => localStorage.getItem('tsbs:rows'))).toBe('openai-cl100k_base');
  await expect.poll(() => new URL(page.url()).searchParams.get('r')).toBe('openai-cl100k_base');
});

test.describe('at 320 px', () => {
  test.use({ viewport: { width: 320, height: 700 } });

  test('rows scrolled sideways before the app runs keep the header box in step once it does', async ({ page }) => {
    const modules = await holdModules(page);
    await page.goto('/?lang=en', { waitUntil: 'commit' });
    await firstContentfulPaint(page);
    const lefts = (): Promise<number[]> =>
      page.evaluate(() =>
        ['.cmp-thead', '.cmp-tbody', '.cmp-sbar'].map((selector) =>
          Math.round(document.querySelector(selector)?.scrollLeft ?? -1),
        ),
      );
    await page.evaluate(() => {
      const rows = document.querySelector('.cmp-tbody');
      if (rows !== null) rows.scrollLeft = 60;
    });
    expect(await lefts()).toEqual([0, 60, 0]);
    await modules.release();
    await expect(page.locator('#app')).toHaveAttribute('data-boot', 'hydrated');
    await expect.poll(lefts).toEqual([60, 60, 60]);
  });
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

test.describe('in a desktop window with a classic page scrollbar', () => {
  // Playwright hides scrollbars (`--hide-scrollbars`), so the tests above never see a page scrollbar take room. A classic
  // one (Windows, Linux) makes the table's scrollers narrower than 100vw: the captions' cap (compare.css, `100cqw`) must
  // see that in the static paint already. The widths and locales where a viewport-based cap shifted on hydration.
  for (const [width, locale] of [
    [360, 'en'],
    [360, 'ja'],
    [375, 'zh-TW'],
    [390, 'ja'],
  ] as const)
    test(`the static first paint (${locale}, ${String(width)} px) has no layout shift at all when the app takes over`, async ({
      playwright,
      baseURL,
    }, testInfo) => {
      test.skip(testInfo.project.name !== 'chromium', 'one run: the test launches its own chromium, scrollbars shown');
      const browser = await playwright.chromium.launch({ ignoreDefaultArgs: ['--hide-scrollbars'] });
      try {
        const page = await browser.newPage({
          ...(baseURL === undefined ? {} : { baseURL }),
          viewport: { width, height: 780 },
        });
        await page.addInitScript(() => {
          const w = window as unknown as { __shifts: Array<{ value: number; input: boolean }> };
          w.__shifts = [];
          new PerformanceObserver((list) => {
            for (const entry of list.getEntries() as Array<
              PerformanceEntry & { value: number; hadRecentInput: boolean }
            >)
              w.__shifts.push({ value: entry.value, input: entry.hadRecentInput });
          }).observe({ type: 'layout-shift', buffered: true });
        });
        await page.goto(`/?lang=${locale}`);
        const scrollbar = await page.evaluate(() => innerWidth - document.documentElement.clientWidth);
        test.skip(scrollbar === 0, 'overlay scrollbars on this platform: no page scrollbar takes room');
        await expect(page.locator('#app')).toHaveAttribute('data-boot', 'hydrated');
        await expect(rowSource(page)).toHaveAttribute('data-source', 'live', { timeout: LIVE_READY_TIMEOUT_MS });
        await page.evaluate(() => new Promise((resolve) => setTimeout(resolve, 500)));
        expect(await page.evaluate(() => (window as unknown as { __shifts: unknown[] }).__shifts)).toEqual([]);
      } finally {
        await browser.close();
      }
    });
});
