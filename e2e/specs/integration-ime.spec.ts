/**
 * WP13 integration — IME (05 §6): while a composition is open the text is provisional (the board shows the text-only
 * tiers, muted, the counts keep the last result's tokens marked "stale", and no encode is posted); the commit sends exactly one encode, for the final text, whichever order the
 * engine fires `compositionend` and the last `input` in (Chromium: input with `isComposing: true` first; Firefox/WebKit:
 * `compositionend` first, then an input with `isComposing: false`); shortcuts are ignored while composing; a paste
 * tokenizes at once, without the 40 ms debounce. Chromium also runs a real composition through CDP
 * `Input.imeSetComposition`.
 */
import { expect, test, type Page } from '@playwright/test';
import { grid } from './board-helpers.ts';
import { checkedStop } from './pipeline-helpers.ts';
import { openShell } from './shell-helpers.ts';

/**
 * Records the text of every `encode` message the page posts to the board's tokenizer Worker — the first Worker that
 * receives a message: o200k's, loaded after first paint. The other table rows' Workers (PA-19: one per tokenizer on
 * screen, loaded on the first free-text edit) get the same one encode per commit; this suite counts the board's.
 */
async function recordEncodes(page: Page): Promise<void> {
  await page.addInitScript(() => {
    const store = window as unknown as { __tsbsEncodes: string[]; __tsbsFirstWorker?: Worker };
    store.__tsbsEncodes = [];
    // eslint-disable-next-line @typescript-eslint/unbound-method -- re-invoked with .call(this) below
    const post = Worker.prototype.postMessage;
    Worker.prototype.postMessage = function (this: Worker, message: unknown, ...rest: unknown[]) {
      store.__tsbsFirstWorker ??= this;
      const encode =
        typeof message === 'object' && message !== null && (message as { type?: unknown }).type === 'encode';
      if (encode && this === store.__tsbsFirstWorker)
        store.__tsbsEncodes.push(String((message as { text?: unknown }).text));
      (post as (this: Worker, ...args: unknown[]) => void).call(this, message, ...rest);
    };
  });
}

const encodes = (page: Page): Promise<string[]> =>
  page.evaluate(() => [...(window as unknown as { __tsbsEncodes: string[] }).__tsbsEncodes]);

/** Opens the shell with an empty text, every encode so far settled. */
async function emptyShell(page: Page): Promise<number> {
  await recordEncodes(page);
  await openShell(page, 'en', { advanced: true });
  await page.locator('#text-input').fill('');
  await expect(page.getByTestId('counts')).toContainText('0 code points');
  await expect.poll(async () => (await encodes(page)).at(-1)).toBe('');
  return (await encodes(page)).length;
}

/** How long no further encode may follow once the expected ones were posted (well past the 40 ms debounce). */
const SETTLE_MS = 300;

/**
 * Asserts that the encodes posted after `from` are exactly `expected`: polls until they are (a slow runner may take
 * longer than a frame + the 40 ms debounce + the client's hop), then waits `SETTLE_MS` and checks that none followed.
 */
async function expectEncodesSince(page: Page, from: number, expected: readonly string[]): Promise<void> {
  await expect.poll(async () => (await encodes(page)).slice(from)).toEqual(expected);
  await page.waitForTimeout(SETTLE_MS);
  expect((await encodes(page)).slice(from)).toEqual(expected);
}

for (const order of ['firefox-webkit', 'chromium'] as const) {
  test(`a composition sends one encode for the committed text (${order} event order)`, async ({ page }) => {
    const from = await emptyShell(page);
    await page.locator('#text-input').evaluate((el, chromiumOrder) => {
      const input = el as HTMLTextAreaElement;
      input.focus();
      const composing = (value: string): void => {
        input.value = value;
        input.dispatchEvent(
          new InputEvent('input', {
            bubbles: true,
            isComposing: true,
            data: value,
            inputType: 'insertCompositionText',
          }),
        );
      };
      input.dispatchEvent(new CompositionEvent('compositionstart', { bubbles: true, data: '' }));
      composing('に');
      composing('にほん');
      if (chromiumOrder) {
        composing('日本');
        input.dispatchEvent(new CompositionEvent('compositionend', { bubbles: true, data: '日本' }));
      } else {
        input.value = '日本';
        input.dispatchEvent(new CompositionEvent('compositionend', { bubbles: true, data: '日本' }));
        input.dispatchEvent(
          new InputEvent('input', {
            bubbles: true,
            isComposing: false,
            data: '日本',
            inputType: 'insertCompositionText',
          }),
        );
      }
    }, order === 'chromium');
    await expect(page.getByTestId('counts')).toContainText('2 code points');
    await expect(grid(page)).not.toHaveAttribute('data-composing', '');
    await expectEncodesSince(page, from, ['日本']);
    await expect(grid(page)).not.toHaveAttribute('data-pending', '');
  });
}

test('while composing: the board shows the provisional text muted, nothing is encoded, shortcuts are ignored', async ({
  page,
}) => {
  const from = await emptyShell(page);
  await page.locator('#text-input').evaluate((el) => {
    const input = el as HTMLTextAreaElement;
    input.focus();
    input.dispatchEvent(new CompositionEvent('compositionstart', { bubbles: true, data: '' }));
    input.value = 'にほ';
    input.dispatchEvent(
      new InputEvent('input', { bubbles: true, isComposing: true, data: 'にほ', inputType: 'insertCompositionText' }),
    );
  });
  await expect(grid(page)).toHaveAttribute('data-composing', '');
  await expect(grid(page)).toHaveAttribute('data-pending', '');
  await expect(page.getByTestId('counts')).toContainText('2 code points');
  await expectEncodesSince(page, from, []);
  // A composing keydown (isComposing, key "Process" or keyCode 229) never reaches a global shortcut.
  await page.evaluate(() => {
    for (const init of [
      { key: '3', code: 'Digit3', isComposing: true },
      { key: 'Process', code: 'Digit3' },
      { key: 'Enter', code: 'Enter', isComposing: true },
    ])
      document.body.dispatchEvent(new KeyboardEvent('keydown', { ...init, bubbles: true, cancelable: true }));
  });
  expect(await checkedStop(page)).toBe(6);
});

test('a paste tokenizes at once; typing waits for the 40 ms debounce', async ({ page }) => {
  const from = await emptyShell(page);
  const counts = await page.locator('#text-input').evaluate(async (el) => {
    const input = el as HTMLTextAreaElement;
    const posted = (): number => (window as unknown as { __tsbsEncodes: string[] }).__tsbsEncodes.length;
    // One macrotask (≈ 1 ms) is far below the 40 ms debounce; the client posts after a microtask hop.
    const tick = (): Promise<void> => new Promise((resolve) => setTimeout(resolve, 0));
    const before = posted();
    input.value = 'typed';
    input.dispatchEvent(new InputEvent('input', { bubbles: true, data: 'typed', inputType: 'insertText' }));
    await tick();
    const afterTyping = posted();
    input.value = 'pasted';
    input.dispatchEvent(new InputEvent('input', { bubbles: true, data: 'pasted', inputType: 'insertFromPaste' }));
    await tick();
    return [before, afterTyping, posted()];
  });
  expect(counts[1]).toBe(counts[0]); // debounced
  expect(counts[2]).toBe((counts[0] ?? 0) + 1); // immediate
  await expectEncodesSince(page, from, ['pasted']);
});

test('a real IME composition through CDP Input.imeSetComposition (chromium)', async ({ page, browserName }) => {
  test.skip(browserName !== 'chromium', 'CDP is chromium only; the other engines run the event-order sequences above');
  const from = await emptyShell(page);
  await page.locator('#text-input').focus();
  const cdp = await page.context().newCDPSession(page);
  await cdp.send('Input.imeSetComposition', { text: 'に', selectionStart: 1, selectionEnd: 1 });
  await expect(grid(page)).toHaveAttribute('data-composing', '');
  await cdp.send('Input.imeSetComposition', { text: 'にほん', selectionStart: 3, selectionEnd: 3 });
  await expect(page.getByTestId('counts')).toContainText('3 code points');
  // Not "waiting for the tokenizer": the last result's tokens stay, marked stale, until the commit is tokenized.
  await expect(page.getByTestId('tokens-pending')).toHaveCount(0);
  await expect(page.getByTestId('stale-badge')).toBeVisible();
  await expectEncodesSince(page, from, []);
  await cdp.send('Input.insertText', { text: '日本' });
  await expect(page.locator('#text-input')).toHaveValue('日本');
  await expect(grid(page)).not.toHaveAttribute('data-composing', '');
  await expectEncodesSince(page, from, ['日本']);
  await expect(grid(page)).not.toHaveAttribute('data-pending', '');
  await expect(page.getByTestId('counts')).toContainText('2 code points');
  await expect(page.getByTestId('stale-badge')).toHaveCount(0);
});
