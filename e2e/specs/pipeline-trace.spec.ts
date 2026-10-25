/**
 * The stop 2→3 morph's frame budget on the real page (06 §3 "Stop 2→3 morph: no frame > 32 ms at ≤ 600 cells", 07 WP09),
 * chromium. 150 ideographs = 150 char boxes + 450 byte cells = 600 cells, all on screen:
 *
 * - nothing animates in the frame that paints the commit (the boxes keep their First geometry for that frame; flip.ts
 *   `Plan.startAfterPaint`) and the FLIP and the unfold start right after it; the U+ labels wait hidden while the boxes
 *   scale (above 120 changed cells they are not counter-scaled) and come back when the morph ends;
 * - the keydown task reads no layout after the board re-rendered: at most one forced layout, the read of the old (clean)
 *   layout before the commit, and it is short;
 * - a chromium trace bounds the commit frame — from the start of the keydown task to the end of the task that paints
 *   it — and every later main-thread task while the morph plays.
 *
 * Like the unit perf ceilings, the 32 ms bound holds on a quiet machine: it is enforced with `TSBS_PERF=1`, run serially
 * (`TSBS_PERF=1 pnpm e2e pipeline-trace --workers=1`); the default parallel run, where workers compete for the CPU,
 * checks twice that, and the structural checks above hold in every run. The measured numbers are attached to the report
 * (`commit-frame` annotation). Playwright's own trace is off in this file: it snapshots the DOM around every action on
 * the page's main thread.
 */
import process from 'node:process';
import { expect, test, type Page } from '@playwright/test';
import { grid } from './board-helpers.ts';
import { motionReady } from './pipeline-helpers.ts';
import { openShell } from './shell-helpers.ts';

test.skip(({ browserName }) => browserName !== 'chromium', 'chromium: tracing');
test.use({ trace: 'off' });

/** 06 §3: no frame over 32 ms — enforced in a serial perf run (`TSBS_PERF=1`), doubled under parallel workers. */
const FRAME_CEILING_MS = process.env['TSBS_PERF'] === '1' ? 32 : 64;
/** A forced layout of the re-rendered 600-cell board takes ≥ 5 ms on a fast machine; the pre-commit read, < 1 ms. */
const PRE_COMMIT_LAYOUT_MS = 3;

interface TraceEvent {
  readonly name: string;
  readonly ph: string;
  readonly ts: number;
  readonly dur?: number;
  readonly pid: number;
  readonly tid: number;
  readonly args?: { readonly data?: { readonly type?: string } };
}

/** Counts the `Element.animate` calls that animate a char box's transform. */
async function countBoxFlips(page: Page): Promise<void> {
  await page.addInitScript(() => {
    const store = window as unknown as Record<string, number>;
    store['__tsbsBoxFlips'] = 0;
    // eslint-disable-next-line @typescript-eslint/unbound-method -- re-invoked with .call(this) below
    const animate = Element.prototype.animate;
    Element.prototype.animate = function (
      this: Element,
      keyframes: Keyframe[] | PropertyIndexedKeyframes | null,
      options?: number | KeyframeAnimationOptions,
    ): Animation {
      if (this.classList.contains('bd-box') && Array.isArray(keyframes) && keyframes.some((k) => 'transform' in k))
        store['__tsbsBoxFlips'] = (store['__tsbsBoxFlips'] ?? 0) + 1;
      return animate.call(this, keyframes, options);
    };
  });
}

const boxFlips = (page: Page): Promise<number> =>
  page.evaluate(() => (window as unknown as Record<string, number>)['__tsbsBoxFlips'] ?? 0);

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

interface AroundCommit {
  /** Animations running in the frame that paints the commit. */
  readonly commitFrame: number;
  /** Most animations running in one of the frames after it. */
  readonly later: number;
  /** Whether the U+ labels were hidden while the boxes scaled, and are shown again once the morph ended. */
  readonly labelsHidden: boolean;
  readonly labelsBack: boolean;
}

/**
 * Presses `key` and reports how many animations ran in the frame that paints the commit (an animation frame callback
 * queued before the keydown reaches the app runs first in that frame) and at most in the frames after it, and whether
 * the U+ labels waited hidden while the boxes scaled.
 */
async function animationsAroundCommit(page: Page, key: string): Promise<AroundCommit> {
  await page.evaluate(() => {
    const store = window as unknown as Record<string, number>;
    store['__tsbsCommitFrame'] = -1;
    store['__tsbsLater'] = 0;
    window.addEventListener(
      'keydown',
      () => {
        requestAnimationFrame(() => {
          store['__tsbsCommitFrame'] = document.getAnimations().length;
          let n = 0;
          const tick = (): void => {
            store['__tsbsLater'] = Math.max(store['__tsbsLater'] ?? 0, document.getAnimations().length);
            const label = document.querySelector('.bd-ulabel');
            if (n === 4 && label !== null)
              store['__tsbsLabels'] = getComputedStyle(label).visibility === 'hidden' ? 1 : 0;
            if (++n < 6) requestAnimationFrame(tick);
          };
          requestAnimationFrame(tick);
        });
      },
      { capture: true, once: true },
    );
  });
  await page.keyboard.press(key);
  await drained(page);
  return page.evaluate(() => {
    const store = window as unknown as Record<string, number>;
    const label = document.querySelector('.bd-ulabel');
    return {
      commitFrame: store['__tsbsCommitFrame'] ?? -1,
      later: store['__tsbsLater'] ?? 0,
      labelsHidden: store['__tsbsLabels'] === 1,
      labelsBack: label !== null && getComputedStyle(label).visibility === 'visible',
    };
  });
}

test('the stop 2→3 morph at 600 cells: nothing animates in the commit frame, which reads no layout after the commit, and no frame is over 32 ms', async ({
  page,
  browser,
}) => {
  await page.setViewportSize({ width: 1440, height: 3200 });
  await countBoxFlips(page);
  await openShell(page, 'en');
  const text = '台灣台南日本語東京都渋谷区'.repeat(12).slice(0, 150);
  await page.locator('#text-input').fill(text);
  await expect(page.getByTestId('counts')).toContainText('450 bytes');
  await expect(page.locator('[data-source="live"]')).toBeVisible();
  await expect(grid(page).locator('.bd-cell-char')).toHaveCount(150);
  await motionReady(page);
  await page.keyboard.press('Digit2');
  await expect(grid(page)).toHaveAttribute('data-stage', '2');
  await drained(page);
  // One morph and back first, so the measured one runs warm (JIT, layers, fonts); the first one also shows that the
  // commit frame animates nothing and that the animations start right after it.
  const around = await animationsAroundCommit(page, 'Digit3');
  expect(around.commitFrame).toBe(0);
  expect(around.later).toBeGreaterThan(150); // the boxes, their glyphs and the byte tier rows
  expect(around).toMatchObject({ labelsHidden: true, labelsBack: true }); // 600 cells: not counter-scaled, but hidden
  await page.keyboard.press('Digit2');
  await drained(page);
  const flipsBefore = await boxFlips(page);

  await browser.startTracing(page, {
    categories: ['devtools.timeline', 'disabled-by-default-devtools.timeline', 'toplevel'],
  });
  await page.keyboard.press('Digit3');
  // No page.evaluate while tracing: every main-thread task in the trace is the page's own.
  await page.waitForTimeout(900);
  const trace = JSON.parse((await browser.stopTracing()).toString('utf8')) as { traceEvents: TraceEvent[] };
  await expect(grid(page)).toHaveAttribute('data-stage', '3');
  expect((await boxFlips(page)) - flipsBefore).toBe(150);

  const events = trace.traceEvents;
  const keydown = events.findLast((e) => e.name === 'EventDispatch' && e.args?.data?.type === 'keydown');
  expect(keydown).toBeDefined();
  if (keydown === undefined) return;
  const onMain = (e: TraceEvent): boolean => e.pid === keydown.pid && e.tid === keydown.tid;
  const end = (e: TraceEvent): number => e.ts + (e.dur ?? 0);
  const tasks = events
    .filter((e) => e.name === 'ThreadControllerImpl::RunTask' && e.ph === 'X' && onMain(e))
    .sort((a, b) => a.ts - b.ts);
  const commit = tasks.find((task) => task.ts <= keydown.ts && end(task) >= end(keydown));
  expect(commit).toBeDefined();
  if (commit === undefined) return;
  const within = (e: TraceEvent, task: TraceEvent): boolean => onMain(e) && e.ts >= task.ts && end(e) <= end(task);
  const paints = events.filter((e) => e.name === 'Paint' && onMain(e) && e.ts >= end(commit));
  const firstFrame = tasks.find((task) => task.ts >= end(commit) && paints.some((p) => within(p, task)));
  expect(firstFrame).toBeDefined();
  if (firstFrame === undefined) return;
  const layouts = events.filter((e) => e.name === 'Layout' && e.ph === 'X' && within(e, commit));
  const after = tasks.filter((task) => task.ts > end(firstFrame));
  const ms = (us: number): number => Math.round(us / 100) / 10;
  const commitFrameMs = ms(end(firstFrame) - commit.ts);
  const longest = Math.max(0, ...after.map((task) => ms(task.dur ?? 0)));
  test.info().annotations.push({
    type: 'commit-frame',
    description: `keydown task ${String(ms(commit.dur ?? 0))} ms (forced layout: ${layouts.map((l) => `${String(ms(l.dur ?? 0))} ms`).join(', ') || 'none'}), commit frame ${String(commitFrameMs)} ms; ${String(after.length)} tasks after, longest ${String(longest)} ms (ceiling ${String(FRAME_CEILING_MS)} ms)`,
  });
  expect(layouts.length).toBeLessThanOrEqual(1);
  for (const layout of layouts) expect(ms(layout.dur ?? 0)).toBeLessThanOrEqual(PRE_COMMIT_LAYOUT_MS);
  expect(commitFrameMs).toBeLessThanOrEqual(FRAME_CEILING_MS);
  expect(after.length).toBeGreaterThan(0);
  expect(longest).toBeLessThanOrEqual(FRAME_CEILING_MS);
});
