/**
 * Shared steps of the WP08 board suites (board-*.spec.ts): focus the board's single tab stop, read which logical cell has
 * focus (`tier:index`), pick an example chip, and read element rectangles for the focus-not-obscured checks.
 */
import { expect, type Locator, type Page } from '@playwright/test';

/** The board grid. */
export const grid = (page: Page): Locator => page.locator('[role="grid"][data-testid="board-grid"]');

/** `tier:index` of the focused element (`text-input:` for the textarea, `none:` otherwise). */
export function focusedCell(page: Page): Promise<string> {
  return page.evaluate(() => {
    const active = document.activeElement as HTMLElement | null;
    if (active === null) return 'none:';
    if (active.id === 'text-input') return 'text-input:';
    return `${active.dataset['tier'] ?? active.tagName.toLowerCase()}:${active.dataset['index'] ?? ''}`;
  });
}

/** Focuses the board's roving tab stop (the one cell with tabindex 0). */
export async function focusBoard(page: Page): Promise<void> {
  const stop = grid(page).locator('[tabindex="0"]');
  await expect(stop).toHaveCount(1);
  await stop.focus();
}

/** Applies an example chip by its key (`zh-tw-tainan`, `mixed-hello-taiwan-tokyo`, …) and waits for its result. */
export async function chooseExample(page: Page, key: string): Promise<void> {
  await page.locator(`[data-key="${key}"]`).click();
  await expect(page.locator('[data-source]')).toBeVisible();
  await expect(grid(page)).not.toHaveAttribute('data-pending', '');
}

export interface Rect {
  readonly top: number;
  readonly bottom: number;
  readonly left: number;
  readonly right: number;
}

/** Rectangles of the focused element, the inspector host and the page header (null when absent), in one round trip. */
export interface FocusRects {
  readonly cell: Rect | null;
  readonly sheet: Rect | null;
  readonly header: Rect | null;
}

/** Reads `FocusRects` with one `page.evaluate` (the focus-not-obscured loops call it on every key press). */
export function focusRects(page: Page): Promise<FocusRects> {
  return page.evaluate(() => {
    const rect = (element: Element | null): Rect | null => {
      if (element === null || element === document.body) return null;
      const { top, bottom, left, right } = element.getBoundingClientRect();
      return { top, bottom, left, right };
    };
    return {
      cell: rect(document.activeElement),
      sheet: rect(document.querySelector('[data-testid="inspector-host"]')),
      header: rect(document.querySelector('header')),
    };
  });
}

/** True when the two rectangles overlap (touching edges do not count). */
export function intersects(a: Rect, b: Rect): boolean {
  return a.left < b.right && b.left < a.right && a.top < b.bottom && b.top < a.bottom;
}
