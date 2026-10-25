/**
 * Motion preferences (05 §7 rules, §1.1 persistence): `prefers-reduced-motion` observed live through `matchMedia`, with an
 * in-app override persisted in localStorage (`tsbs:motion`: `reduce` | `full`; absent = follow the system). Under reduced
 * motion no transform animates, only opacity swaps ≤ 150 ms remain, every programmatic scroll uses `behavior: 'auto'`, and
 * `<html data-motion="reduced">` switches CSS transitions off (the picker's loading bar: `transition: none`, motion.css).
 * Server rendering (tests) sees full motion and touches no DOM.
 */
import { readStored, writeStored } from '../app/storage.ts';

/** localStorage key of the in-app override (namespaced like the shell's keys in app/storage.ts). */
export const MOTION_KEY = 'tsbs:motion';

export type MotionOverride = 'reduce' | 'full' | null;

function readOverride(): MotionOverride {
  const stored = readStored(MOTION_KEY);
  return stored === 'reduce' || stored === 'full' ? stored : null;
}

export class MotionPrefs {
  /** The system's `prefers-reduced-motion: reduce`, live. */
  system = $state(false);
  /** The in-app override; null follows the system. */
  override: MotionOverride = $state(null);
  #query: MediaQueryList | null = null;

  constructor(override: MotionOverride = readOverride()) {
    this.override = override;
    if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return;
    this.#query = window.matchMedia('(prefers-reduced-motion: reduce)');
    this.system = this.#query.matches;
    this.#query.addEventListener('change', (event) => {
      this.system = event.matches;
      this.#apply();
    });
    this.#apply();
  }

  /** Reduced motion in effect (override first, then the system). */
  get reduced(): boolean {
    return this.override === null ? this.system : this.override === 'reduce';
  }

  /** `scrollIntoView` behaviour for programmatic scrolls (05 §2 follow mode, §7). */
  get scrollBehavior(): ScrollBehavior {
    return this.reduced ? 'auto' : 'smooth';
  }

  /** Sets the override from the in-app switch (checked = reduce); persisted. */
  setReduced(on: boolean): void {
    this.override = on === this.system ? null : on ? 'reduce' : 'full';
    writeStored(MOTION_KEY, this.override ?? '');
    this.#apply();
  }

  #apply(): void {
    if (typeof document === 'undefined') return;
    const root = document.documentElement;
    if (this.reduced) root.dataset['motion'] = 'reduced';
    else delete root.dataset['motion'];
  }
}

/** The page's motion preferences. */
export const motionPrefs = new MotionPrefs();
