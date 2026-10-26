/**
 * Wave 3 integration (07 §3 wave 3; PA-3): the shell, board, pipeline rail, inspector and live-check drawer working
 * together on the real Worker, in one visit and on every project's own viewport — the default example at first paint,
 * a stop change and a scrub through the merge replay (checked against the fixture replay), the inspector following
 * board focus, a tokenizer switch, typed text tokenized live, and the drawer's xAI panel on a mocked route drawing its
 * live tier under the Grok-2 tier at stop 6. Keyboard input leaves the textarea by `blur()`, never by clicking a button
 * (WebKit does not focus buttons on click). Zero CSP violations and no uncaught page errors throughout.
 */
import { expect, test } from '@playwright/test';
import { watchPage } from '../support/page-guards.ts';
import { mockProvider, openDrawer, XAI_URL } from './byok-helpers.ts';
import { focusBoard, grid } from './board-helpers.ts';
import { checkedStop, domParts, fixtureReplay, rail, scrubber, withLookupIds } from './pipeline-helpers.ts';
import { openShell, pickTokenizer } from './shell-helpers.ts';

const TEXT = '台灣台南';
const TYPED = 'こんにちは台灣 123 abc';

/** Grok-2 on 台灣台南 (fixtures/xai-grok2.json): [0,3) 15721 · [3,5) 7489 · [5,6) 291 · [6,9) 15721 · [9,12) 12048. */
const GROK2_TOKENS = [
  { token_id: 15721, string_token: '台', token_bytes: [0xe5, 0x8f, 0xb0] },
  { token_id: 7489, string_token: '�', token_bytes: [0xe7, 0x81] },
  { token_id: 291, string_token: '�', token_bytes: [0xa3] },
  { token_id: 15721, string_token: '台', token_bytes: [0xe5, 0x8f, 0xb0] },
  { token_id: 12048, string_token: '南', token_bytes: [0xe5, 0x8d, 0x97] },
];

test('shell, board, rail, inspector and drawer work together on the live Worker', async ({ page }) => {
  const guards = await watchPage(page);
  const captured = await mockProvider(page, XAI_URL, () => ({ status: 200, body: { token_ids: GROK2_TOKENS } }));
  const status = page.getByTestId('status');
  const counts = page.getByTestId('counts');

  // First paint: the default example on o200k at stop 6, then the live result.
  await openShell(page, 'en');
  await expect(page.locator('#text-input')).toHaveValue(TEXT);
  await expect(counts).toContainText('4 tokens');
  expect(await checkedStop(page)).toBe(6);
  await expect(grid(page)).toHaveAttribute('data-stage', '6');

  // Rail: a stop change reaches the board and the status region.
  await page.keyboard.press('Digit3');
  await expect(rail(page).getByRole('radio', { name: '3 of 6: UTF-8 bytes' })).toBeChecked();
  await expect(grid(page)).toHaveAttribute('data-stage', '3');
  await expect(status).toHaveText('UTF-8 bytes: 12 bytes');

  // Scrub at stop 5: the token tier is the fixture's replay at the first and the last step.
  const replay = fixtureReplay('openai-o200k_base', 'bytelevel-bpe', 'zh-tw-tainan').map((parts) =>
    withLookupIds(parts, 'openai-o200k_base'),
  );
  const last = replay.length - 1;
  await page.keyboard.press('Digit5');
  await expect(grid(page)).toHaveAttribute('data-stage', '5');
  await scrubber(page).focus();
  await page.keyboard.press('Home');
  await expect(scrubber(page)).toHaveAttribute('aria-valuetext', new RegExp(`^step 0 / ${String(last)} · `));
  await expect.poll(async () => domParts(page)).toEqual(replay[0]);
  await page.keyboard.press('End');
  await expect(scrubber(page)).toHaveAttribute(
    'aria-valuetext',
    new RegExp(`^step ${String(last)} / ${String(last)} · `),
  );
  await expect.poll(async () => domParts(page)).toEqual(replay[last]);

  // Inspector: follows board focus.
  await focusBoard(page);
  await expect(page.locator('#board [data-inspector]')).toHaveAttribute('data-inspector', 'ready');
  await expect(page.locator('#inspector-heading')).toHaveText(/^Inspector — (character|byte|token) \d+ of \d+$/);

  // Tokenizer switch: Grok-2 answers live on the same text (5 tokens).
  await pickTokenizer(page, 'Grok-2');
  await expect(page.getByTestId('picker-button')).toContainText('Grok-2');
  await expect(page.locator('[data-source="live"]')).toBeVisible();
  await expect(counts).toContainText('5 tokens');

  // Typed text is tokenized live, then the example text typed back key by key.
  const input = page.locator('#text-input');
  await input.fill(TYPED);
  await expect(counts).toContainText('29 bytes');
  await expect(page.locator('[data-source="live"]')).toBeVisible();
  await input.fill('');
  await input.pressSequentially(TEXT);
  await expect(counts).toContainText('12 bytes');
  await expect(counts).toContainText('5 tokens');
  await expect(grid(page)).not.toHaveAttribute('data-pending', '');
  await input.blur();
  await page.keyboard.press('Digit6');
  await expect(grid(page)).toHaveAttribute('data-stage', '6');

  // Drawer: the xAI panel on a mocked route draws the live tier under the Grok-2 tier.
  await openDrawer(page);
  const panel = page.locator('[data-panel="xai-tokenize"]');
  await panel.getByTestId('xai-key').fill('xai-e2e-integration');
  await panel.getByTestId('xai-run').click();
  await expect(page.getByTestId('xai-alignment')).toHaveText('matches Grok-2 ✓ on this text');
  expect(captured).toHaveLength(1);
  expect(captured[0]?.body).toEqual({ text: TEXT, model: 'grok-4.7' });
  await expect(page.getByTestId('extra-tier').first()).toBeAttached();
  const liveIds = await page
    .locator('.lv-cell[data-first]')
    .evaluateAll((cells) => cells.map((cell) => (cell as HTMLElement).dataset['liveId']));
  expect(liveIds).toEqual(['15721', '7489', '291', '15721', '12048']);
  // The rail and the board still answer with the drawer open; collapsing the drawer takes the live tier away.
  await expect(rail(page).getByRole('radio', { name: '6 of 6: Tokens' })).toBeChecked();
  await page.getByTestId('live-check-toggle').click();
  await expect(page.getByTestId('live-check-toggle')).toHaveAttribute('aria-expanded', 'false');
  await expect(page.getByTestId('extra-tier')).toHaveCount(0);
  expect(await guards.cspViolations()).toEqual([]);
  expect(guards.pageErrors()).toEqual([]);
});
