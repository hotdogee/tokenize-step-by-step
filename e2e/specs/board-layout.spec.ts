/**
 * WP08 E2E layout (05 §3.3, §5, §9; WCAG 1.4.10, 2.4.11, 2.5.8): zero horizontal overflow at 320/360/768/1440/2560 px
 * (and at 320 px with cell size L on a coarse pointer, where K's floor scrolls inside the board); at 360 px the focused
 * cell never sits under the bottom sheet or the header while arrowing through a whole paragraph, and at 768–1023 px never
 * under the anchored panel while a cell is pinned; at every project's viewport Ctrl+End and Ctrl+Home on the virtualized
 * paragraph leave the focused cell inside the viewport, clear of the sheet and of the top edge (PA-13: WebKit ignored
 * `scrollIntoView` into a `content-visibility: auto` row it had never rendered); the inspector surface follows the
 * viewport width; touch pins and unpins; coarse-pointer targets are ≥ 24 × 24 (cells 36 px wide) at 393 px and at stop 4
 * at 600 px, where the 14 px chunk brackets are keyboard-only; forced colours draw the borders in CanvasText and the
 * hatch and the focus outline in Highlight; no inline style violates the CSP.
 */
import { devices, expect, test } from '@playwright/test';
import { watchPage } from '../support/page-guards.ts';
import { chooseExample, focusBoard, focusedCell, focusRects, grid, intersects, type Rect } from './board-helpers.ts';
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
    expect(guards.pageErrors()).toEqual([]);
  });
}

test('at 360 px the focused cell is never under the sheet or the header (WCAG 2.4.11)', async ({ page }) => {
  test.slow(); // 120 key presses with a layout read after each: 15–25 s on WebKit, near the default 30 s timeout
  await page.setViewportSize({ width: 360, height: 780 });
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await openShell(page, 'en');
  await chooseExample(page, 'zh-tw-paragraph');
  await focusBoard(page);
  for (const expanded of [false, true]) {
    if (expanded) {
      await page.getByTestId('sheet-handle').click();
      await expect(page.getByTestId('sheet-handle')).toHaveAttribute('aria-expanded', 'true');
      await focusBoard(page);
    }
    for (let i = 0; i < 60; i++) {
      await page.keyboard.press(i % 10 === 9 ? 'PageDown' : 'ArrowRight');
      // One round trip per step (120 steps): WebKit's evaluate latency made three per step outrun the test timeout.
      const { cell, sheet, header } = await focusRects(page);
      expect(cell, `step ${String(i)}: focused element`).not.toBeNull();
      expect(sheet).not.toBeNull();
      if (cell === null) continue;
      if (sheet !== null) expect(intersects(cell, sheet), `step ${String(i)}`).toBe(false);
      if (header !== null) expect(intersects(cell, header), `step ${String(i)} (header)`).toBe(false);
    }
  }
});

test('Ctrl+End and Ctrl+Home leave the focused cell in the viewport, clear of the sheet and the top edge (PA-13)', async ({
  page,
}) => {
  await page.emulateMedia({ reducedMotion: 'reduce' }); // instant scrolls: the checks read the settled position
  await openShell(page, 'en');
  await chooseExample(page, 'zh-tw-paragraph'); // a long paragraph: its last row has never rendered
  await focusBoard(page);
  const focused = page.locator('[data-testid="board-grid"] :focus');
  for (const key of ['Control+End', 'Control+Home']) {
    await page.keyboard.press(key);
    if (key === 'Control+End') await expect.poll(() => focusedCell(page)).not.toBe('char:0');
    else await expect.poll(() => focusedCell(page)).toBe('char:0');
    await expect(focused, key).toBeInViewport({ ratio: 1 });
    // The focused row opts out of content-visibility (board.css `.bd-row[data-keep]`).
    expect(await focused.evaluate((cell) => cell.closest('.bd-row')?.hasAttribute('data-keep') ?? false)).toBe(true);
    const { cell, sheet, header } = await focusRects(page);
    expect(cell, key).not.toBeNull();
    if (cell === null) continue;
    // scroll-padding-block-start: 8px keeps the ring (2–4 px) clear of the top edge; a margin for sub-pixel layouts.
    expect(cell.top, `${key}: top edge`).toBeGreaterThanOrEqual(4);
    if (sheet !== null) expect(intersects(cell, sheet), `${key}: sheet`).toBe(false);
    if (header !== null) expect(intersects(cell, header), `${key}: header`).toBe(false);
  }
});

for (const [width, height] of [
  [900, 900],
  [800, 700],
] as const) {
  test(`at ${String(width)} × ${String(height)} the anchored panel never covers the focused cell while pinned (WCAG 2.4.11)`, async ({
    page,
  }) => {
    test.slow(); // 16 keys with a polled layout read after each: 12–15 s on WebKit alone, past 30 s under a full matrix
    await page.setViewportSize({ width, height });
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await openShell(page, 'en');
    await chooseExample(page, 'zh-tw-paragraph');
    await focusBoard(page);
    await page.keyboard.press('ArrowDown');
    await page.keyboard.press('Enter'); // pins byte 0; focus stays in the grid (AD-34, 05 §5)
    await expect(grid(page).locator('[data-pinned]')).toHaveCount(1);
    const host = page.getByTestId('inspector-host');
    await expect(host).toHaveAttribute('data-surface', 'anchored');
    await expect(host).toBeVisible();
    /** One round trip: 'ok' or why the focused cell is (partly) under the panel, the focused cell, the pinned count. */
    let last = { status: '', cell: '', pinned: 0 };
    const probe = async (): Promise<string> => {
      last = await page.evaluate(() => {
        const active = document.activeElement as HTMLElement | null;
        const panel = document.querySelector<HTMLElement>('[data-testid="inspector-host"]');
        const pinned = document.querySelectorAll('[data-testid="board-grid"] [data-pinned]').length;
        const cell = `${active?.dataset['tier'] ?? ''}:${active?.dataset['index'] ?? ''}`;
        if (active === null || panel === null || panel.hidden)
          return { status: 'no focused cell or no panel', cell, pinned };
        const a = active.getBoundingClientRect();
        const b = panel.getBoundingClientRect();
        if (a.left < b.right && b.left < a.right && a.top < b.bottom && b.top < a.bottom)
          return { status: `${cell} intersects the panel`, cell, pinned };
        const hit = document.elementFromPoint((a.left + a.right) / 2, (a.top + a.bottom) / 2);
        const status = hit !== null && active.contains(hit) ? 'ok' : `centre hit ${hit?.className ?? 'nothing'}`;
        return { status, cell, pinned };
      });
      return last.status;
    };
    const seen = new Set<string>();
    for (let i = 0; i < 16; i++) {
      await page.keyboard.press(i < 10 ? 'PageDown' : i % 2 === 0 ? 'PageUp' : 'ArrowRight');
      await expect.poll(probe, { message: `after key ${String(i)}` }).toBe('ok');
      seen.add(last.cell);
      expect(last.pinned, `after key ${String(i)}: still pinned`).toBe(1);
    }
    expect(seen.size).toBeGreaterThan(4); // focus really moved down the paragraph
  });
}

test.describe('touch: expanding the sheet over a pinned cell', () => {
  test.skip(({ hasTouch }) => !hasTouch, 'touch projects only (pixel-5, iphone-12)');

  test('brings the pinned cell back into view above the expanded sheet', async ({ page }) => {
    await openShell(page, 'en');
    await expect(grid(page)).not.toHaveAttribute('data-pending', '');
    // Token 2 of the default example in the lower half of the viewport, just above the collapsed sheet, so the tap does
    // not scroll and the expanded sheet (40vh) would cover it.
    const cell = grid(page).locator('[data-tier="token"][data-index="1"][data-first]');
    await cell.evaluate((element) => {
      window.scrollBy({ top: element.getBoundingClientRect().bottom - (innerHeight - 56 - 12), behavior: 'instant' });
    });
    const before = await cell.boundingBox();
    const viewport = page.viewportSize();
    expect(before !== null && viewport !== null && before.y > viewport.height / 2).toBe(true);
    await cell.tap();
    await expect(page.getByTestId('status')).toContainText('pinned: token 2 of 4');
    const handle = page.getByTestId('sheet-handle');
    await handle.tap();
    await expect(handle).toHaveAttribute('aria-expanded', 'true');
    const sheet = page.getByTestId('inspector-host');
    await expect
      .poll(async () => {
        const [a, b] = await Promise.all([cell.boundingBox(), sheet.boundingBox()]);
        if (a === null || b === null) return 'missing';
        if (a.y < 0) return 'above the viewport';
        const rect = (box: typeof a): Rect => ({
          top: box.y,
          bottom: box.y + box.height,
          left: box.x,
          right: box.x + box.width,
        });
        return intersects(rect(a), rect(b)) ? 'under the sheet' : 'clear';
      })
      .toBe('clear');
    await expect(cell).toHaveAttribute('data-pinned', '');
  });
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

test.describe('touch at 600 px (Pixel 5 emulation)', () => {
  test.use({ ...pixel5, viewport: { width: 600, height: 900 } });
  test.skip(({ browserName }) => browserName === 'firefox', 'Firefox has no mobile emulation (isMobile)');

  test('at stop 4 every board pointer target is ≥ 24 × 24; the 14 px chunk brackets are keyboard-only', async ({
    page,
  }) => {
    await openShell(page, 'en');
    await chooseExample(page, 'mixed-hello-taiwan-tokyo');
    expect(await page.evaluate(() => matchMedia('(pointer: coarse)').matches)).toBe(true);
    await focusBoard(page);
    await page.keyboard.press('Digit4');
    await expect(grid(page)).toHaveAttribute('data-stage', '4');
    const chunks = grid(page).locator('[data-tier="chunk"]');
    await expect(chunks.first()).toBeVisible();
    const targets = await page.evaluate(() =>
      [
        ...document.querySelectorAll<HTMLElement>(
          '#board [role="gridcell"], #board button, [data-testid="inspector-host"] button',
        ),
      ]
        .filter((element) => element.getClientRects().length > 0)
        .map((element) => {
          const { width, height } = element.getBoundingClientRect();
          return {
            width,
            height,
            tier: element.dataset['tier'] ?? '',
            pointer: getComputedStyle(element).pointerEvents !== 'none',
            focusable: element.hasAttribute('tabindex'),
            what: element.getAttribute('aria-label') ?? element.className,
          };
        }),
    );
    const chunkCells = targets.filter((target) => target.tier === 'chunk');
    expect(chunkCells.length).toBeGreaterThan(1);
    for (const chunk of chunkCells) {
      expect(chunk.pointer, chunk.what).toBe(false);
      expect(chunk.focusable, chunk.what).toBe(true);
    }
    const pointerTargets = targets.filter((target) => target.pointer);
    expect(pointerTargets.length).toBeGreaterThan(10);
    for (const target of pointerTargets) {
      expect(target.width, target.what).toBeGreaterThanOrEqual(24);
      expect(target.height, target.what).toBeGreaterThanOrEqual(24);
    }
    // The keyboard still reaches the chunk tier (char → byte → chunk); a tap on a bracket never pins the chunk (the
    // browser's touch adjustment may hand it to the neighbouring byte or token target, which is ≥ 24 px tall).
    await page.keyboard.press('ArrowDown');
    await page.keyboard.press('ArrowDown');
    await expect.poll(() => focusedCell(page)).toBe('chunk:0');
    const box = await chunks.first().boundingBox();
    expect(box).not.toBeNull();
    if (box !== null) await page.touchscreen.tap(box.x + box.width / 2, box.y + box.height / 2);
    await page.evaluate(
      () =>
        new Promise<void>((resolve) => {
          requestAnimationFrame(() => {
            requestAnimationFrame(() => {
              resolve();
            });
          });
        }),
    );
    // No "pinned: chunk …" (stop 4's own announcement, "Chunks: 4 chunks", stays when the tap pins nothing).
    await expect(page.getByTestId('status')).not.toContainText('pinned: chunk');
    await expect(grid(page).locator('[data-tier="chunk"][data-pinned]')).toHaveCount(0);
  });

  test('no horizontal overflow at 320 px with cell size L: the K = 8 floor scrolls inside the board', async ({
    page,
  }) => {
    await page.addInitScript(() => {
      try {
        localStorage.setItem('tsbs:cellSize', 'L');
      } catch {
        // storage blocked: the page then runs at the default size and still must not overflow
      }
    });
    await page.setViewportSize({ width: 320, height: 800 });
    await openShell(page, 'en');
    await chooseExample(page, 'zh-tw-paragraph');
    await expect(grid(page)).toHaveAttribute('aria-colcount', '8');
    const sizes = await page.evaluate(() => ({
      grid: document.querySelector('[data-testid="board-grid"]')?.getBoundingClientRect().width ?? 0,
      overflow: document.documentElement.scrollWidth - document.documentElement.clientWidth,
    }));
    expect(sizes.grid).toBeGreaterThan(288); // 8 × 40 px: wider than the 288 px column
    expect(sizes.overflow).toBe(0);
    await focusBoard(page);
    await page.keyboard.press('End'); // the row's last cell scrolls into view inside the board column
    await expect
      .poll(() =>
        page.evaluate(() => {
          const { left, right } = (document.activeElement as HTMLElement).getBoundingClientRect();
          return left >= 0 && right <= document.documentElement.clientWidth;
        }),
      )
      .toBe(true);
  });
});

test('forced colours draw borders in CanvasText and the hatched cut and the focus outline in Highlight', async ({
  page,
}) => {
  await page.emulateMedia({ forcedColors: 'active' });
  await openShell(page, 'en');
  await page.getByTestId('picker-button').click();
  await page
    .getByRole('dialog')
    .getByRole('option', { name: /cl100k_base/ })
    .click();
  await expect(page.getByRole('dialog')).toBeHidden();
  await expect(grid(page).locator('[data-tier="token"][data-partial]').first()).toBeVisible();
  // The system colours as this browser resolves them (a probe that opts out of forcing), so the checks below fail if the
  // @media (forced-colors) block goes: forcing alone turns borders and outlines CanvasText and drops gradients.
  const system = await page.evaluate(() => {
    const probe = document.createElement('div');
    probe.style.setProperty('forced-color-adjust', 'none');
    probe.style.setProperty('color', 'Highlight');
    probe.style.setProperty('background-color', 'CanvasText');
    document.body.append(probe);
    const { color, backgroundColor } = getComputedStyle(probe);
    probe.remove();
    return { highlight: color, canvasText: backgroundColor };
  });
  expect(system.highlight).not.toBe(system.canvasText);
  const style = await grid(page)
    .locator('[data-tier="token"][data-index="1"] .bd-chip')
    .evaluate((el) => {
      const chip = getComputedStyle(el);
      return {
        border: `${chip.borderTopStyle} ${chip.borderTopColor}`,
        hatch: getComputedStyle(el, '::after').backgroundImage,
      };
    });
  expect(style.border).toBe(`solid ${system.canvasText}`);
  expect(style.hatch).toContain('repeating-linear-gradient');
  expect(style.hatch).toContain(system.highlight);
  await focusBoard(page);
  await page.keyboard.press('ArrowRight');
  await expect.poll(() => focusedCell(page)).toBe('char:1');
  const outline = await page.evaluate(() => {
    const box = document.activeElement?.querySelector('.bd-vis');
    if (box === null || box === undefined) return null;
    const { outlineStyle, outlineWidth, outlineColor } = getComputedStyle(box);
    return `${outlineStyle} ${outlineWidth} ${outlineColor}`;
  });
  expect(outline).toBe(`solid 2px ${system.highlight}`);
});
