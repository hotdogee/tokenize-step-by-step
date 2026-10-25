/**
 * WP08 E2E layout (05 §3.3, §5, §9; WCAG 1.4.10, 2.4.11, 2.5.8): zero horizontal overflow at 320/360/768/1440/2560 px;
 * at 360 px the focused cell never sits under the bottom sheet or the header while arrowing through a whole paragraph;
 * the inspector surface follows the viewport width; touch pins and unpins; coarse-pointer targets are ≥ 24 × 24
 * (cells 36 px wide); forced colours keep the borders, the hatch and the focus outline; no inline style violates the CSP.
 */
import { devices, expect, test } from '@playwright/test';
import { watchPage } from '../support/page-guards.ts';
import { chooseExample, focusBoard, focusedCell, grid, intersects, rectOf } from './board-helpers.ts';
import { openShell } from './shell-helpers.ts';

for (const width of [320, 360, 768, 1440, 2560]) {
  test(`no horizontal overflow at ${String(width)} px (board and inspector included)`, async ({ page }) => {
    await page.setViewportSize({ width, height: 900 });
    const guards = await watchPage(page);
    await openShell(page, 'en');
    await chooseExample(page, 'zh-tw-paragraph');
    await focusBoard(page);
    await page.keyboard.press('ArrowRight');
    const overflow = await page.evaluate(
      () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
    );
    expect(overflow).toBe(0);
    const surface = await page.getByTestId('inspector-host').getAttribute('data-surface');
    expect(surface).toBe(width >= 1024 ? 'rail' : width >= 768 ? 'anchored' : 'sheet');
    expect(await guards.cspViolations()).toEqual([]);
  });
}

test('at 360 px the focused cell is never under the sheet or the header (WCAG 2.4.11)', async ({ page }) => {
  await page.setViewportSize({ width: 360, height: 780 });
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await openShell(page, 'en');
  await chooseExample(page, 'zh-tw-paragraph');
  await focusBoard(page);
  const header = await rectOf(page, 'header');
  for (const expanded of [false, true]) {
    if (expanded) {
      await page.getByTestId('sheet-handle').click();
      await expect(page.getByTestId('sheet-handle')).toHaveAttribute('aria-expanded', 'true');
      await focusBoard(page);
    }
    for (let i = 0; i < 60; i++) {
      await page.keyboard.press(i % 10 === 9 ? 'PageDown' : 'ArrowRight');
      const sheet = await rectOf(page, '[data-testid="inspector-host"]');
      const cell = await page.evaluate(() => {
        const { top, bottom, left, right } = (document.activeElement as HTMLElement).getBoundingClientRect();
        return { top, bottom, left, right };
      });
      expect(sheet).not.toBeNull();
      if (sheet !== null) expect(intersects(cell, sheet), `step ${String(i)}`).toBe(false);
      const headerNow = await rectOf(page, 'header');
      if (headerNow !== null && header !== null) expect(intersects(cell, headerNow)).toBe(false);
    }
  }
});

/** Pixel 5 emulation without its browser choice, so the project's chromium (or webkit) runs it. */
const { defaultBrowserType: _browser, ...pixel5 } = devices['Pixel 5'];

test.describe('touch (Pixel 5)', () => {
  test.use(pixel5);
  test.skip(({ browserName }) => browserName === 'firefox', 'Firefox has no mobile emulation (isMobile)');

  test('tap pins and tapping elsewhere unpins; targets are ≥ 24 × 24 with 36 px cells', async ({ page }) => {
    await openShell(page, 'en');
    await chooseExample(page, 'zh-tw-tainan');
    expect(await page.evaluate(() => matchMedia('(pointer: coarse)').matches)).toBe(true);
    const chip = grid(page).locator('[data-tier="token"][data-index="1"]');
    await chip.tap();
    await expect(page.getByTestId('status')).toContainText('pinned: token 2 of 4');
    await expect(chip).toHaveAttribute('data-pinned', '');
    await page.locator('h1').tap();
    await expect(grid(page).locator('[data-pinned]')).toHaveCount(0);
    await expect(page.getByTestId('status')).toContainText('unpinned');
    const sizes = await page.evaluate(() =>
      [
        ...document.querySelectorAll<HTMLElement>(
          '#board [role="gridcell"], #board button, [data-testid="inspector-host"] button',
        ),
      ]
        .filter((element) => element.getClientRects().length > 0)
        .map((element) => {
          const { width, height } = element.getBoundingClientRect();
          return { width, height, what: element.getAttribute('aria-label') ?? element.className };
        }),
    );
    expect(sizes.length).toBeGreaterThan(10);
    for (const size of sizes) {
      expect(size.width, size.what).toBeGreaterThanOrEqual(24);
      expect(size.height, size.what).toBeGreaterThanOrEqual(24);
    }
    const charWidth = await grid(page)
      .locator('[data-tier="char"]')
      .first()
      .evaluate((el) => el.getBoundingClientRect().width);
    expect(charWidth).toBeGreaterThanOrEqual(36 * 3 - 0.5);
    const handle = await page.getByTestId('sheet-handle').boundingBox();
    expect(handle?.height).toBeGreaterThanOrEqual(44);
  });
});

test('forced colours keep the cell borders, the hatched cut and the focus outline', async ({ page }) => {
  await page.emulateMedia({ forcedColors: 'active' });
  await openShell(page, 'en');
  await page.getByTestId('picker-button').click();
  await page
    .getByRole('dialog')
    .getByRole('option', { name: /cl100k_base/ })
    .click();
  await expect(page.getByRole('dialog')).toBeHidden();
  await expect(grid(page).locator('[data-tier="token"][data-partial]').first()).toBeVisible();
  const style = await grid(page)
    .locator('[data-tier="token"][data-index="1"] .bd-chip')
    .evaluate((el) => {
      const chip = getComputedStyle(el);
      return { border: chip.borderTopStyle, hatch: getComputedStyle(el, '::after').backgroundImage };
    });
  expect(style.border).not.toBe('none');
  expect(style.hatch).toContain('repeating-linear-gradient');
  await focusBoard(page);
  await page.keyboard.press('ArrowRight');
  await expect.poll(() => focusedCell(page)).toBe('char:1');
  const outline = await page.evaluate(() => {
    const box = document.activeElement?.querySelector('.bd-vis');
    if (box === null || box === undefined) return null;
    const { outlineStyle, outlineWidth } = getComputedStyle(box);
    return `${outlineStyle} ${outlineWidth}`;
  });
  expect(outline).toBe('solid 2px');
});
