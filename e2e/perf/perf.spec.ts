/**
 * Perf spec (06 §1 "Performance", §3; WP12) on the production bundle (`vite preview`), chromium, desktop 1440×900 unless
 * a test says otherwise. Since PA-19 the page is the comparison table with the board in the closed Advanced disclosure:
 * the table's tests measure what a visitor lands on, the board's open Advanced and type with all five rows live, held to
 * the later of the board's frame and the table's, so the table's work on the same keystroke is in their numbers. The
 * budgets kept their ceilings.
 *
 * 1. o200k load end to end under CDP `Network.emulateNetworkConditions` "Fast 4G" (9 Mbps down, 170 ms RTT):
 *    `loaded.ms` (the Worker's download + verify + gunzip + build, read from About's `tsbs:lastLoaded`) ≤ 2.5 s;
 * 2. keystroke → board update at 1k and 10k characters (p95 ≤ 50 / ≤ 120 ms), measured from the encode request the 40 ms
 *    debounce releases (PA-12) to the later of the board's frame and the table's: the board's result is the first of the
 *    five, so its own frame comes before the other rows answer. That frame and the from-keystroke latencies are recorded
 *    beside it, with a Chromium trace of the 10k typing (no main-thread task > 50 ms). The window is as tall as the table
 *    above the board takes, so the board's first rows are on screen as they were at 900 px before PA-19; at 900 px the
 *    board starts below the fold and mounts less;
 * 3. keystroke → table update at 1k and 10k characters, Advanced closed, five live rows, on the same ceilings, measured
 *    from the `input` event to the frame after the last row's result, with a trace of the 10k typing. That measure holds
 *    the debounce; PA-12's (encode request → frame) and where the time goes are recorded beside it;
 * 4. render a board of ≈ 2,000 cells (the text is sized from the board's own `data-cells` count, the cells every row
 *    would mount): the wall time from the board's Worker's `result` to the updated DOM, held to the 06 §3 "≤ 50 ms script"
 *    budget (wall time bounds the script time from above). Since PA-11 such a board is virtualized (above 600 cells or 8
 *    rows) and renders once per text change, so only the rows in view are mounted: the board is scrolled to the top of
 *    the window, the text written in place, so the most rows are;
 * 5. scrub: `.` through the merge steps at stop 5 with a trace, the rail and the board on screen (only rows in the
 *    viewport take part in a FLIP).
 *
 * Budget misses are soft (warnings + `test-results/perf/perf-results.json`, the trend artifact) unless `PERF_STRICT=1`.
 * PA-12: the board's keystroke budget is held from the `encode` request (after the 40 ms `ENCODE_DEBOUNCE_MS` of 05 §6) to
 * the frame after the update; keystroke → frame, which includes the debounce, is recorded beside it but not asserted.
 */
import { join } from 'node:path';
import { expect, test, type Browser, type Page } from '@playwright/test';
import { latencies, mainThreadTasks, nextAfter, percentile, record, STRICT, writeResults } from './metrics.ts';
import { installProbe, type PerfProbe } from './probe.ts';
import { boardSource, openAdvanced, rowSource, rowsSettled } from '../specs/shell-helpers.ts';

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

/** A probe list that grows once per update the page shows. */
type Shown = 'frames' | 'tableFrames';

/** Waits for the OpenAI row's live o200k result on the page people land on, Advanced closed; arms the table's observer. */
async function openTable(page: Page): Promise<void> {
  await page.addInitScript(installProbe);
  await page.goto('/?lang=en');
  await expect(rowSource(page)).toHaveAttribute('data-source', 'live', { timeout: 60_000 });
  await expect(page.locator('details#advanced')).not.toHaveAttribute('open', '');
  await page.evaluate(() => {
    window.__tsbsWatchTable?.();
  });
}

/** `openTable`, then opens Advanced and waits for the board's live result; `subtree` arms the scrub observer. */
async function openLive(page: Page, subtree = false): Promise<void> {
  await openTable(page);
  await openAdvanced(page);
  await expect(boardSource(page)).toHaveAttribute('data-source', 'live', { timeout: 60_000 });
  await page.evaluate((s) => {
    window.__tsbsWatchBoard?.(s);
  }, subtree);
}

/**
 * Replaces the text and waits until `shown` has one more update, then until all five rows answer it live: the first free
 * text loads the other rows' vocabularies, and what the budgets describe is typing with every tokenizer on screen ready.
 * `place: 'in place'` writes the text without focusing the box, so the page does not scroll back up to it.
 */
async function setText(page: Page, text: string, shown: Shown = 'frames', place?: 'in place'): Promise<void> {
  const before = (await probeOf(page))[shown].length;
  const box = page.locator('#text-input');
  if (place === undefined) await box.fill(text);
  else
    await box.evaluate((element, value) => {
      (element as HTMLTextAreaElement).value = value;
      element.dispatchEvent(new InputEvent('input', { bubbles: true, inputType: 'insertReplacementText' }));
    }, text);
  await page.waitForFunction(([key, n]) => (window.__tsbsPerf?.[key].length ?? 0) > n, [shown, before] as const, {
    timeout: 60_000,
  });
  await rowsSettled(page);
}

/** What `typeLetters` reports: the probe's lists over the keystrokes. */
type Typed = Pick<PerfProbe, 'keys' | 'inputs' | 'encodes' | 'rowEncodes' | 'rowResults' | 'frames' | 'tableFrames'>;

/** Types `count` letters at the end of the text, each after the previous one's `shown` updates. */
async function typeLetters(page: Page, count: number, shown: readonly Shown[]): Promise<Typed> {
  await page.locator('#text-input').press('End');
  const start = await probeOf(page);
  for (let i = 0; i < count; i++) {
    const before = await probeOf(page);
    await page.keyboard.press(LETTERS.charAt(i % LETTERS.length));
    await page.waitForFunction(
      (lists) => lists.every(([key, n]) => (window.__tsbsPerf?.[key].length ?? 0) > n),
      shown.map((key) => [key, before[key].length] as const),
      { timeout: 30_000 },
    );
  }
  const end = await probeOf(page);
  const since = (key: keyof Typed): number[] => end[key].slice(start[key].length);
  return {
    keys: since('keys'),
    inputs: since('inputs'),
    encodes: since('encodes'),
    rowEncodes: since('rowEncodes'),
    rowResults: since('rowResults'),
    frames: since('frames'),
    tableFrames: since('tableFrames'),
  };
}

/** The board's keystrokes wait for the table too: its work on the same keystroke is the board's cost since PA-19. */
const BOTH: readonly Shown[] = ['frames', 'tableFrames'];

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
  await expect(rowSource(page)).toHaveAttribute('data-source', 'live', { timeout: 60_000 });
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

/** Tall enough for the board's first rows under the table and the 8-row text box, as 900 px showed them before PA-19. */
const BOARD_ON_SCREEN = { width: 1440, height: 1700 } as const;

/** Cells of the board actually mounted (the rows in view of a virtualized board). */
const mountedCells = (page: Page): Promise<number> =>
  page.locator('[data-testid="board-grid"] [role="gridcell"]').count();

/**
 * Holds one board typing run to the keystroke budget (06 §3), encode request → the later of the board's frame and the
 * table's. The board's own frame is recorded beside it, and both from the keystroke (PA-12: the debounce is not held).
 */
function boardBudget(chars: string, typed: Typed, ceiling: number): void {
  const { keys, encodes, frames, tableFrames } = typed;
  const table = nextAfter(keys, tableFrames);
  const whole = nextAfter(keys, frames).map((frame, i) =>
    Math.max(frame ?? Number.POSITIVE_INFINITY, table[i] ?? Number.POSITIVE_INFINITY),
  );
  const total = latencies(keys, whole);
  expect(total).toHaveLength(KEYSTROKES);
  const released = keys.map((k) => encodes.find((e) => e >= k) ?? Number.POSITIVE_INFINITY);
  budget(
    `keystroke → board update, ${chars}, five live rows, p95 (encode request → board's and table's frame, PA-12)`,
    percentile(latencies(released, whole), 95),
    ceiling,
  );
  record(
    `keystroke → board update, ${chars}, p95 (encode request → the board's own frame)`,
    percentile(latencies(released, frames), 95),
    'ms',
    null,
  );
  record(
    `keystroke → board update, ${chars}, p95 (keystroke → board's and table's frame, incl. 40 ms debounce)`,
    percentile(total, 95),
    'ms',
    null,
  );
  record(
    `keystroke → board update, ${chars}, p50 (keystroke → board's and table's frame)`,
    percentile(total, 50),
    'ms',
    null,
  );
  record(
    `keystroke → board update, ${chars}, p95 (keystroke → the board's own frame)`,
    percentile(latencies(keys, frames), 95),
    'ms',
    null,
  );
}

test('keystroke → board update at 1k characters (p95 ≤ 50 ms)', async ({ page }) => {
  await page.setViewportSize(BOARD_ON_SCREEN);
  await openLive(page);
  await setText(page, mixedText(1000));
  const typed = await typeLetters(page, KEYSTROKES, BOTH);
  boardBudget('1k chars', typed, BUDGET.keystroke1kP95Ms);
  record('board cells mounted while typing, 1k chars', await mountedCells(page), 'count', null);
  record(
    'keystroke → encode request (the debounce), median',
    percentile(latencies(typed.keys, typed.encodes), 50),
    'ms',
    null,
    `ENCODE_DEBOUNCE_MS = ${String(ENCODE_DEBOUNCE_MS)}`,
  );
});

test('keystroke → board update at 10k characters (p95 ≤ 120 ms), no main-thread task > 50 ms while typing', async ({
  page,
  browser,
}) => {
  await page.setViewportSize(BOARD_ON_SCREEN);
  await openLive(page);
  const pasteStart = await page.evaluate(() => performance.now());
  await setText(page, cjkText(10_000));
  const pasteFrame = (await probeOf(page)).frames.at(-1) ?? pasteStart;
  record('paste 10k CJK → board update (recorded)', pasteFrame - pasteStart, 'ms', null);
  const longTasksBefore = (await probeOf(page)).longTasks.length;
  const { value, tasks } = await traced(browser, page, () => typeLetters(page, KEYSTROKES, BOTH));
  boardBudget('10k CJK', value, BUDGET.keystroke10kP95Ms);
  budget('longest main-thread task while typing into 10k CJK (trace)', Math.max(0, ...tasks), BUDGET.longTaskMs);
  const longTasks = (await probeOf(page)).longTasks.slice(longTasksBefore);
  record('long tasks (> 50 ms) while typing into 10k CJK (PerformanceObserver)', longTasks.length, 'count', null);
  record('board cells mounted while typing, 10k CJK', await mountedCells(page), 'count', null);
});

/** Holds one table typing run to the keystroke budget (06 §3), input event → the frame after the last row's result. */
function tableBudget(chars: string, typed: Typed, ceiling: number): void {
  const { inputs, rowEncodes, rowResults, tableFrames } = typed;
  const total = latencies(inputs, tableFrames);
  expect(total).toHaveLength(KEYSTROKES);
  const released = inputs.map((t) => rowEncodes.find((e) => e >= t) ?? Number.POSITIVE_INFINITY);
  budget(
    `keystroke → table update, ${chars}, five live rows, p95 (input → last row's frame)`,
    percentile(total, 95),
    ceiling,
  );
  record(
    `keystroke → table update, ${chars}, p95 (encode request → last row's frame, PA-12's measure)`,
    percentile(latencies(released, tableFrames), 95),
    'ms',
    null,
  );
  record(`keystroke → table update, ${chars}, p50 (input → last row's frame)`, percentile(total, 50), 'ms', null);
  // Where the time goes: the Workers' answers, then the page's render of them.
  const lastResults = inputs.map((t, i) => {
    const next = inputs[i + 1] ?? Number.POSITIVE_INFINITY;
    return Math.max(...rowResults.filter((r) => r >= t && r < next));
  });
  record(
    `  of which encode request → last Worker result, ${chars}, p95`,
    percentile(
      lastResults.map((r, i) => r - (released[i] ?? r)),
      95,
    ),
    'ms',
    null,
  );
  record(
    `  of which last Worker result → last row's frame, ${chars}, p95`,
    percentile(latencies(lastResults, tableFrames), 95),
    'ms',
    null,
  );
}

test('keystroke → table update at 1k characters, Advanced closed (p95 ≤ 50 ms)', async ({ page }) => {
  await openTable(page);
  await setText(page, mixedText(1000), 'tableFrames');
  tableBudget('1k chars', await typeLetters(page, KEYSTROKES, ['tableFrames']), BUDGET.keystroke1kP95Ms);
});

test('keystroke → table update at 10k characters, Advanced closed (p95 ≤ 120 ms), no main-thread task > 50 ms while typing', async ({
  page,
  browser,
}) => {
  await openTable(page);
  await setText(page, cjkText(10_000), 'tableFrames');
  const { value, tasks } = await traced(browser, page, () => typeLetters(page, KEYSTROKES, ['tableFrames']));
  tableBudget('10k CJK', value, BUDGET.keystroke10kP95Ms);
  budget(
    'longest main-thread task while typing into 10k CJK, table only (trace)',
    Math.max(0, ...tasks),
    BUDGET.longTaskMs,
  );
});

test.describe('render', () => {
  // The widest desktop layout (K at the 2,400 px board cap, the tallest viewport): the most rows in view of a virtualized
  // board, so the most cells mounted per render.
  test.use({ viewport: { width: 2560, height: 1440 } });

  /** `rows` rows of K one-byte characters (short words, so the token tier has chips); `variant` changes the words. */
  const rowsText = (k: number, rows: number, variant: number): string =>
    Array.from({ length: rows * k }, (_, w) => `w${String((w * 7 + variant) % 97)}x`)
      .join(' ')
      .slice(0, rows * k);
  /** Cells the board would mount with every row (its `data-cells`, the PA-11 virtualization measure). */
  const boardCells = async (page: Page): Promise<number> =>
    Number(await page.locator('[data-testid="board-grid"]').getAttribute('data-cells'));

  test('render ≈ 2,000 board cells: wall time from the Worker result to the updated DOM ≤ 50 ms (06 §3 script budget)', async ({
    page,
    browser,
  }) => {
    await openLive(page);
    const k = Number(await page.locator('[data-k]').first().getAttribute('data-k'));
    expect(k).toBeGreaterThanOrEqual(8);
    // The board under the table (PA-19): at the top of the window, the most rows in view.
    await page.locator('[data-testid="board-grid"]').evaluate((grid) => {
      grid.scrollIntoView({ block: 'start' });
    });
    // Calibration: the cells one row of this text holds (K char cells, K byte cells and the token chips), so the
    // measured text is sized to about RENDER_CELLS cells of the whole board.
    const calibrationRows = 10;
    await setText(page, rowsText(k, calibrationRows, 0), 'frames', 'in place');
    const rows = Math.max(1, Math.round(RENDER_CELLS / ((await boardCells(page)) / calibrationRows)));
    const walls: number[] = [];
    const frames: number[] = [];
    let cells = 0;
    let mounted = 0;
    // One warm-up, five measured renders, then one more under a trace (tracing slows the page, so its numbers are
    // reported separately).
    for (let i = 0; i < 7; i++) {
      const text = rowsText(k, rows, i + 1);
      const before = await probeOf(page);
      if (i === 6) {
        const { tasks } = await traced(browser, page, () => setText(page, text, 'frames', 'in place'));
        record(`render, longest main-thread task under a trace`, Math.max(0, ...tasks), 'ms', null);
        break;
      }
      await setText(page, text, 'frames', 'in place');
      const after = await probeOf(page);
      const result = after.results.slice(before.results.length).at(-1);
      const update = after.updates.slice(before.updates.length).at(-1);
      const frame = after.frames.slice(before.frames.length).at(-1);
      if (result === undefined || update === undefined || frame === undefined) throw new Error('no board update');
      if (i > 0) {
        walls.push(update - result);
        frames.push(frame - result);
      }
      cells = await boardCells(page);
      mounted = await mountedCells(page);
    }
    record(`board cells (K ${String(k)}, ${String(rows)} rows, ${String(rows * k)} characters)`, cells, 'count', null);
    record('board cells mounted (the rows in view of the virtualized board, PA-11)', mounted, 'count', null);
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
  // From stop 6, `5` lands on the last merge (WP09: stop 6 ≡ stop 5 at step = stepCount), where `.` would leave for
  // stop 6; the walk starts at step 0 instead (Home on the scrubber; `.` keeps working with the scrubber focused).
  const scrubber = page.getByTestId('scrubber');
  await scrubber.evaluate((element) => {
    element.scrollIntoView({ block: 'start' }); // the rail and the board on screen: only rows in view take part in a FLIP
  });
  await scrubber.focus();
  await page.keyboard.press('Home');
  await expect(scrubber).toHaveValue('0');
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
