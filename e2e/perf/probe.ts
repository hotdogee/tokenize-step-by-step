/**
 * In-page instrumentation of the perf spec (installed with `page.addInitScript`, before any page script): timestamps on
 * the page's own clock (`performance.now()`) for
 *
 * - `keys` / `inputs`: `keydown` and `input` in the textarea (`event.timeStamp`) — the keystroke;
 * - `encodes` / `results`: the `encode` messages the page posts to the board's Worker (o200k, the default tokenizer) and
 *   the `result` messages it receives; `rowEncodes` / `rowResults`: the same for every Worker, one per table row (PA-19;
 *   the global `Worker` is subclassed, so the app's Vite worker import gets the probe too);
 * - `updates` / `frames`: when the board grid's `data-pending` attribute goes away (the DOM shows the new result) and the
 *   first moment after the next frame was produced (`requestAnimationFrame` → `MessageChannel`), armed by
 *   `__tsbsWatchBoard(subtree)`;
 * - `tableUpdates` / `tableFrames`: when the last table row turns `current` (every row's DOM shows the new result) and the
 *   frame after it, armed by `__tsbsWatchTable()`;
 * - `scrubKeys` / `scrubFrames`: a keydown outside the textarea and the frame after the first board DOM change that
 *   follows it (scrubbing; needs `__tsbsWatchBoard(true)`);
 * - `longTasks`: every `longtask` entry (main-thread task > 50 ms).
 *
 * Self-contained (it is serialized into the page). No inline script or style is created, so the strict CSP holds.
 */

/** What the probe records (all times are `performance.now()` milliseconds of the page). */
export interface PerfProbe {
  keys: number[];
  inputs: number[];
  encodes: number[];
  results: number[];
  rowEncodes: number[];
  rowResults: number[];
  updates: number[];
  frames: number[];
  tableUpdates: number[];
  tableFrames: number[];
  scrubKeys: number[];
  scrubFrames: number[];
  longTasks: Array<{ start: number; duration: number }>;
}

declare global {
  interface Window {
    __tsbsPerf?: PerfProbe;
    __tsbsWatchBoard?: (subtree: boolean) => void;
    __tsbsWatchTable?: () => void;
  }
}

/** The init script. */
export function installProbe(): void {
  const probe: PerfProbe = {
    keys: [],
    inputs: [],
    encodes: [],
    results: [],
    rowEncodes: [],
    rowResults: [],
    updates: [],
    frames: [],
    tableUpdates: [],
    tableFrames: [],
    scrubKeys: [],
    scrubFrames: [],
    longTasks: [],
  };
  window.__tsbsPerf = probe;
  const typeOf = (data: unknown): unknown =>
    typeof data === 'object' && data !== null ? (data as { type?: unknown }).type : undefined;
  const afterNextFrame = (record: (t: number) => void): void => {
    requestAnimationFrame(() => {
      const channel = new MessageChannel();
      channel.port1.onmessage = () => {
        record(performance.now());
      };
      channel.port2.postMessage(0);
    });
  };

  const NativeWorker = window.Worker;
  class ProbedWorker extends NativeWorker {
    /** The tokenizer this Worker was told to load (`load` message): the pool runs one per tokenizer. */
    tokenizer: unknown = null;

    constructor(url: string | URL, options?: WorkerOptions) {
      super(url, options);
      this.addEventListener('message', (event: MessageEvent<unknown>) => {
        if (typeOf(event.data) !== 'result') return;
        const now = performance.now();
        probe.rowResults.push(now);
        if (this.tokenizer === 'openai-o200k_base') probe.results.push(now);
      });
    }

    override postMessage(message: unknown, transfer?: Transferable[] | StructuredSerializeOptions): void {
      const type = typeOf(message);
      if (type === 'load') this.tokenizer = (message as { tokenizer?: unknown }).tokenizer;
      if (type === 'encode') {
        const now = performance.now();
        probe.rowEncodes.push(now);
        if (this.tokenizer === 'openai-o200k_base') probe.encodes.push(now);
      }
      if (Array.isArray(transfer)) super.postMessage(message, transfer);
      else super.postMessage(message, transfer);
    }
  }
  window.Worker = ProbedWorker;

  let scrubArmed = false;
  document.addEventListener(
    'keydown',
    (event) => {
      const target = event.target as Element | null;
      if (target?.id === 'text-input') probe.keys.push(event.timeStamp);
      else {
        probe.scrubKeys.push(event.timeStamp);
        scrubArmed = true;
      }
    },
    true,
  );
  document.addEventListener(
    'input',
    (event) => {
      if ((event.target as Element | null)?.id === 'text-input') probe.inputs.push(event.timeStamp);
    },
    true,
  );

  try {
    new PerformanceObserver((list) => {
      for (const entry of list.getEntries()) probe.longTasks.push({ start: entry.startTime, duration: entry.duration });
    }).observe({ type: 'longtask', buffered: true });
  } catch {
    // longtask entries are Chromium-only; the trace is the authoritative source anyway
  }

  // `subtree: false` watches only the grid's `data-pending` attribute: observing every cell would add a MutationRecord per
  // DOM change and inflate the very render times being measured. Scrubbing needs the subtree (the token tier changes).
  window.__tsbsWatchBoard = (subtree) => {
    const grid = document.querySelector('[data-testid="board-grid"]');
    if (grid === null) throw new Error('no board grid');
    let pending = grid.hasAttribute('data-pending');
    const observer = new MutationObserver((records) => {
      const now = performance.now();
      if (scrubArmed && records.length > 0) {
        scrubArmed = false;
        afterNextFrame((t) => probe.scrubFrames.push(t));
      }
      const nowPending = grid.hasAttribute('data-pending');
      if (pending && !nowPending) {
        probe.updates.push(now);
        afterNextFrame((t) => probe.frames.push(t));
      }
      pending = nowPending;
    });
    observer.observe(
      grid,
      subtree
        ? { attributes: true, childList: true, subtree: true, characterData: true }
        : { attributes: true, attributeFilter: ['data-pending'] },
    );
  };

  // Rows flip to `stale` with the keystroke and back to `current` one by one, each in the flush that puts its chips in the
  // DOM. Only that attribute is observed, for the same reason as above.
  window.__tsbsWatchTable = () => {
    const table = document.querySelector('[data-testid="compare"]');
    if (table === null) throw new Error('no comparison table');
    const settled = (): boolean => table.querySelector('.cmp-rowgroup:not([data-state="current"])') === null;
    let was = settled();
    new MutationObserver(() => {
      const now = performance.now();
      const is = settled();
      if (!was && is) {
        probe.tableUpdates.push(now);
        afterNextFrame((t) => probe.tableFrames.push(t));
      }
      was = is;
    }).observe(table, { attributes: true, attributeFilter: ['data-state'], subtree: true });
  };
}
