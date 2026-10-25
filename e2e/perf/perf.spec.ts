/**
 * Perf spec (06 §1 "Performance", §3; WP12) on the production bundle (`vite preview`), chromium, desktop 1440×900:
 *
 * 1. o200k load end to end under CDP `Network.emulateNetworkConditions` "Fast 4G" (9 Mbps down, 170 ms RTT):
 *    `loaded.ms` (the Worker's download + verify + gunzip + build, read from About's `tsbs:lastLoaded`) ≤ 2.5 s;
 * 2. keystroke → board update at 1k and 10k characters (p95 ≤ 50 / ≤ 120 ms), with a Chromium trace of the 10k typing
 *    (no main-thread task > 50 ms);
 * 3. render a board of ≈ 2,000 cells (the text is sized from a calibration render): the wall time from the Worker's
 *    `result` to the updated DOM, held to the 06 §3 "≤ 50 ms script" budget (wall time bounds the script time from above);
 * 4. scrub: `.` through the merge steps at stop 5 with a trace (recorded).
 *
 * Budget misses are soft (warnings + `test-results/perf/perf-results.json`, the trend artifact) unless `PERF_STRICT=1`.
 * The keystroke budget is held to the interval 06 §3 defines, keystroke → frame, which includes the deliberate 40 ms
 * encode debounce of 05 §6 (`ENCODE_DEBOUNCE_MS`); the latency from the `encode` request the debounce releases is
 * recorded beside it as a diagnostic (docs/perf-log.md, finding 2).
 */
import { join } from 'node:path';
import { expect, test, type Browser, type Page } from '@playwright/test';
import { latencies, mainThreadTasks, percentile, record, STRICT, writeResults } from './metrics.ts';
import { installProbe, type PerfProbe } from './probe.ts';

/** 06 §3. */
const BUDGET = {
  loadDesktopMs: 2500,
  keystroke1kP95Ms: 50,
  keystroke10kP95Ms: 120,
  longTaskMs: 50,
  render2000CellsMs: 50,
} as const;
/** The board size of the render budget ("Render 2,000 cells ≤ 50 ms script"). */
const RENDER_CELLS = 2000;
/** 05 §6 / apps/web/src/app/app-state.svelte.ts `ENCODE_DEBOUNCE_MS`. */
const ENCODE_DEBOUNCE_MS = 40;
/** DevTools "Fast 4G" as 06 §3 defines it. */
const FAST_4G = {
  offline: false,
  latency: 170,
  downloadThroughput: 9_000_000 / 8,
  uploadThroughput: 1_500_000 / 8,
  connectionType: 'cellular4g',
} as const;
const KEYSTROKES = 30;
const LETTERS = 'abcdefghijklmnopqrstuvwxyz';

/** Deterministic mixed zh-TW/Latin text of `count` code points (several chunks, CJK runs of a few hundred bytes). */
function mixedText(count: number): string {
  const unit = Array.from('台灣台南的牛肉湯很好喝，今天天氣晴朗。Hello world 123, tokenizers! ');
  return Array.from({ length: count }, (_, i) => unit[i % unit.length]).join('');
}

/** `count` CJK ideographs (one regex chunk: the primary audience's paragraph, AD-21). */
function cjkText(count: number): string {
  const unit = Array.from(
    '台灣台南高雄臺北新竹嘉義花蓮宜蘭基隆桃園苗栗彰化南投雲林屏東澎湖金門馬祖今天天氣很好我們一起去吃飯吧',
  );
  return Array.from({ length: count }, (_, i) => unit[(i * 7 + (i >> 6)) % unit.length]).join('');
}

const probeOf = (page: Page): Promise<PerfProbe> =>
  page.evaluate(() => {
    const probe = window.__tsbsPerf;
    if (probe === undefined) throw new Error('perf probe missing');
    return probe;
  });

/** Opens `/` with the probe installed and waits for the live o200k result; `subtree` arms the scrub observer. */
async function openLive(page: Page, subtree = false): Promise<void> {
  await page.addInitScript(installProbe);
  await page.goto('/?lang=en');
  await expect(page.locator('[data-source="live"]')).toBeVisible({ timeout: 60_000 });
  await page.evaluate((s) => {
    window.__tsbsWatchBoard?.(s);
  }, subtree);
}

/** Replaces the text and waits until the board shows its result (one more board update). */
async function setText(page: Page, text: string): Promise<void> {
  const before = (await probeOf(page)).frames.length;
  await page.locator('#text-input').fill(text);
  await page.waitForFunction((n) => (window.__tsbsPerf?.frames.length ?? 0) > n, before, { timeout: 60_000 });
}

/** Types `count` letters at the end of the text, each after the previous one's board update. */
async function typeLetters(
  page: Page,
  count: number,
): Promise<{ keys: number[]; encodes: number[]; frames: number[] }> {
  await page.locator('#text-input').press('End');
  const start = await probeOf(page);
  for (let i = 0; i < count; i++) {
    const frames = (await probeOf(page)).frames.length;
    await page.keyboard.press(LETTERS.charAt(i % LETTERS.length));
    await page.waitForFunction((n) => (window.__tsbsPerf?.frames.length ?? 0) > n, frames, { timeout: 30_000 });
  }
  const end = await probeOf(page);
  return {
    keys: end.keys.slice(start.keys.length),
    encodes: end.encodes.slice(start.encodes.length),
    frames: end.frames.slice(start.frames.length),
  };
}

/** Holds `value` to `budget` (soft unless PERF_STRICT=1). */
function budget(metric: string, value: number, limit: number, note?: string): void {
  const ok = record(metric, value, 'ms', limit, note);
  if (STRICT) expect.soft(value, metric).toBeLessThanOrEqual(limit);
  else if (!ok)
    test
      .info()
      .annotations.push({ type: 'perf-budget', description: `${metric} ${value.toFixed(1)} ms > ${String(limit)} ms` });
}

/** Runs `run` under a Chromium trace; returns its value and the durations of the renderer main thread's tasks. */
async function traced<T>(browser: Browser, page: Page, run: () => Promise<T>): Promise<{ value: T; tasks: number[] }> {
  await browser.startTracing(page, { categories: ['devtools.timeline', 'disabled-by-default-devtools.timeline'] });
  try {
    const value = await run();
    return { value, tasks: mainThreadTasks(await browser.stopTracing()) };
  } catch (error) {
    await browser.stopTracing().catch(() => undefined);
    throw error;
  }
}

test.describe.configure({ mode: 'serial' });

test.afterAll(({ browser }) => {
  writeResults(join(test.info().project.outputDir, 'perf-results.json'), {
    date: new Date().toISOString(),
    browser: `chromium ${browser.version()}`,
    viewport: '1440×900',
    strict: STRICT,
    network: { load: 'CDP Fast 4G 9 Mbps / 170 ms', others: 'unthrottled' },
  });
});

test('o200k loads end to end within 2.5 s on Fast 4G (loaded.ms)', async ({ page }) => {
  const cdp = await page.context().newCDPSession(page);
  await cdp.send('Network.enable');
  await cdp.send('Network.emulateNetworkConditions', FAST_4G);
  let binBytes = 0;
  page.on('requestfinished', (request) => {
    if (new URL(request.url()).pathname.startsWith('/tok/'))
      void request.sizes().then((sizes) => {
        binBytes = sizes.responseBodySize;
      });
  });
  await page.goto('/?lang=en');
  await expect(page.locator('[data-source="live"]')).toBeVisible({ timeout: 60_000 });
  const navToLive = await page.evaluate(() => performance.now());
  const stored = await page.evaluate(() => sessionStorage.getItem('tsbs:lastLoaded'));
  expect(stored).not.toBeNull();
  const loaded = JSON.parse(stored ?? '{}') as { ms: number; fromCache: boolean; layer: string; tokenizer: string };
  expect(loaded).toMatchObject({ tokenizer: 'openai-o200k_base', fromCache: false });
  // 1,025 KB at 9 Mbps is ≥ 0.9 s: anything faster means the throttling did not reach the Worker's fetch.
  expect(loaded.ms, 'Fast 4G applied to the Worker fetch').toBeGreaterThan(800);
  budget('o200k load, loaded.ms (Fast 4G, desktop)', loaded.ms, BUDGET.loadDesktopMs, `layer ${loaded.layer}`);
  record('o200k load, navigation → live result (Fast 4G)', navToLive, 'ms', null);
  if (binBytes > 0) record('o200k .bin transferred', binBytes, 'count', null, 'bytes');
});

test('keystroke → board update at 1k characters (p95 ≤ 50 ms)', async ({ page }) => {
  await openLive(page);
  await setText(page, mixedText(1000));
  const { keys, encodes, frames } = await typeLetters(page, KEYSTROKES);
  const total = latencies(keys, frames);
  const work = latencies(
    keys.map((k) => encodes.find((e) => e >= k) ?? Number.POSITIVE_INFINITY),
    frames,
  );
  expect(total).toHaveLength(KEYSTROKES);
  budget(
    'keystroke → board update, 1k chars, p95 (keystroke → frame, incl. 40 ms debounce)',
    percentile(total, 95),
    BUDGET.keystroke1kP95Ms,
  );
  record('keystroke → board update, 1k chars, p50 (keystroke → frame)', percentile(total, 50), 'ms', null);
  record('encode request → board update, 1k chars, p95 (diagnostic)', percentile(work, 95), 'ms', null);
  record(
    'keystroke → encode request (the debounce), median',
    percentile(latencies(keys, encodes), 50),
    'ms',
    null,
    `ENCODE_DEBOUNCE_MS = ${String(ENCODE_DEBOUNCE_MS)}`,
  );
});

test('keystroke → board update at 10k characters (p95 ≤ 120 ms), no main-thread task > 50 ms while typing', async ({
  page,
  browser,
}) => {
  await openLive(page);
  const pasteStart = await page.evaluate(() => performance.now());
  await setText(page, cjkText(10_000));
  const pasteFrame = (await probeOf(page)).frames.at(-1) ?? pasteStart;
  record('paste 10k CJK → board update (recorded)', pasteFrame - pasteStart, 'ms', null);
  const longTasksBefore = (await probeOf(page)).longTasks.length;
  const { value, tasks } = await traced(browser, page, () => typeLetters(page, KEYSTROKES));
  const { keys, encodes, frames } = value;
  const total = latencies(keys, frames);
  const work = latencies(
    keys.map((k) => encodes.find((e) => e >= k) ?? Number.POSITIVE_INFINITY),
    frames,
  );
  expect(total).toHaveLength(KEYSTROKES);
  budget(
    'keystroke → board update, 10k CJK, p95 (keystroke → frame, incl. 40 ms debounce)',
    percentile(total, 95),
    BUDGET.keystroke10kP95Ms,
  );
  record('encode request → board update, 10k CJK, p95 (diagnostic)', percentile(work, 95), 'ms', null);
  budget('longest main-thread task while typing into 10k CJK (trace)', Math.max(0, ...tasks), BUDGET.longTaskMs);
  const longTasks = (await probeOf(page)).longTasks.slice(longTasksBefore);
  record('long tasks (> 50 ms) while typing into 10k CJK (PerformanceObserver)', longTasks.length, 'count', null);
});

test.describe('render', () => {
  // Wide enough that K reaches the 1600 px board cap, so ≈ 2,000 cells fit in ≤ 24 rows: the full, unvirtualized board.
  test.use({ viewport: { width: 2560, height: 1440 } });

  /** `rows` rows of K one-byte characters (short words, so the token tier has chips); `variant` changes the words. */
  const rowsText = (k: number, rows: number, variant: number): string =>
    Array.from({ length: rows * k }, (_, w) => `w${String((w * 7 + variant) % 97)}x`)
      .join(' ')
      .slice(0, rows * k);
  const cellCount = (page: Page): Promise<number> =>
    page.locator('[data-testid="board-grid"] [role="gridcell"]').count();

  test('render ≈ 2,000 board cells: wall time from the Worker result to the updated DOM ≤ 50 ms (06 §3 script budget)', async ({
    page,
    browser,
  }) => {
    await openLive(page);
    const k = Number(await page.locator('[data-k]').first().getAttribute('data-k'));
    expect(k).toBeGreaterThanOrEqual(8);
    // Calibration: the cells one row of this text mounts (K char cells, K byte cells and the token chips), so the
    // measured text is sized to about RENDER_CELLS cells.
    const calibrationRows = 10;
    await setText(page, rowsText(k, calibrationRows, 0));
    const rows = Math.max(1, Math.round(RENDER_CELLS / ((await cellCount(page)) / calibrationRows)));
    const walls: number[] = [];
    const frames: number[] = [];
    let cells = 0;
    // One warm-up, five measured renders, then one more under a trace (tracing slows the page, so its numbers are
    // reported separately).
    for (let i = 0; i < 7; i++) {
      const text = rowsText(k, rows, i + 1);
      const before = await probeOf(page);
      if (i === 6) {
        const { tasks } = await traced(browser, page, () => setText(page, text));
        record(`render, longest main-thread task under a trace`, Math.max(0, ...tasks), 'ms', null);
        break;
      }
      await setText(page, text);
      const after = await probeOf(page);
      const result = after.results.slice(before.results.length).at(-1);
      const update = after.updates.slice(before.updates.length).at(-1);
      const frame = after.frames.slice(before.frames.length).at(-1);
      if (result === undefined || update === undefined || frame === undefined) throw new Error('no board update');
      if (i > 0) {
        walls.push(update - result);
        frames.push(frame - result);
      }
      cells = await cellCount(page);
    }
    record(
      `board cells mounted (K ${String(k)}, ${String(rows)} rows, ${String(rows * k)} characters)`,
      cells,
      'count',
      null,
    );
    expect(cells).toBeGreaterThan(RENDER_CELLS * 0.85);
    expect(cells).toBeLessThan(RENDER_CELLS * 1.15);
    budget(
      `render ${String(cells)} cells, wall time result → DOM, median of 5`,
      percentile(walls, 50),
      BUDGET.render2000CellsMs,
      'wall time, an upper bound of the script time the budget names',
    );
    record(`render ${String(cells)} cells, wall time result → DOM, max of 5`, Math.max(...walls), 'ms', null);
    record(`render ${String(cells)} cells, result → next frame, median`, percentile(frames, 50), 'ms', null);
  });
});

test('scrub trace: `.` through the merge steps at stop 5', async ({ page, browser }) => {
  await openLive(page, true);
  await setText(page, mixedText(300));
  await page.locator('#text-input').blur();
  await page.keyboard.press('5');
  await expect(page.locator('[data-testid="board-grid"]')).toHaveAttribute('data-stage', '5');
  const before = await probeOf(page);
  const { tasks } = await traced(browser, page, async () => {
    for (let i = 0; i < 40; i++) {
      const n = (await probeOf(page)).scrubFrames.length;
      await page.keyboard.press('Period');
      await page.waitForFunction((k) => (window.__tsbsPerf?.scrubFrames.length ?? 0) > k, n, { timeout: 10_000 });
    }
  });
  const after = await probeOf(page);
  const steps = latencies(
    after.scrubKeys.slice(before.scrubKeys.length),
    after.scrubFrames.slice(before.scrubFrames.length),
  );
  record('scrub one merge step, keydown → frame, p95 (recorded)', percentile(steps, 95), 'ms', null);
  budget('longest main-thread task while scrubbing (trace)', Math.max(0, ...tasks), BUDGET.longTaskMs);
});
