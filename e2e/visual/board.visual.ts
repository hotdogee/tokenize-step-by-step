/**
 * Visual baselines (06 §1 "Visual"): the board — inside the Advanced disclosure since PA-19 — in 4 fixtures × 2 themes ×
 * 3 viewports (360/768/1440), `toHaveScreenshot` with `maxDiffPixelRatio` 0.002 (the `visual` project in `projects.ts`),
 * chromium on Linux with `fonts-noto-cjk`; compare.visual.ts holds the comparison table's. The baseline rule (Linux
 * renders from the `visual-baselines` workflow, skip before the first ones, fail on a missing one) is baseline-guard.ts.
 *
 * The page runs on the precomputed-examples client (`?mock=1`, docs/dev.md), so no Worker timing or vocabulary download
 * can change a pixel; the footer's build stamp (sha + date) is masked.
 */
import { expect, test, type Page } from '@playwright/test';
import { chooseExample } from '../specs/board-helpers.ts';
import { boardSource, openAdvanced, pickTokenizer, THEMES, useTheme } from '../specs/shell-helpers.ts';
import { guardBaseline } from './baseline-guard.ts';

/** The rendering cases of 06 §2 item 2: whole, partial, zero-width marker and byte fallback. */
const FIXTURES = [
  { name: 'tainan-o200k', tokenizer: 'o200k_base', example: 'zh-tw-tainan' },
  { name: 'tainan-cl100k', tokenizer: 'cl100k_base', example: 'zh-tw-tainan' },
  { name: 'tainan-grok1', tokenizer: 'Grok-1', example: 'zh-tw-tainan' },
  { name: 'biang-gemma4', tokenizer: 'Gemma 4', example: 'cjk-ext-g-biang' },
] as const;

/** Phone, tablet (anchored inspector) and desktop (side rail) widths. */
const VIEWPORTS = [
  { width: 360, height: 780 },
  { width: 768, height: 1024 },
  { width: 1440, height: 900 },
] as const;

/**
 * Opens `/` on the precomputed client, opens Advanced (the board), selects the tokenizer and the example, and waits for
 * fonts and a settled board.
 */
async function open(page: Page, tokenizer: string, example: string): Promise<void> {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.goto('/?lang=en&mock=1');
  await openAdvanced(page);
  await expect(boardSource(page)).toHaveAttribute('data-source', 'live');
  if (tokenizer !== 'o200k_base') await pickTokenizer(page, tokenizer);
  await chooseExample(page, example);
  await expect(page.getByTestId('status')).toContainText('ready');
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
        await open(page, fixture.tokenizer, fixture.example);
        await expect(page).toHaveScreenshot(`${name}.png`, {
          fullPage: true,
          mask: [page.locator('footer .build')],
        });
      });
    }
  }
}
