/**
 * Motion on the real page (05 §7), chromium (the stop 2→3 morph's frame budget is pipeline-trace.spec.ts):
 *
 * - fast scrubbing cancels the running FLIP and only crossfades, so `document.getAnimations()` drains;
 * - with `prefers-reduced-motion: reduce` no animation touches `transform`, opacity swaps stay ≤ 150 ms, every
 *   programmatic scroll uses `behavior: 'auto'` and the picker's loading bar has no transition;
 * - a byte-view switch is a View Transition where the engine has `document.startViewTransition`, and an opacity fade of
 *   the board under a Firefox 143 user agent without it (Firefox < 144 has no View Transitions).
 */
import { expect, test, type Page } from '@playwright/test';
import { chooseExample, grid } from './board-helpers.ts';
import { motionReady, scrubber } from './pipeline-helpers.ts';
import { openShell, pickTokenizer } from './shell-helpers.ts';

test.skip(({ browserName }) => browserName !== 'chromium', 'chromium: tracing, CDP and the View Transition stand-in');

interface LoggedAnimation {
  readonly target: string;
  readonly props: readonly string[];
  readonly duration: number;
}

/** Logs every `Element.animate` (target classes / id, animated properties, duration) and every `scrollIntoView`. */
async function instrument(page: Page): Promise<void> {
  await page.addInitScript(() => {
    const store = window as unknown as Record<string, unknown[]>;
    const animations: unknown[] = [];
    const scrolls: unknown[] = [];
    store['__tsbsAnimations'] = animations;
    store['__tsbsScrolls'] = scrolls;
    // eslint-disable-next-line @typescript-eslint/unbound-method -- re-invoked with .call(this) below
    const animate = Element.prototype.animate;
    Element.prototype.animate = function (
      this: Element,
      keyframes: Keyframe[] | PropertyIndexedKeyframes | null,
      options?: number | KeyframeAnimationOptions,
    ): Animation {
      const frames = Array.isArray(keyframes) ? keyframes : keyframes === null ? [] : [keyframes];
      const props = [...new Set(frames.flatMap((frame) => Object.keys(frame)))].filter((k) => k !== 'offset');
      const duration = typeof options === 'number' ? options : Number(options?.duration ?? 0);
      animations.push({ target: `${this.id} ${String(this.getAttribute('class'))}`, props, duration });
      return animate.call(this, keyframes, options);
    };
    // eslint-disable-next-line @typescript-eslint/unbound-method -- re-invoked with .call(this) below
    const scrollIntoView = Element.prototype.scrollIntoView;
    Element.prototype.scrollIntoView = function (this: Element, arg?: boolean | ScrollIntoViewOptions): void {
      scrolls.push(arg ?? null);
      scrollIntoView.call(this, arg);
    };
  });
}

const logged = (page: Page): Promise<LoggedAnimation[]> =>
  page.evaluate(() => (window as unknown as Record<string, LoggedAnimation[]>)['__tsbsAnimations'] ?? []);

/** Waits until a stage change's animations (they start a few frames after the commit) have started and finished. */
async function drained(page: Page): Promise<void> {
  await page.evaluate(
    () =>
      new Promise<void>((resolve) => {
        let n = 0;
        const tick = (): void => {
          if (++n >= 4) resolve();
          else requestAnimationFrame(tick);
        };
        requestAnimationFrame(tick);
      }),
  );
  await expect.poll(() => page.evaluate(() => document.getAnimations().length), { timeout: 5000 }).toBe(0);
}

test('fast scrubbing cancels the running FLIP and only crossfades; the animations drain', async ({ page }) => {
  await openShell(page, 'en');
  await chooseExample(page, 'ja-text'); // 18 merges over at most 3 rows, so the merged chips are on screen
  await expect(page.locator('[data-source="live"]')).toBeVisible();
  await motionReady(page);
  // Rail and board on screen together (only rows in the viewport take part in a FLIP).
  await scrubber(page).evaluate((el) => {
    el.scrollIntoView({ block: 'start' });
  });
  await scrubber(page).focus();
  await page.keyboard.press('Home');
  await drained(page);
  await page.waitForTimeout(150);
  await page.keyboard.press('ArrowRight'); // one step: a FLIP
  const flipping = await page.evaluate(
    () =>
      document
        .getAnimations()
        .filter((a) => (a.effect as KeyframeEffect).getKeyframes().some((frame) => 'transform' in frame)).length,
  );
  expect(flipping).toBeGreaterThan(0);
  // One jump of 17 steps: a fast scrub by its size alone (> 1 step), however slowly the runner delivers the key.
  await page.keyboard.press('End');
  const state = await page.evaluate(() => {
    const all = document.getAnimations();
    return {
      transforms: all.filter((a) => (a.effect as KeyframeEffect).getKeyframes().some((frame) => 'transform' in frame))
        .length,
      longest: Math.max(0, ...all.map((a) => Number(a.effect?.getTiming().duration ?? 0))),
    };
  });
  expect(state.transforms).toBe(0);
  expect(state.longest).toBeLessThanOrEqual(80);
  await expect(scrubber(page)).toHaveValue('18');
  await page.waitForTimeout(150);
  expect(await page.evaluate(() => document.getAnimations().length)).toBe(0);
});

test('reduced motion: no transform animations, opacity swaps ≤ 150 ms, scrolls with behavior "auto", no bar transition', async ({
  page,
}) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await instrument(page);
  await openShell(page, 'en');
  await chooseExample(page, 'ja-shibuya-ramen');
  await expect(page.locator('[data-source="live"]')).toBeVisible();
  await motionReady(page);
  await expect(page.getByTestId('reduce-motion')).toBeChecked();
  // Only rows in the viewport take part in a stage change, and at 320 px (or with wide fonts) the board starts below
  // the fold: bring its first row on screen through the protocol (not Element.scrollIntoView, which `instrument` logs).
  await grid(page).locator('.bd-row').first().scrollIntoViewIfNeeded();
  for (const key of ['Digit1', 'Digit2', 'Digit3', 'Digit4', 'Digit5']) {
    await page.keyboard.press(key);
    await page.waitForTimeout(150);
  }
  for (let i = 0; i < 4; i++) {
    await page.keyboard.press('Period');
    await page.waitForTimeout(150);
  }
  await page.keyboard.press('Digit6');
  // A stage change's opacity swaps start after the next paint: read the log once they have.
  await expect.poll(async () => (await logged(page)).length).toBeGreaterThan(0);
  const animations = await logged(page);
  expect(animations.filter((a) => a.props.includes('transform'))).toEqual([]);
  expect(Math.max(...animations.map((a) => a.duration))).toBeLessThanOrEqual(150);
  const scrolls = await page.evaluate(() => (window as unknown as Record<string, unknown[]>)['__tsbsScrolls'] ?? []);
  expect(scrolls.length).toBeGreaterThan(0); // follow mode kept the merged part in view
  for (const options of scrolls) expect(options).toMatchObject({ behavior: 'auto' });

  await page.route('**/tok/google-gemma4/**', async (route) => {
    await new Promise((resolve) => setTimeout(resolve, 1500)); // keep the loading bar on screen
    await route.continue();
  });
  await pickTokenizer(page, 'Gemma 4');
  const bar = page.locator('[role="progressbar"]');
  await expect(bar).toBeAttached(); // scaleX(0) until the first bytes arrive
  expect(await bar.evaluate((el) => getComputedStyle(el).transitionDuration)).toBe('0s');
});

test('a byte-view switch is a View Transition when the engine has one', async ({ page }) => {
  await page.addInitScript(() => {
    const store = window as unknown as Record<string, number>;
    store['__tsbsTransitions'] = 0;
    // eslint-disable-next-line @typescript-eslint/unbound-method -- re-invoked with .apply(this) below
    const start = Document.prototype.startViewTransition;
    Document.prototype.startViewTransition = function (this: Document, ...args: Parameters<typeof start>) {
      store['__tsbsTransitions'] = (store['__tsbsTransitions'] ?? 0) + 1;
      return start.apply(this, args);
    };
  });
  await openShell(page, 'en');
  // The precomputed → live swap at startup is a crossfade of its own (WP13, 05 §12): count from here.
  await page.evaluate(() => {
    (window as unknown as Record<string, number>)['__tsbsTransitions'] = 0;
  });
  await page.keyboard.press('KeyH');
  await expect(grid(page).locator('[data-tier="dec"]').first()).toBeVisible();
  expect(await page.evaluate(() => (window as unknown as Record<string, number>)['__tsbsTransitions'])).toBe(1);
});

test.describe('Firefox 143 (no View Transitions)', () => {
  test.use({ userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:143.0) Gecko/20100101 Firefox/143.0' });

  test('a byte-view switch falls back to an opacity fade of the board', async ({ page }) => {
    await page.addInitScript(() => {
      // The engine of Firefox < 144: no document.startViewTransition at all.
      delete (Document.prototype as unknown as { startViewTransition?: unknown }).startViewTransition;
    });
    await instrument(page);
    const errors: string[] = [];
    page.on('pageerror', (error) => errors.push(error.message));
    await openShell(page, 'en');
    expect(await page.evaluate(() => navigator.userAgent)).toContain('Firefox/143.0');
    expect(await page.evaluate(() => 'startViewTransition' in document)).toBe(false);
    // The precomputed → live swap at startup fades the board too (WP13, 05 §12): count the switch's own fade only.
    const before = (await logged(page)).length;
    await page.keyboard.press('KeyH');
    await expect(grid(page).locator('[data-tier="dec"]').first()).toBeVisible();
    const fades = (await logged(page)).slice(before).filter((a) => a.target.startsWith('board '));
    expect(fades).toHaveLength(1);
    expect(fades[0]).toMatchObject({ props: ['opacity'], duration: 220 });
    expect(errors).toEqual([]);
  });
});
