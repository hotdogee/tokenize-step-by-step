/**
 * WP13 integration — long input tiers (AD-27, binding; 05 §6) on the real Worker:
 *
 * - at 20,001 code points live tokenization pauses behind the "Long input — tokenize on demand" banner; the counts keep
 *   code points live and point at "Tokenize now" for the tokens; the on-demand run tokenizes the WHOLE text (a run past 50,000 merge steps says "merge replay limited
 *   to the first 50,000 steps"); an edit after the run marks the tokens "stale", and they stay stale through a tokenizer
 *   switch and back (the run's text still differs);
 * - the board is a 2,000-byte window of the whole-text result: built from 50 copies of the o200k zh-TW paragraph (each copy
 *   chunks exactly as the fixture case, a "1" between copies), the token ids at both window edges equal the fixture's;
 * - above 100,000 code points the run records no timeline (the rail says so, in the capped tier too); at 200,001 code
 *   points the cap banner shows and the textarea keeps every code point;
 * - a run asked for while the tokenizer loads is dropped when the text gets short again: the load encodes the short text.
 */
import { expect, test, type Page, type Route } from '@playwright/test';
import type { TiktokenFixtureCase } from '@tsbs/core';
import { grid } from './board-helpers.ts';
import { fixture } from './pipeline-helpers.ts';
import { LIVE_READY_TIMEOUT_MS, openAdvanced, openShell, pickTokenizer } from './shell-helpers.ts';

/** On-demand runs over 60,000–200,000 code points take a few seconds on a loaded CI runner. */
const RUN_TIMEOUT_MS = 60_000;

const banner = (page: Page) => page.getByTestId('long-input-banner');
const counts = (page: Page) => page.getByTestId('counts');

/** Sets the whole text (one input event) and waits for the counts line to show its code points. */
async function setText(page: Page, text: string, codePoints: string): Promise<void> {
  await page.locator('#text-input').fill(text);
  await expect(counts(page)).toContainText(`${codePoints} code points`);
}

/** Clicks "Tokenize now" and waits for the window of the run's result on the board. */
async function runOnDemand(page: Page): Promise<void> {
  await page.getByTestId('long-input-run').click();
  await expect(grid(page)).toHaveAttribute('data-window', /^\d+-\d+$/, { timeout: RUN_TIMEOUT_MS });
  await expect(grid(page)).not.toHaveAttribute('data-pending', '');
}

/** Token ids of the mounted token cells, by token index (from each cell's label). */
async function mountedIds(page: Page): Promise<Map<number, number>> {
  const cells = await grid(page)
    .locator('[data-tier="token"][data-first]')
    .evaluateAll((elements) =>
      elements.map((el) => [Number(el.getAttribute('data-index')), el.getAttribute('aria-label') ?? ''] as const),
    );
  return new Map(cells.map(([index, label]) => [index, Number(/\bid (\d+)/.exec(label)?.[1] ?? Number.NaN)]));
}

test('20,001 code points: the on-demand banner, a whole-text run, the 50,000-step replay cap and the stale badge', async ({
  page,
}) => {
  test.slow();
  await openShell(page, 'en', { advanced: true });
  await setText(page, 'a'.repeat(20_000), '20,000');
  await expect(banner(page)).toHaveCount(0);
  await setText(page, 'a'.repeat(20_001), '20,001');
  await expect(banner(page)).toBeVisible();
  await expect(banner(page)).toContainText('Long input — tokenize on demand');
  await expect(page.getByTestId('status')).toHaveText('Long input — tokenize on demand'); // said once, 05 §6
  await expect(page.getByTestId('cap-banner')).toHaveCount(0);
  // The tokenizer is resident: the tokens wait for the banner's button, and the counts line says so.
  await expect(page.getByTestId('tokens-pending')).toHaveText('tokens: press “Tokenize now”');

  // 60,000 letters are one chunk with well over 50,000 merges: the run records the first 50,000.
  await setText(page, 'a'.repeat(60_000), '60,000');
  await runOnDemand(page);
  await expect(page.getByTestId('stale-badge')).toHaveCount(0);
  await expect(counts(page)).toContainText('60,000 bytes');
  await expect(counts(page)).toContainText(/\d tokens/);
  await expect(page.getByTestId('scope-status')).toContainText('merge replay limited to the first 50,000 steps');
  const tokens = (await counts(page).textContent()) ?? '';

  // An edit: code points stay live, the tokens are the last run's, marked stale.
  await page.locator('#text-input').press('End');
  await page.keyboard.type('b');
  await expect(counts(page)).toContainText('60,001 code points');
  await expect(page.getByTestId('stale-badge')).toBeVisible();
  expect((await counts(page).textContent()) ?? '').toContain(/(\d[\d,]*) tokens/.exec(tokens)?.[0] ?? '?');
  await expect(grid(page)).toHaveAttribute('data-pending', '');

  // Away to cl100k (no run there: the tokens wait for the button) and back: the o200k run's tokens are still not the
  // text's, so they come back marked stale.
  const runTokens = /[0-9][0-9,]* tokens/.exec(tokens)?.[0] ?? '?';
  await pickTokenizer(page, 'cl100k_base');
  await expect(page.getByTestId('tokens-pending')).toHaveText('tokens: press “Tokenize now”', {
    timeout: LIVE_READY_TIMEOUT_MS,
  });
  await pickTokenizer(page, 'o200k_base');
  await expect(page.getByTestId('stale-badge')).toBeVisible({ timeout: LIVE_READY_TIMEOUT_MS });
  await expect(counts(page)).toContainText(runTokens);
  await expect(counts(page)).toContainText('60,001 code points');
});

test('the board is a window of the whole-text result: ids at both window edges equal the fixture', async ({ page }) => {
  test.slow();
  const paragraph = fixture('openai-o200k_base').cases.find((c) => c.name === 'zh-tw-paragraph') as
    TiktokenFixtureCase | undefined;
  if (paragraph === undefined) throw new Error('no zh-tw-paragraph case');
  const copies = 50;
  const text = `${paragraph.text}1`.repeat(copies);
  const copyBytes = paragraph.utf8Len + 1;
  /** The whole text's tokens: each copy is the fixture's tokens, then the "1" (id not asserted). */
  const expected: Array<{ readonly start: number; readonly end: number; readonly id: number | null }> = [];
  for (let k = 0; k < copies; k++) {
    for (const token of paragraph.tokens)
      expected.push({ start: k * copyBytes + token.start, end: k * copyBytes + token.end, id: token.id });
    expected.push({ start: k * copyBytes + paragraph.utf8Len, end: (k + 1) * copyBytes, id: null });
  }

  await openShell(page, 'en', { advanced: true });
  await setText(page, text, '20,800');
  await expect(banner(page)).toBeVisible();
  // The caret in the middle of copy 25: the window is cut around it.
  const caret = 25 * `${paragraph.text}1`.length + 100; // UTF-16 offset (the paragraph is BMP-only)
  await page.locator('#text-input').evaluate((el, at) => {
    const input = el as HTMLTextAreaElement;
    input.focus();
    input.setSelectionRange(at, at);
  }, caret);
  await page.keyboard.press('ArrowRight');
  await page.keyboard.press('ArrowLeft');
  await runOnDemand(page);
  const [start, end] = ((await grid(page).getAttribute('data-window')) ?? '').split('-').map(Number);
  if (start === undefined || end === undefined) throw new Error('no window');
  expect(end - start).toBeGreaterThanOrEqual(2000);
  expect(start).toBeGreaterThan(20 * copyBytes);
  expect(end).toBeLessThan(30 * copyBytes);
  const first = expected.findIndex((token) => token.start === start);
  const last = expected.findIndex((token) => token.end === end);
  expect(first, 'the window starts on a whole-text token boundary').toBeGreaterThanOrEqual(0);
  expect(last, 'the window ends on a whole-text token boundary').toBeGreaterThan(first);

  // Window start: the first rows of the board.
  await grid(page).evaluate((el) => {
    el.scrollIntoView({ block: 'start' });
  });
  /**
   * Waits for the board's window to reach `indices`, a frame or two after the scroll: their count, not one token's
   * presence, since the board keeps the row of its focus cell mounted wherever the window is, and that is token 0's row.
   */
  const reached = async (indices: readonly number[]): Promise<void> => {
    await expect
      .poll(async () => {
        const ids = await mountedIds(page);
        return indices.filter((i) => ids.has(i)).length;
      })
      .toBeGreaterThanOrEqual(3);
  };
  /** Compares the mounted tokens among `indices` (a narrow phone mounts fewer) with the whole-text tokens. */
  const compare = (ids: Map<number, number>, indices: readonly number[], edge: string): void => {
    const mounted = indices.filter((i) => ids.has(i));
    expect(mounted.length, `tokens mounted at the window ${edge}`).toBeGreaterThanOrEqual(3);
    for (const i of mounted) {
      const want = expected[first + i];
      if (want !== undefined && want.id !== null)
        expect(ids.get(i), `token ${String(i)} at the window ${edge}`).toBe(want.id);
    }
  };
  const startTokens = Array.from({ length: 12 }, (_, i) => i);
  await reached(startTokens);
  compare(await mountedIds(page), startTokens, 'start');
  // Window end: the last rows.
  const count = last - first + 1;
  await grid(page).evaluate((el) => {
    el.scrollIntoView({ block: 'end' });
  });
  const endTokens = Array.from({ length: 12 }, (_, i) => count - 12 + i);
  await reached(endTokens);
  compare(await mountedIds(page), endTokens, 'end');
  await expect(counts(page)).toContainText(`${expected.length.toLocaleString('en-US')} tokens`);
});

test('above 100,000 code points the run records no timeline; 200,001 shows the cap banner and keeps the text', async ({
  page,
}) => {
  test.slow();
  await openShell(page, 'en', { advanced: true });
  await setText(page, 'b'.repeat(100_001), '100,001');
  await runOnDemand(page);
  await expect(page.getByTestId('scope-status')).toContainText(
    'merge replay is not recorded above 100,000 code points',
  );
  await expect(page.getByTestId('scrubber')).toBeDisabled();

  const capped = 'c'.repeat(200_001);
  await page.locator('#text-input').fill(capped);
  await expect(page.getByTestId('cap-banner')).toBeVisible();
  await expect(page.getByTestId('cap-banner')).toContainText('Only the first 200,000 code points are analysed');
  await expect(counts(page)).toContainText('200,000 code points');
  expect(await page.locator('#text-input').evaluate((el) => (el as HTMLTextAreaElement).value.length)).toBe(200_001);
  await runOnDemand(page);
  await expect(counts(page)).toContainText('200,000 bytes');
  // The capped tier is an on-demand tier: its untraced run says why the replay is off.
  await expect(page.getByTestId('scope-status')).toContainText(
    'merge replay is not recorded above 100,000 code points',
  );
  await expect(page.getByTestId('scrubber')).toBeDisabled();
});

test('a run asked for while the tokenizer loads is dropped once the text is short: the load encodes the short text', async ({
  page,
}) => {
  const held: Route[] = [];
  let holding = true;
  await page.route('**/tok/**', async (route) => {
    if (holding) held.push(route);
    else await route.continue();
  });
  await page.goto('/?lang=en');
  // The vocabulary is held, so the live board never signals readiness: wait for hydration itself before typing, or the
  // fill races main.ts's hydration task (which rewrites the textarea) and the typed text lands after the default example.
  await expect(page.locator('#app')).toHaveAttribute('data-boot', /^(hydrated|mounted)$/);
  await openAdvanced(page);
  await setText(page, '台'.repeat(25_000), '25,000');
  await page.getByTestId('long-input-run').click();
  await expect(page.getByTestId('long-input-run')).toHaveAttribute('aria-busy', 'true');
  await expect.poll(() => held.length, { message: 'the vocabulary download is held' }).toBeGreaterThan(0);
  await setText(page, 'abc', '3');
  await expect(banner(page)).toHaveCount(0);

  holding = false;
  for (const route of held.splice(0)) await route.continue();
  await expect(page.locator('#advanced [data-source="live"]')).toBeVisible({ timeout: LIVE_READY_TIMEOUT_MS });
  await expect(page.getByTestId('tokens-pending')).toHaveCount(0);
  await expect(grid(page)).not.toHaveAttribute('data-pending', '');

  // A long text again waits for the button, which is free (not stuck "tokenizing").
  await setText(page, '台'.repeat(25_000), '25,000');
  await expect(page.getByTestId('long-input-run')).toHaveAttribute('aria-busy', 'false');
  await expect(page.getByTestId('tokens-pending')).toHaveText('tokens: press “Tokenize now”');
});
