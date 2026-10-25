/**
 * Pipeline keyboard (05 §8, AD-22) on the real Worker: `[` `]` move between stops and `1`–`6` jump, each stop announced
 * as "3 of 6: UTF-8 bytes" (the radio's name) with the status region's "UTF-8 bytes: 12 bytes"; `,` `.` step one merge
 * and `Shift` steps ten (matched by `event.code`), past the end to stop 6 and before the start to stop 4, saying the merge
 * sentence; Space plays and pauses on the scrubber only; Home/End go to the first/last step; arrows move the rail's
 * radios; and with "Single-key shortcuts: off" every global key is inert while the rail's own keys keep working.
 */
import { expect, test, type Page } from '@playwright/test';
import { chooseExample, grid } from './board-helpers.ts';
import { checkedStop, rail, scrubber } from './pipeline-helpers.ts';
import { openShell } from './shell-helpers.ts';

const status = (page: Page) => page.getByTestId('status');

test('[ and ] move between stops; 1–6 jump; each stop is announced', async ({ page }) => {
  await openShell(page, 'en');
  expect(await checkedStop(page)).toBe(6);
  await page.keyboard.press('BracketLeft');
  await expect(page.getByRole('radio', { name: '5 of 6: Merges' })).toBeChecked();
  await expect(status(page)).toHaveText('Merges: 4 tokens');
  await page.keyboard.press('BracketLeft');
  await page.keyboard.press('BracketLeft');
  await expect(page.getByRole('radio', { name: '3 of 6: UTF-8 bytes' })).toBeChecked();
  await expect(grid(page)).toHaveAttribute('data-stage', '3');
  await expect(status(page)).toHaveText('UTF-8 bytes: 12 bytes');
  await page.keyboard.press('BracketRight');
  await expect(page.getByRole('radio', { name: '4 of 6: Chunks' })).toBeChecked();
  for (const [key, name] of [
    ['Digit1', '1 of 6: Text'],
    ['Digit2', '2 of 6: Code points'],
    ['Digit6', '6 of 6: Tokens'],
    ['Digit3', '3 of 6: UTF-8 bytes'],
  ] as const) {
    await page.keyboard.press(key);
    await expect(page.getByRole('radio', { name })).toBeChecked();
  }
  await page.keyboard.press('Digit1');
  await page.keyboard.press('BracketLeft'); // no stop before 1
  expect(await checkedStop(page)).toBe(1);
  await expect(rail(page).getByRole('radiogroup', { name: 'pipeline stage' })).toBeVisible();
});

test(', and . step one merge, Shift steps ten, and the merge sentence is announced', async ({ page }) => {
  await openShell(page, 'en');
  await chooseExample(page, 'ja-shibuya-ramen'); // 30 merges on o200k
  await expect(page.locator('[data-source="live"]')).toBeVisible();
  await page.keyboard.press('Digit3');
  await page.keyboard.press('Period'); // from stop 3: stop 5, step 0
  await expect(grid(page)).toHaveAttribute('data-stage', '5');
  await expect(scrubber(page)).toHaveValue('0');
  await expect(status(page)).toHaveText('step 0 / 30 · no merges yet');
  await page.keyboard.press('Period');
  await expect(scrubber(page)).toHaveValue('1');
  await expect(status(page)).toHaveText(
    /^step 1 \/ 30 · [0-9A-F]{2}( [0-9A-F]{2})* \+ [0-9A-F]{2}( [0-9A-F]{2})* → \d+ \(.+\)$/,
  );
  await page.keyboard.press('Shift+Period');
  await expect(scrubber(page)).toHaveValue('11');
  await page.keyboard.press('Shift+Period');
  await expect(scrubber(page)).toHaveValue('21');
  await page.keyboard.press('Shift+Comma');
  await expect(scrubber(page)).toHaveValue('11');
  await expect(status(page)).toHaveText(/^step 11 \/ 30 · /);
  await page.keyboard.press('Shift+Period');
  await page.keyboard.press('Shift+Period'); // 31 > 30: past the end → stop 6
  await expect(grid(page)).toHaveAttribute('data-stage', '6');
  await page.keyboard.press('Shift+Comma'); // stop 6 counts as one past the last step (AppState.moveStep)
  await expect(grid(page)).toHaveAttribute('data-stage', '5');
  await expect(scrubber(page)).toHaveValue('21');
  await page.keyboard.press('End'); // not on the scrubber: nothing
  await scrubber(page).focus();
  await page.keyboard.press('End');
  await expect(scrubber(page)).toHaveValue('30');
  await page.keyboard.press('Period'); // past the end → stop 6
  await expect(grid(page)).toHaveAttribute('data-stage', '6');
  await page.keyboard.press('Comma'); // back from stop 6 → stop 5 at the last step
  await expect(grid(page)).toHaveAttribute('data-stage', '5');
  await expect(scrubber(page)).toHaveValue('30');
  await page.keyboard.press('Home');
  await expect(scrubber(page)).toHaveValue('0');
  await page.keyboard.press('Comma'); // before the start → stop 4
  await expect(grid(page)).toHaveAttribute('data-stage', '4');
});

test('Space plays and pauses on the scrubber only; Home/End are the first and last step', async ({ page }) => {
  await openShell(page, 'en');
  const play = page.getByTestId('play');
  await scrubber(page).focus();
  await page.keyboard.press('Home');
  await expect(grid(page)).toHaveAttribute('data-stage', '5');
  await expect(scrubber(page)).toHaveValue('0');
  await page.keyboard.press('Space');
  await expect(play).toHaveAttribute('aria-pressed', 'true');
  await expect.poll(async () => Number(await scrubber(page).inputValue())).toBeGreaterThan(0);
  await page.keyboard.press('Space');
  await expect(play).toHaveAttribute('aria-pressed', 'false');
  const paused = await scrubber(page).inputValue();
  await page.waitForTimeout(600);
  await expect(scrubber(page)).toHaveValue(paused);
  await page.keyboard.press('End');
  await expect(scrubber(page)).toHaveValue('8');
  // Space anywhere else (a radio of the rail) does not play.
  await page.getByRole('radio', { name: '5 of 6: Merges' }).focus();
  await page.keyboard.press('Space');
  await expect(play).toHaveAttribute('aria-pressed', 'false');
  // Play from the end restarts and runs to the end on its own.
  await play.click();
  await expect(play).toHaveAttribute('aria-pressed', 'true');
  await expect(play).toHaveAttribute('aria-pressed', 'false', { timeout: 8000 });
  await expect(scrubber(page)).toHaveValue('8');
});

test('"Single-key shortcuts: off" makes [ ] , . 1–6 inert while the rail keys keep working', async ({ page }) => {
  await page.addInitScript(() => {
    try {
      localStorage.setItem('tsbs:singleKeyShortcuts', 'false');
    } catch {
      // storage blocked: the test would fail on the first key below
    }
  });
  await openShell(page, 'en');
  await page.locator('body').click({ position: { x: 2, y: 2 } });
  for (const key of ['BracketLeft', 'BracketRight', 'Comma', 'Period', 'Shift+Period', 'Digit3', 'Digit1']) {
    await page.keyboard.press(key);
    await expect(grid(page)).toHaveAttribute('data-stage', '6');
  }
  expect(await checkedStop(page)).toBe(6);
  await page.getByRole('radio', { name: '6 of 6: Tokens' }).focus();
  await page.keyboard.press('ArrowLeft');
  await expect(page.getByRole('radio', { name: '5 of 6: Merges' })).toBeChecked();
  await scrubber(page).focus();
  await page.keyboard.press('Home');
  await expect(scrubber(page)).toHaveValue('0');
  await page.keyboard.press('ArrowRight');
  await expect(scrubber(page)).toHaveValue('1');
  await page.keyboard.press('Space');
  await expect(page.getByTestId('play')).toHaveAttribute('aria-pressed', 'true');
  await page.keyboard.press('Space');
  await expect(page.getByTestId('play')).toHaveAttribute('aria-pressed', 'false');
});
