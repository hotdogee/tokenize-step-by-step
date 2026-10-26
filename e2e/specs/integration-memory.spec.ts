/**
 * WP13 integration — the AD-27 memory rule on the real Worker (desktop chromium, CDP): the main thread never keeps a
 * whole-text result it no longer shows. The probe forces a GC (`HeapProfiler.collectGarbage`) and reads the page's
 * `backingStorageSize` (`Runtime.getHeapUsage`: the bytes behind its ArrayBuffers and external strings; the Worker's
 * heap is its own and not counted). `Runtime.queryObjects` cannot do this: Blink hides objects with embedder fields
 * (ArrayBuffers, typed arrays) from it. The spec checks:
 *
 * - a 150,000-code-point zh-TW run is visible to the probe (the sanity check: well over 8 MB of typed arrays);
 * - while the next run over a capped text is in flight, the previous result is already released;
 * - after the text goes back to 4 characters, neither whole-text run is held next to the short live result.
 */
import { expect, test, type CDPSession, type Page } from '@playwright/test';
import type { TiktokenFixtureCase } from '@tsbs/core';
import { grid } from './board-helpers.ts';
import { fixture } from './pipeline-helpers.ts';
import { openShell } from './shell-helpers.ts';

/** On-demand runs over 150,000–200,000 code points take a few seconds on a loaded CI runner. */
const RUN_TIMEOUT_MS = 60_000;
const MB = 1024 * 1024;
/**
 * What the page may hold above its baseline once no whole-text result is kept: the board's window slices and views,
 * and the long texts themselves (the textarea's and the last run's, external UTF-16 strings of up to 400 KB each).
 */
const KEPT_LIMIT = 3 * MB;

test.skip(() => test.info().project.name !== 'chromium', 'desktop chromium: the CDP heap probe');

/** Bytes behind the page's ArrayBuffers (and external strings) after a forced GC. */
async function backingBytes(cdp: CDPSession): Promise<number> {
  await cdp.send('HeapProfiler.collectGarbage');
  const usage = (await cdp.send('Runtime.getHeapUsage')) as { readonly backingStorageSize?: number };
  if (usage.backingStorageSize === undefined) throw new Error('Runtime.getHeapUsage has no backingStorageSize');
  return usage.backingStorageSize;
}

/** Sets the whole text (one input event) and waits for the counts line to show its code points. */
async function setText(page: Page, text: string, codePoints: string): Promise<void> {
  await page.locator('#text-input').fill(text);
  await expect(page.getByTestId('counts')).toContainText(`${codePoints} code points`);
}

test('the main thread releases a whole-text result before the next run and after a short text (AD-27)', async ({
  page,
}) => {
  test.slow();
  const paragraph = fixture('openai-o200k_base').cases.find((c) => c.name === 'zh-tw-paragraph') as
    TiktokenFixtureCase | undefined;
  if (paragraph === undefined) throw new Error('no zh-tw-paragraph case');
  const copy = `${paragraph.text}1`;
  const copyCodePoints = Array.from(copy).length; // code points
  const copies = (codePoints: number): string => copy.repeat(Math.ceil(codePoints / copyCodePoints));

  await openShell(page, 'en');
  const cdp = await page.context().newCDPSession(page);
  const baseline = await backingBytes(cdp);

  // A 150,000-code-point run on screen as its window.
  const long = copies(150_000);
  await setText(page, long, Array.from(long).length.toLocaleString('en-US'));
  await page.getByTestId('long-input-run').click();
  await expect(grid(page)).toHaveAttribute('data-window', /^\d+-\d+$/, { timeout: RUN_TIMEOUT_MS });
  const held = (await backingBytes(cdp)) - baseline;
  expect(held, 'the probe sees the whole-text result').toBeGreaterThan(8 * MB);

  // The next run (a capped text): the previous result is released before the Worker answers.
  await setText(page, copies(210_000), '200,000');
  const run = page.getByTestId('long-input-run');
  await run.click();
  const during = (await backingBytes(cdp)) - baseline;
  if ((await run.getAttribute('aria-busy')) === 'true')
    expect(during, 'nothing of the previous run is held while the next one is in flight').toBeLessThan(KEPT_LIMIT);
  else test.info().annotations.push({ type: 'note', description: 'the capped run ended before the probe finished' });
  await expect(run).toHaveAttribute('aria-busy', 'false', { timeout: RUN_TIMEOUT_MS });
  await expect(grid(page)).not.toHaveAttribute('data-pending', '');

  // Back to a short text: the short live result alone.
  await setText(page, '熱鬧台南', '4');
  await expect(grid(page)).not.toHaveAttribute('data-window');
  await expect(grid(page)).not.toHaveAttribute('data-pending', '');
  await expect(page.locator('[data-source="live"]')).toBeVisible();
  const after = (await backingBytes(cdp)) - baseline;
  expect(after, 'no whole-text result is held next to the short one').toBeLessThan(KEPT_LIMIT);
});
