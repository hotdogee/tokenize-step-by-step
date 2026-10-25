/**
 * WP08 E2E keyboard tour (05 §8, AD-22, AD-34) on the example chips (tokenized live by the Worker since the wave 2
 * integration; the expected cells are the fixtures'): the board is one tab stop; ←/→/↑/↓/Home/End/PageUp/PageDown move as the APG layout grid
 * says, ↑ on the top tier and ↓ on the bottom tier are no-ops; a span wrapped over rows is one cell; Enter pins and
 * announces, `i` moves into the inspector and Esc returns, Esc unpins, Esc again returns to the textarea; focus keeps its
 * byte anchor when a stage change remounts the tiers, across re-tokenization (picker: o200k → cl100k) and across a
 * virtual remount (a new K repacks the rows); "Single-key shortcuts: off" leaves the board keys working; the inspector
 * catalog and the keyboard hint arrive on the first interaction, never at startup (PA-7); the whole tour runs under the
 * strict CSP with zero violations and axe stays clean.
 */
import { expect, test } from '@playwright/test';
import { DESKTOP_VIEWPORT } from '../projects.ts';
import { expectNoAxeViolations } from '../support/axe.ts';
import { watchPage } from '../support/page-guards.ts';
import { chooseExample, focusBoard, focusedCell, grid } from './board-helpers.ts';
import { openShell, pickTokenizer } from './shell-helpers.ts';

test('the board is one tab stop between the controls and the inspector', async ({ page }) => {
  await openShell(page, 'en');
  await page.locator('#text-input').focus();
  let reached = '';
  for (let i = 0; i < 60 && !reached.startsWith('char:'); i++) {
    await page.keyboard.press('Tab');
    reached = await focusedCell(page);
  }
  expect(reached).toBe('char:0');
  await page.keyboard.press('Tab');
  const after = await focusedCell(page);
  expect(after.startsWith('char:') || after.startsWith('hex:') || after.startsWith('token:')).toBe(false);
  // The next stop is the inspector's first control: inside the panel on the rail and anchored surfaces; on the bottom
  // sheet (< 768 px, AD-34) its handle button, which precedes the panel.
  const surface = await page.getByTestId('inspector-host').getAttribute('data-surface');
  if (surface === 'sheet') await expect(page.getByTestId('sheet-handle')).toBeFocused();
  else
    expect(
      await page.evaluate(() => document.getElementById('inspector-panel')?.contains(document.activeElement)),
    ).toBe(true);
});

// The tour's expected cells assume 台灣台南 on one packed row (K ≥ 12): pinned to the desktop viewport so the device and
// narrow projects run the same tour; the wrapped-row moves are the 360 px test below.
test.describe('desktop layout', () => {
  test.use({ viewport: DESKTOP_VIEWPORT });

  test('keyboard tour: arrows, edges, rows, pin, inspector and Esc (o200k 台灣台南)', async ({ page }, testInfo) => {
    const guards = await watchPage(page);
    await openShell(page, 'en');
    await focusBoard(page);
    const press = async (key: string, expected: string): Promise<void> => {
      await page.keyboard.press(key);
      await expect.poll(() => focusedCell(page)).toBe(expected);
    };
    await press('ArrowRight', 'char:1');
    await press('ArrowUp', 'char:1'); // top tier: no-op
    await press('ArrowDown', 'hex:3');
    await press('ArrowDown', 'token:1');
    await press('ArrowDown', 'token:1'); // bottom tier: no-op
    await press('Home', 'token:0');
    await press('End', 'token:3');
    await press('Control+Home', 'token:0');
    await press('ArrowUp', 'hex:0');
    await press('Control+End', 'hex:11');
    await expect(grid(page).locator('[tabindex="0"]')).toHaveCount(1);

    await press('ArrowDown', 'token:3');
    await page.keyboard.press('Enter');
    await expect(page.getByTestId('status')).toContainText('pinned: token 4 of 4, id 14609');
    await expect(grid(page).locator('[data-tier="token"][data-index="3"]')).toHaveAttribute('data-pinned', '');
    await expect(page.locator('#inspector-heading')).toHaveText('Inspector — token 4 of 4');
    await press('ArrowLeft', 'token:2'); // focus stays in the grid while pinned
    await expect(page.locator('#inspector-heading')).toHaveText('Inspector — token 4 of 4');
    await expectNoAxeViolations(page, testInfo, 'board-pinned', { include: ['#board'] });

    await page.keyboard.press('i');
    await expect
      .poll(() => page.evaluate(() => document.getElementById('inspector-panel')?.contains(document.activeElement)))
      .toBe(true);
    await press('Escape', 'token:2');
    await page.keyboard.press('Escape');
    await expect(page.getByTestId('status')).toContainText('unpinned');
    await expect(grid(page).locator('[data-pinned]')).toHaveCount(0);
    await press('Escape', 'text-input:');
    expect(await guards.cspViolations()).toEqual([]);
  });
});

test('a span wrapped over rows is one logical cell (360 px, token " 東京")', async ({ page }) => {
  await page.setViewportSize({ width: 360, height: 780 });
  await openShell(page, 'en');
  await chooseExample(page, 'mixed-hello-taiwan-tokyo');
  const fragments = grid(page).locator('[data-tier="token"][data-index="4"]');
  await expect(fragments).toHaveCount(2);
  await expect(fragments.nth(0)).toHaveAttribute('aria-describedby', 'frag-token-4');
  await expect(fragments.nth(1)).toHaveAttribute('aria-describedby', 'frag-token-4-2');
  await focusBoard(page);
  await page.keyboard.press('ArrowDown');
  await page.keyboard.press('ArrowDown');
  await page.keyboard.press('Control+Home');
  for (let i = 0; i < 4; i++) await page.keyboard.press('ArrowRight');
  await expect.poll(() => focusedCell(page)).toBe('token:4');
  await expect(fragments.nth(0)).toBeFocused();
  await expect(fragments.nth(1)).toHaveAttribute('data-active', '');
  await page.keyboard.press('ArrowRight');
  await expect.poll(() => focusedCell(page)).toBe('token:5');
  await expect(page.locator('#frag-token-4-2')).toHaveText(
    'token 5, continued (part 2 of 2), continued from the previous row',
  );
});

test('focus keeps its byte anchor when a stage change remounts the tiers', async ({ page }) => {
  await openShell(page, 'en');
  await chooseExample(page, 'zh-tw-tainan');
  await focusBoard(page);
  await page.keyboard.press('ArrowDown');
  await page.keyboard.press('ArrowDown');
  await page.keyboard.press('ArrowRight');
  await expect.poll(() => focusedCell(page)).toBe('token:1'); // 133072 = 灣, bytes [3, 6)
  await page.keyboard.press('Digit3'); // stop 3: no token tier → the byte row keeps the anchor
  await expect.poll(() => focusedCell(page)).toBe('hex:3');
  await page.keyboard.press('Digit6'); // the anchor still names the token tier: focus returns to the token
  await expect.poll(() => focusedCell(page)).toBe('token:1');
  await page.keyboard.press('ArrowUp');
  await expect.poll(() => focusedCell(page)).toBe('hex:3');
  await expect(grid(page).locator('[tabindex="0"]')).toHaveCount(1);
});

test('focus keeps its byte anchor across re-tokenization (o200k → cl100k) and a virtual remount (new K)', async ({
  page,
}) => {
  await openShell(page, 'en');
  await chooseExample(page, 'zh-tw-tainan');
  await focusBoard(page);
  for (const key of ['ArrowDown', 'ArrowDown', 'ArrowRight', 'ArrowRight']) await page.keyboard.press(key);
  await expect.poll(() => focusedCell(page)).toBe('token:2'); // o200k: 台 = bytes [6, 9)
  await pickTokenizer(page, 'cl100k_base');
  await expect(grid(page)).not.toHaveAttribute('data-pending', '');
  const stop = grid(page).locator('[tabindex="0"]');
  await expect(stop).toHaveCount(1);
  // cl100k splits 灣 into 66285 + 96, so the token covering byte 6 (台) is token 4 now.
  await expect(stop).toHaveAttribute('data-tier', 'token');
  await expect(stop).toHaveAttribute('data-index', '3');

  // A new K repacks a multi-row text: the focused cell moves to another packed row and focus follows its byte anchor.
  await chooseExample(page, 'zh-tw-paragraph');
  await focusBoard(page);
  await page.keyboard.press('Control+End');
  const last = await focusedCell(page);
  const rowOfFocus = (): Promise<string | null> =>
    page.evaluate(() => document.activeElement?.closest('.bd-row')?.getAttribute('data-row') ?? null);
  const rowBefore = await rowOfFocus();
  await page.setViewportSize({ width: 800, height: 900 });
  await expect.poll(rowOfFocus).not.toBe(rowBefore);
  await expect.poll(() => focusedCell(page)).toBe(last);
  await expect(grid(page).locator('[tabindex="0"]')).toHaveCount(1);
});

test('the inspector catalog and the keyboard hint load on the first interaction, not at startup (PA-7)', async ({
  page,
}) => {
  const fetched: string[] = [];
  page.on('request', (request) => {
    if (/\/lazy-catalogs-[\w-]+\.js$/.test(new URL(request.url()).pathname)) fetched.push(request.url());
  });
  await openShell(page, 'en');
  await page.waitForLoadState('networkidle');
  expect(fetched).toEqual([]);
  const layout = page.locator('#board [data-inspector]');
  await expect(layout).toHaveAttribute('data-inspector', 'loading');
  await focusBoard(page);
  await expect(layout).toHaveAttribute('data-inspector', 'ready');
  expect(fetched).toHaveLength(1);
  await expect(page.locator('#board .hint')).toHaveText(
    'Arrow keys move between cells · Enter pins the inspector · i opens it',
  );
  await expect(page.locator('#inspector-heading')).toHaveText('Inspector — character 1 of 4');
});

test('"Single-key shortcuts: off" leaves the board keys (arrows, Enter, i, c, Esc) working', async ({ page }) => {
  await openShell(page, 'en');
  await page.keyboard.press('Shift+Slash');
  const dialog = page.getByRole('dialog');
  await dialog.getByRole('switch', { name: 'Single-key shortcuts' }).uncheck();
  await page.keyboard.press('Escape');
  await expect(dialog).toBeHidden();
  await focusBoard(page);
  await page.keyboard.press('KeyH'); // global shortcut: off
  await expect(grid(page).locator('[data-tier="hex"]').first()).toBeVisible();
  await expect(grid(page).locator('[data-tier="dec"]')).toHaveCount(0);
  await page.keyboard.press('Digit3'); // global shortcut: off (no stage change)
  await expect(grid(page)).toHaveAttribute('data-stage', '6');
  await page.keyboard.press('ArrowRight');
  await expect.poll(() => focusedCell(page)).toBe('char:1');
  await page.keyboard.press('Enter');
  await expect(page.getByTestId('status')).toContainText('pinned: character 2 of 4');
  await page.keyboard.press('c');
  await expect(page.getByTestId('status')).toContainText('copied: 灣');
  await page.keyboard.press('i');
  await expect
    .poll(() => page.evaluate(() => document.getElementById('inspector-panel')?.contains(document.activeElement)))
    .toBe(true);
  await page.keyboard.press('Escape');
  await expect.poll(() => focusedCell(page)).toBe('char:1');
});
