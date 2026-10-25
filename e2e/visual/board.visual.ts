/**
 * Visual baselines (06 §1 "Visual"): 4 fixtures × 2 themes × 3 viewports (360/768/1440), `toHaveScreenshot` with
 * `maxDiffPixelRatio` 0.002 (the `visual` project in `projects.ts`), chromium on Linux with `fonts-noto-cjk`.
 *
 * The baselines are Linux renders (`__screenshots__/<name>-linux.png`): they are produced by the `visual-baselines`
 * workflow (`.github/workflows/ci.yml`, workflow_dispatch) and committed from its artifact (docs/release.md § Visual
 * baselines). Until the first baselines are committed (no `*-linux.png` in `__screenshots__` at all), and on any run off
 * Linux, whose font rendering differs, every test skips with a notice instead of writing a baseline nobody reviewed. Once
 * any baseline exists, a missing one fails: a deleted file, a renamed fixture or theme, or a new viewport must not drop
 * coverage silently. `--update-snapshots` on Linux writes them.
 *
 * The page runs on the precomputed-examples client (`?mock=1`, docs/dev.md), so no Worker timing or vocabulary download
 * can change a pixel; the footer's build stamp (sha + date) is masked.
 */
import { existsSync, readdirSync } from 'node:fs';
import { basename, dirname } from 'node:path';
import process from 'node:process';
import { expect, test, type Page } from '@playwright/test';
import { chooseExample } from '../specs/board-helpers.ts';
import { pickTokenizer, THEMES, useTheme } from '../specs/shell-helpers.ts';

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

/** True while no Linux baseline is committed at all (before the first visual-baselines run): the only state that skips. */
function bootstrapping(directory: string): boolean {
  return !existsSync(directory) || !readdirSync(directory).some((file) => file.endsWith('-linux.png'));
}

/** Opens `/` on the precomputed client, selects the tokenizer and the chip, and waits for fonts and a settled board. */
async function open(page: Page, tokenizer: string, example: string): Promise<void> {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.goto('/?lang=en&mock=1');
  await expect(page.locator('[data-source="live"]')).toBeVisible();
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
        const baseline = testInfo.snapshotPath(`${name}.png`, { kind: 'screenshot' });
        const updating = testInfo.config.updateSnapshots === 'all' || testInfo.config.updateSnapshots === 'changed';
        test.skip(process.platform !== 'linux', 'visual baselines are Linux renders (fonts-noto-cjk); run on Linux');
        test.skip(
          !updating && bootstrapping(dirname(baseline)),
          'no visual baselines committed yet: run the visual-baselines workflow and commit its artifact (docs/release.md)',
        );
        expect(
          updating || existsSync(baseline),
          `${basename(baseline)} is missing while other baselines are committed: refresh them (docs/release.md)`,
        ).toBe(true);
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
