/**
 * WP13 integration — a keyboard-only tour (05 §8, WCAG 2.1.1 / 2.4.7): textarea → example chips → tokenizer picker →
 * board (pin, inspector with `i`, back with Esc) → pipeline rail → scrubber → live-check drawer, and back to the textarea
 * with `/`, never touching the mouse. At every stop the focused element (or the child / label / rail stop that draws its
 * ring) shows a visible focus indicator; the scrubber rings its thumb pseudo-element, so there `:focus-visible` itself is
 * checked. The full per-stop ring audit is focus-visible.spec.ts; this tour proves the regions are reachable in order.
 */
import { expect, test, type Page } from '@playwright/test';
import { grid } from './board-helpers.ts';
import { checkedStop } from './pipeline-helpers.ts';
import { openShell } from './shell-helpers.ts';

/** Presses before giving up on reaching a region with Tab. */
const MAX_PRESSES = 60;

/** Where focus is and whether it is visibly indicated (box-shadow or outline on it, a child, or its label / stop). */
function focusState(page: Page): Promise<{ readonly where: string; readonly visible: boolean }> {
  return page.evaluate(() => {
    const element = document.activeElement as HTMLElement | null;
    if (element === null || element === document.body) return { where: 'body', visible: false };
    const regions: ReadonlyArray<readonly [string, string]> = [
      ['board', '[data-testid="board-grid"]'],
      ['inspector', '[data-testid="inspector-host"]'],
      ['rail', '[data-testid="pipeline"]'],
      ['dialog', 'dialog'],
      ['chips', '[role="listbox"]'],
      ['drawer', '[data-testid="live-check"]'],
    ];
    const region = regions.find(([, selector]) => element.closest(selector) !== null)?.[0] ?? 'page';
    const where = `${region}:${element.dataset['testid'] ?? element.id}:${element.getAttribute('role') ?? element.tagName.toLowerCase()}`;
    if (element.matches('input[type="range"]')) return { where, visible: element.matches(':focus-visible') };
    const host = element.parentElement?.closest('label, .stop') ?? null;
    const candidates = [element, ...element.children, ...(host === null ? [] : [host])];
    const visible = candidates.some((candidate) => {
      const style = getComputedStyle(candidate);
      if (style.opacity === '0' || style.visibility === 'hidden') return false;
      const outline = style.outlineStyle !== 'none' && Number.parseFloat(style.outlineWidth) > 0;
      return outline || (style.boxShadow !== 'none' && style.boxShadow !== '');
    });
    return { where, visible };
  });
}

/** Asserts the focus is (or arrives, after a lazy dialog opens) in `region` and is visibly indicated. */
async function expectFocus(page: Page, region: string): Promise<void> {
  await expect.poll(async () => (await focusState(page)).where.split(':')[0]).toBe(region);
  const state = await focusState(page);
  expect(state.where.startsWith(`${region}:`), `focus in ${region} (is ${state.where})`).toBe(true);
  expect(state.visible, `visible focus at ${state.where}`).toBe(true);
}

/**
 * Tabs (or Shift+Tabs) until focus is in `region` (on an element of `role`, when given), checking the indicator at every
 * stop on the way. Firefox also stops on scrollable containers (the chip row), hence the role.
 */
async function tabTo(page: Page, region: string, backwards = false, role?: string): Promise<void> {
  for (let i = 0; i < MAX_PRESSES; i++) {
    await page.keyboard.press(backwards ? 'Shift+Tab' : 'Tab');
    const state = await focusState(page);
    expect(state.visible, `visible focus at ${state.where}`).toBe(true);
    if (state.where.startsWith(`${region}:`) && (role === undefined || state.where.endsWith(`:${role}`))) return;
  }
  throw new Error(`Tab never reached ${region}`);
}

test('keyboard-only tour: textarea → chips → picker → board → rail → scrubber → inspector → drawer and back', async ({
  page,
  browserName,
}) => {
  test.skip(
    browserName === 'webkit',
    'WebKit moves Tab focus only between form fields unless "Press Tab to highlight each item" is on',
  );
  test.slow();
  await openShell(page, 'en');
  await page.locator('body').press('Slash'); // `/` focuses the textarea (a single-key shortcut, 05 §8)
  await expectFocus(page, 'page');
  expect(await page.evaluate(() => document.activeElement?.id)).toBe('text-input');

  // Chips: one tab stop, arrows move, Enter applies.
  await tabTo(page, 'chips', false, 'option');
  await page.keyboard.press('ArrowRight');
  await expectFocus(page, 'chips');
  await page.keyboard.press('Enter');
  await expect(page.locator('#text-input')).toHaveValue('臺灣');

  // Picker: `t` opens it, arrows move, Esc closes it and focus returns to where it was (the chip).
  await page.keyboard.press('KeyT');
  await expect(page.getByRole('dialog')).toBeVisible();
  await expectFocus(page, 'dialog');
  await page.keyboard.press('ArrowDown');
  await expectFocus(page, 'dialog');
  await page.keyboard.press('Escape');
  await expect(page.getByRole('dialog')).toBeHidden();
  await expectFocus(page, 'chips');

  // Forward through the input panel and the rail to the board.
  await tabTo(page, 'board');
  await expect(grid(page)).not.toHaveAttribute('data-pending', '');
  await page.keyboard.press('ArrowRight');
  await expectFocus(page, 'board');
  await page.keyboard.press('Enter'); // pin
  await expect(page.getByTestId('status')).toContainText('pinned');
  await page.keyboard.press('KeyI'); // into the inspector
  await expectFocus(page, 'inspector');
  await page.keyboard.press('Escape'); // back to the cell
  await expectFocus(page, 'board');

  // Back to the rail: arrows change the stop.
  await tabTo(page, 'rail', true);
  for (let i = 0; i < MAX_PRESSES; i++) {
    const role = (await focusState(page)).where.split(':')[2];
    if (role === 'input' && (await page.evaluate(() => (document.activeElement as HTMLInputElement).type)) === 'radio')
      break;
    await page.keyboard.press('Shift+Tab');
    await expectFocus(page, 'rail');
  }
  await page.keyboard.press('ArrowLeft');
  expect(await checkedStop(page)).toBe(5);
  // The scrubber is the rail's next stop.
  await page.keyboard.press('Tab');
  await expectFocus(page, 'rail');
  await expect(page.getByTestId('scrubber')).toBeFocused();
  await page.keyboard.press('Home');
  await expect(page.getByTestId('scrubber')).toHaveValue('0');

  // On to the live-check drawer's toggle, open it, then back to the textarea with `/`.
  for (let i = 0; i < MAX_PRESSES * 2; i++) {
    await page.keyboard.press('Tab');
    const state = await focusState(page);
    expect(state.visible, `visible focus at ${state.where}`).toBe(true);
    if (
      (await page.evaluate(() => (document.activeElement as HTMLElement | null)?.dataset['testid'])) ===
      'live-check-toggle'
    )
      break;
  }
  await expect(page.getByTestId('live-check-toggle')).toBeFocused();
  await page.keyboard.press('Enter');
  await expect(page.getByTestId('live-check-toggle')).toHaveAttribute('aria-expanded', 'true');
  await expectFocus(page, 'drawer');
  await page.keyboard.press('Slash');
  expect(await page.evaluate(() => document.activeElement?.id)).toBe('text-input');
});
