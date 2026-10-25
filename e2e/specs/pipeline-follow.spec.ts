/**
 * Follow mode after a jump (05 §2, PA-13) on the zh-tw-paragraph chip, a board virtualized at every project width: the
 * part a far step formed lives in a row the window had not mounted, and (in WebKit) one that had never rendered. The
 * board keeps that row mounted at stop 5 and opts it out of `content-visibility`, so after "jump to end" (the scrubber's
 * End), a merge-list row near the end and the inspector's "Show this step" from stop 6, the director marks the part
 * (`data-just-merged`) and scrolls it into the viewport, clear of the bottom sheet. The page is scrolled back to the top
 * with `window.scrollTo` before each jump, which (unlike a wheel or a scrolling key) leaves follow mode on.
 */
import { expect, test, type Page } from '@playwright/test';
import { chooseExample, focusBoard, grid, intersects, type Rect } from './board-helpers.ts';
import { scrubber } from './pipeline-helpers.ts';
import { openShell } from './shell-helpers.ts';

/** Opens the paragraph with its live (traced) result and reduced motion, so every scroll lands at once. */
async function openParagraph(page: Page): Promise<void> {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await openShell(page, 'en');
  await chooseExample(page, 'zh-tw-paragraph');
  await expect(page.locator('[data-source="live"]')).toBeVisible();
  await expect(scrubber(page)).toBeEnabled();
}

/** Stop 5 at step 0 with the page scrolled to its top. */
async function startAtStepZero(page: Page): Promise<void> {
  await scrubber(page).focus();
  await page.keyboard.press('Home');
  await expect(grid(page)).toHaveAttribute('data-stage', '5');
  await expect(scrubber(page)).toHaveAttribute('aria-valuetext', /^step 0 \//);
  await scrollToTop(page);
}

async function scrollToTop(page: Page): Promise<void> {
  await page.evaluate(() => {
    window.scrollTo(0, 0);
  });
  await expect.poll(() => page.evaluate(() => window.scrollY)).toBe(0);
}

/** The merged part's first fragment is marked, inside the viewport and not under the bottom sheet. */
async function expectMergedInView(page: Page): Promise<void> {
  const merged = grid(page).locator('[data-just-merged][data-first]');
  await expect(merged.first()).toBeInViewport();
  const { cell, sheet } = await merged.first().evaluate((element) => {
    const rect = (target: Element | null): Rect | null => {
      if (target === null) return null;
      const { top, bottom, left, right } = target.getBoundingClientRect();
      return { top, bottom, left, right };
    };
    const host = document.querySelector('[data-testid="inspector-host"]');
    return { cell: rect(element), sheet: host?.getAttribute('data-surface') === 'sheet' ? rect(host) : null };
  });
  if (cell !== null && sheet !== null) expect(intersects(cell, sheet), 'merged part under the sheet').toBe(false);
}

test('"jump to end" (scrubber End) marks the last merge and scrolls it into view', async ({ page }) => {
  await openParagraph(page);
  await startAtStepZero(page); // the scrubber keeps focus
  await page.keyboard.press('End');
  await expect(scrubber(page)).toHaveAttribute('aria-valuetext', /^step (\d+) \/ \1 · /);
  await expectMergedInView(page);
});

test('a merge-list row near the end marks its part and scrolls it into view', async ({ page }) => {
  await openParagraph(page);
  const count = Number(await scrubber(page).getAttribute('max'));
  expect(count).toBeGreaterThan(100);
  await startAtStepZero(page);
  await page.getByTestId('merges-toggle').click();
  const list = page.getByTestId('merge-list');
  await expect(list).toBeVisible();
  // The list mounts 60 rows around its focused row: End moves its keyboard focus (and window) to the last step.
  await list.locator('[tabindex="0"]').focus();
  await page.keyboard.press('End');
  const target = list.locator(`[data-position="${String(count - 5)}"]`);
  await expect(target).toHaveCount(1);
  await scrollToTop(page);
  await target.click();
  await expect(scrubber(page)).toHaveAttribute(
    'aria-valuetext',
    new RegExp(`^step ${String(count - 5)} / ${String(count)} · `),
  );
  await expectMergedInView(page);
});

test('"Show this step" from stop 6 marks the step\'s part and scrolls it into view', async ({ page }) => {
  await openParagraph(page);
  await expect(grid(page)).toHaveAttribute('data-stage', '6');
  await focusBoard(page);
  await page.keyboard.press('Control+End');
  for (let i = 0; i < 4; i++) await page.keyboard.press('ArrowDown'); // to the token tier (a no-op once there)
  await expect(grid(page).locator(':focus')).toHaveAttribute('data-tier', 'token');
  // The last token, 。, is a direct hit (no merge formed it); the one before, 亂, closes the last chunk's merges.
  await page.keyboard.press('ArrowLeft');
  await page.keyboard.press('Enter');
  await expect(page.getByTestId('status')).toContainText('pinned: token');
  await expect(grid(page).locator('[data-pinned]').first()).toBeVisible();
  await scrollToTop(page);
  const host = page.getByTestId('inspector-host');
  if ((await host.getAttribute('data-surface')) === 'sheet') {
    await page.getByTestId('sheet-handle').click();
    await expect(page.getByTestId('sheet-handle')).toHaveAttribute('aria-expanded', 'true');
  }
  await host.getByRole('button', { name: 'Show this step' }).first().click();
  await expect(grid(page)).toHaveAttribute('data-stage', '5');
  await expectMergedInView(page);
});
