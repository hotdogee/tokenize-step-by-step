/**
 * Visual baselines of the comparison table (06 §1 "Visual", PA-19): 2 fixtures × 2 themes × 3 viewports (360/768/1440) —
 * the default rows of 台灣台南, and the zh-TW paragraph scrolled 480 px sideways (the captions pinned left, the header box
 * in step) — `toHaveScreenshot` with `maxDiffPixelRatio` 0.002 (the `visual` project), chromium on Linux with
 * `fonts-noto-cjk`. The baseline rule is baseline-guard.ts; the page runs on the precomputed-examples client
 * (`?mock=1`), with the footer's build stamp masked.
 */
import { expect, test, type Page } from '@playwright/test';
import { chooseExample } from '../specs/board-helpers.ts';
import { rowSource, THEMES, useTheme } from '../specs/shell-helpers.ts';
import { guardBaseline } from './baseline-guard.ts';

const FIXTURES = [
  { name: 'compare-tainan', example: 'zh-tw-tainan', scroll: 0 },
  { name: 'compare-paragraph-scrolled', example: 'zh-tw-paragraph', scroll: 480 },
] as const;

const VIEWPORTS = [
  { width: 360, height: 780 },
  { width: 768, height: 1024 },
  { width: 1440, height: 900 },
] as const;

/** Opens `/` on the precomputed client with `example` in the table, scrolled `scroll` px sideways, fonts loaded. */
async function open(page: Page, example: string, scroll: number): Promise<void> {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.goto('/?lang=en&mock=1');
  await expect(rowSource(page)).toHaveAttribute('data-source', 'live');
  if (example !== 'zh-tw-tainan') await chooseExample(page, example);
  for (const lab of ['openai', 'anthropic', 'google', 'meta', 'xai'])
    await expect(page.locator(`[data-testid="compare"] [data-row="${lab}"]`)).toHaveAttribute('data-state', 'current');
  if (scroll > 0) {
    await page.locator('[data-testid="compare"] .cmp-tbody').evaluate((body, left) => {
      body.scrollLeft = left;
    }, scroll);
    await expect
      .poll(() => page.locator('[data-testid="compare"] .cmp-thead').evaluate((head) => head.scrollLeft))
      .toBeCloseTo(scroll, 0);
  }
  await page.evaluate(() => document.fonts.ready.then(() => undefined));
}

for (const fixture of FIXTURES) {
  for (const theme of THEMES) {
    for (const viewport of VIEWPORTS) {
      const name = `${fixture.name}-${theme}-${String(viewport.width)}`;
      test(`${name} matches its baseline`, async ({ page }, testInfo) => {
        guardBaseline(testInfo, name);
        await page.setViewportSize(viewport);
        await useTheme(page, theme);
        await open(page, fixture.example, fixture.scroll);
        await expect(page).toHaveScreenshot(`${name}.png`, {
          fullPage: true,
          mask: [page.locator('footer .build')],
        });
      });
    }
  }
}
