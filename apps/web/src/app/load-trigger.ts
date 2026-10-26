/**
 * The vocabulary load trigger (06 §3): the client posts `load` for the default tokenizer only after `DOMContentLoaded`,
 * `document.fonts.ready`, the first paint the browser reports (the first `largest-contentful-paint` entry, else the
 * `first-contentful-paint` paint entry) and two animation frames — so the Worker script, the engine chunk and the
 * `.bin` never compete with the main bundle before LCP. Two frames alone are not enough: a heavy first frame can still
 * be in style/layout when they run (lhci-local showed the client chunk requested 11 ms before the observed LCP). An
 * engine without paint timing (Safari < 26 has no LCP; every engine has `paint`) skips that step; a cap keeps a page
 * that never paints (prerendered, hidden) from waiting forever.
 */

/** Longest wait for a paint entry (ms). */
export const PAINT_WAIT_CAP_MS = 4000;

/** What the trigger reads (a browser window satisfies it; tests pass stand-ins). */
export interface TriggerEnv {
  readonly document: Pick<Document, 'readyState' | 'addEventListener'> & {
    readonly fonts?: { readonly ready: Promise<unknown> };
  };
  readonly requestAnimationFrame: (callback: () => void) => number;
  readonly PerformanceObserver?: {
    new (callback: (list: { getEntries(): readonly unknown[] }) => void): {
      observe(options: { type: string; buffered: boolean }): void;
      disconnect(): void;
    };
    readonly supportedEntryTypes?: readonly string[];
  };
  readonly setTimeout: (callback: () => void, ms: number) => unknown;
}

function contentLoaded(env: TriggerEnv): Promise<void> {
  if (env.document.readyState !== 'loading') return Promise.resolve();
  return new Promise((resolve) => {
    env.document.addEventListener(
      'DOMContentLoaded',
      () => {
        resolve();
      },
      { once: true },
    );
  });
}

/** Resolves with the first entry of the first supported paint type, or after the cap. */
function firstPaint(env: TriggerEnv): Promise<void> {
  const Observer = env.PerformanceObserver;
  const supported = Observer?.supportedEntryTypes ?? [];
  const type = ['largest-contentful-paint', 'paint'].find((candidate) => supported.includes(candidate));
  if (Observer === undefined || type === undefined) return Promise.resolve();
  return new Promise((resolve) => {
    let done = false;
    const finish = (): void => {
      if (done) return;
      done = true;
      observer.disconnect();
      resolve();
    };
    const observer = new Observer((list) => {
      if (list.getEntries().length > 0) finish();
    });
    observer.observe({ type, buffered: true });
    env.setTimeout(finish, PAINT_WAIT_CAP_MS);
  });
}

function frame(env: TriggerEnv): Promise<void> {
  return new Promise((resolve) => {
    env.requestAnimationFrame(() => {
      resolve();
    });
  });
}

/**
 * Resolves with the browser's first paint entry (or after the cap; at once without paint timing or a document): the
 * moment main.ts hydrates a static first paint (PA-15), so the hydration task never runs before that paint is presented.
 */
export function afterPaintEntry(env: TriggerEnv | null = browserEnv()): Promise<void> {
  return env === null ? Promise.resolve() : firstPaint(env);
}

/** Resolves once the page has painted (see the module comment); immediately where there is no document (SSR, tests). */
export async function afterFirstPaint(env: TriggerEnv | null = browserEnv()): Promise<void> {
  if (env === null) return;
  await contentLoaded(env);
  await (env.document.fonts?.ready ?? Promise.resolve());
  await firstPaint(env);
  await frame(env);
  await frame(env);
}

function browserEnv(): TriggerEnv | null {
  if (typeof document === 'undefined' || typeof requestAnimationFrame === 'undefined') return null;
  return {
    document,
    requestAnimationFrame: (callback) => requestAnimationFrame(callback),
    ...(typeof PerformanceObserver === 'undefined' ? {} : { PerformanceObserver }),
    setTimeout: (callback, ms) => setTimeout(callback, ms),
  };
}
