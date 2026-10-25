/**
 * 06 §1 matrix assertions on each project's own device and viewport (no `test.use` overrides, so the full matrix gives
 * every check its intended context):
 * - touch targets (WCAG 2.5.8): on the touch projects (Pixel 5, iPhone 12) every visible pointer target — controls,
 *   board cells, dialog options — is ≥ 24 × 24 CSS px on the default view, at stop 4 and in the picker and help dialogs.
 *   A native checkbox or radio inside its `<label>` is measured by the label, which is what a tap hits; elements with
 *   `pointer-events: none` (the keyboard-only chunk brackets, 05 §3.3) are not pointer targets; a link inside running
 *   text (the picker's "evidence · checked on …") takes the 2.5.8 inline exception;
 * - reflow (WCAG 1.4.10): on every project the page chrome never scrolls horizontally, at 320 px in particular
 *   (`chromium-320`); the board is the declared exempt region (`[data-reflow-exempt]`) and scrolls inside itself.
 */
import { expect, test, type Page } from '@playwright/test';
import { focusBoard, grid } from './board-helpers.ts';
import { LOCALES, openAbout, openShell } from './shell-helpers.ts';

/** A pointer target smaller than 24 × 24, described for the failure message. */
interface SmallTarget {
  readonly what: string;
  readonly width: number;
  readonly height: number;
}

/** Asserts that no visible pointer target is smaller than 24 × 24 CSS px, and that the scan really measured some. */
async function expectTargets(page: Page, state: string): Promise<void> {
  const { measured, small } = await scanTargets(page);
  expect(measured, `${state}: pointer targets measured`).toBeGreaterThan(20);
  expect(small, `${state}: targets below 24 × 24`).toEqual([]);
}

/** Counts the visible pointer targets and lists those smaller than 24 × 24 CSS px. */
function scanTargets(page: Page): Promise<{ measured: number; small: SmallTarget[] }> {
  return page.evaluate(() => {
    const selector = [
      'a[href]',
      'button',
      'input:not([type="hidden"])',
      'select',
      'textarea',
      'summary',
      '[tabindex]:not([tabindex="-1"])',
      '[role="gridcell"]',
      '[role="option"]',
      '[role="radio"]',
      '[role="switch"]',
      '[role="button"]',
    ].join(', ');
    const small: SmallTarget[] = [];
    let measured = 0;
    for (const element of document.querySelectorAll<HTMLElement>(selector)) {
      if (element.getClientRects().length === 0) continue;
      const style = getComputedStyle(element);
      if (style.visibility === 'hidden' || style.pointerEvents === 'none') continue;
      // WCAG 2.5.8 "inline" exception: a link inside running text is sized by the line, not by us.
      const inline =
        element instanceof HTMLAnchorElement &&
        [...(element.parentElement?.childNodes ?? [])].some(
          (node) => node.nodeType === Node.TEXT_NODE && (node.textContent ?? '').trim() !== '',
        );
      if (inline) continue;
      const toggle = element instanceof HTMLInputElement && (element.type === 'checkbox' || element.type === 'radio');
      const target = (toggle ? element.closest('label') : null) ?? element;
      const { width, height } = target.getBoundingClientRect();
      measured += 1;
      if (width < 24 || height < 24) {
        const name = element.getAttribute('aria-label') ?? element.textContent.trim().slice(0, 40);
        small.push({ what: `${element.tagName.toLowerCase()} "${name}"`, width, height });
      }
    }
    return { measured, small };
  });
}

/** Horizontal overflow of the document (0 when the page chrome reflows). */
const overflow = (page: Page): Promise<number> =>
  page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);

test.describe('touch targets ≥ 24 × 24 (WCAG 2.5.8)', () => {
  test.skip(({ hasTouch }) => !hasTouch, 'touch projects only (pixel-5, iphone-12)');

  test('on the default view, at stop 4 and in the picker and help dialogs', async ({ page }) => {
    await openShell(page, 'en');
    expect(await page.evaluate(() => matchMedia('(pointer: coarse)').matches)).toBe(true);
    await expectTargets(page, 'default view (stop 6)');

    await focusBoard(page);
    await page.keyboard.press('Digit4');
    await expect(grid(page)).toHaveAttribute('data-stage', '4');
    await expectTargets(page, 'stop 4');

    await page.getByTestId('picker-button').click();
    await expect(page.getByRole('dialog')).toBeVisible();
    await expectTargets(page, 'picker dialog');
    await page.keyboard.press('Escape');
    await expect(page.getByRole('dialog')).toBeHidden();

    await page.getByRole('button', { name: 'Keyboard shortcuts and help' }).click();
    await expect(page.getByRole('dialog')).toBeVisible();
    await expectTargets(page, 'help dialog');
  });
});

test.describe('reflow (WCAG 1.4.10)', () => {
  for (const locale of LOCALES) {
    test(`the page chrome fits the viewport in ${locale}; the board is the exempt region`, async ({ page }) => {
      await openShell(page, locale);
      await expect(page.locator('[data-reflow-exempt]')).toHaveCount(1);
      expect(await overflow(page), '/').toBe(0);
      await page.getByTestId('picker-button').click();
      await expect(page.getByRole('dialog')).toBeVisible();
      expect(await overflow(page), 'picker open').toBe(0);
    });
  }

  test('About fits the viewport', async ({ page }) => {
    await openAbout(page, 'en');
    expect(await overflow(page)).toBe(0);
  });
});
