/**
 * In-page instrumentation of the perf spec (installed with `page.addInitScript`, before any page script): timestamps on
 * the page's own clock (`performance.now()`) for
 *
 * - `keys`: `keydown` in the textarea (`event.timeStamp`) — the keystroke;
 * - `encodes` / `results`: the `encode` messages the page posts to the tokenizer Worker and the `result` messages it
 *   receives (the global `Worker` is subclassed, so the app's Vite worker import gets the probe too);
 * - `updates` / `frames`: when the board grid's `data-pending` attribute goes away (the DOM shows the new result) and the
 *   first moment after the next frame was produced (`requestAnimationFrame` → `MessageChannel`), armed by
 *   `__tsbsWatchBoard(subtree)`;
 * - `scrubKeys` / `scrubFrames`: a keydown outside the textarea and the frame after the first board DOM change that
 *   follows it (scrubbing; needs `__tsbsWatchBoard(true)`);
 * - `longTasks`: every `longtask` entry (main-thread task > 50 ms).
 *
 * Self-contained (it is serialized into the page). No inline script or style is created, so the strict CSP holds.
 */

/** What the probe records (all times are `performance.now()` milliseconds of the page). */
export interface PerfProbe {
  keys: number[];
  encodes: number[];
  results: number[];
  updates: number[];
  frames: number[];
  scrubKeys: number[];
  scrubFrames: number[];
  longTasks: Array<{ start: number; duration: number }>;
}

declare global {
  interface Window {
    __tsbsPerf?: PerfProbe;
    __tsbsWatchBoard?: (subtree: boolean) => void;
  }
}

/** The init script. */
export function installProbe(): void {
  const probe: PerfProbe = {
    keys: [],
    encodes: [],
    results: [],
    updates: [],
    frames: [],
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
    constructor(url: string | URL, options?: WorkerOptions) {
      super(url, options);
      this.addEventListener('message', (event: MessageEvent<unknown>) => {
        if (typeOf(event.data) === 'result') probe.results.push(performance.now());
      });
    }

    override postMessage(message: unknown, transfer?: Transferable[] | StructuredSerializeOptions): void {
      if (typeOf(message) === 'encode') probe.encodes.push(performance.now());
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
}
