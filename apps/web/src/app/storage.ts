/**
 * `localStorage` / `sessionStorage` access that never throws (private mode, blocked storage, quota; 05 §1.1: every read
 * and write in try/catch). Keys are namespaced `tsbs:` and shared with boot.ts, which cannot import this module.
 */

export const STORAGE_KEYS = {
  locale: 'tsbs:locale',
  theme: 'tsbs:theme',
  byteView: 'tsbs:byteView',
  graphemes: 'tsbs:graphemes',
  cellSize: 'tsbs:cellSize',
  singleKeyShortcuts: 'tsbs:singleKeyShortcuts',
  /** sessionStorage: the last `loaded` diagnostics, shown on About › Diagnostics (05 §14). */
  lastLoaded: 'tsbs:lastLoaded',
  /** sessionStorage: the Worker's `ready.features`, shown on About › Diagnostics next to the main thread's own probe. */
  workerFeatures: 'tsbs:workerFeatures',
} as const;

type Area = 'local' | 'session';

function area(kind: Area): Storage | null {
  try {
    return kind === 'local' ? globalThis.localStorage : globalThis.sessionStorage;
  } catch {
    return null;
  }
}

/** The stored string, or null when absent or unreadable. */
export function readStored(key: string, kind: Area = 'local'): string | null {
  try {
    return area(kind)?.getItem(key) ?? null;
  } catch {
    return null;
  }
}

/** Stores a string; failures are ignored (the setting then lasts for this page view only). */
export function writeStored(key: string, value: string, kind: Area = 'local'): void {
  try {
    area(kind)?.setItem(key, value);
  } catch {
    // Storage unavailable: keep the in-memory value.
  }
}
