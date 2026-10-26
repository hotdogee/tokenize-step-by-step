/**
 * The viewport facts the board depends on (05 §3.3, §5, §9; AD-34), as reactive `matchMedia` state: the inspector
 * surface by **width only** (≥ 1024 side rail, 768–1023 anchored panel, < 768 bottom sheet — pointer type never selects
 * it), the 480 px breakpoint that moves U+ labels, chunk brackets and narrow-chip ids on/off the board, hex **and** dec rows at
 * ≥ 1024 px. Reduced motion for `scrollIntoView` comes from motion/motion-prefs.svelte.ts (the system setting and the
 * in-app switch together). Server rendering (tests) gets the desktop defaults.
 *
 * A hydrated static first paint (PA-15, app/first-paint.ts) starts from the facts its board variant was rendered with, so
 * the first render matches the server's; the board then calls `watch()` once mounted and the real facts take over.
 */
import type { FirstPaintView } from '../app/first-paint.ts';

export type InspectorSurface = 'rail' | 'anchored' | 'sheet';

export class BoardViewport {
  /** ≥ 1024 px: side rail, hex and dec rows. */
  wide = $state(true);
  /** ≥ 768 px: no bottom sheet. */
  medium = $state(true);
  /** ≥ 480 px: U+ labels, chunk brackets and the ids of narrow chips on the board (05 §3.3). */
  small = $state(true);
  readonly #stops: Array<() => void> = [];
  #watching = false;

  /** `initial`: the facts of a hydrated first paint (watching starts with `watch()`); else the media queries, now. */
  constructor(initial: Pick<FirstPaintView, 'wide' | 'medium' | 'small'> | null = null) {
    if (initial === null) {
      this.watch();
      return;
    }
    this.wide = initial.wide;
    this.medium = initial.medium;
    this.small = initial.small;
  }

  /** Follows the media queries from now on (idempotent; a no-op without `matchMedia`, e.g. server rendering). */
  watch(): void {
    if (this.#watching || typeof window === 'undefined' || typeof window.matchMedia !== 'function') return;
    this.#watching = true;
    this.#watch('(min-width: 1024px)', (on) => (this.wide = on));
    this.#watch('(min-width: 768px)', (on) => (this.medium = on));
    this.#watch('(min-width: 480px)', (on) => (this.small = on));
  }

  /** The inspector surface for the current width (AD-34). */
  get surface(): InspectorSurface {
    if (this.wide) return 'rail';
    return this.medium ? 'anchored' : 'sheet';
  }

  #watch(query: string, set: (on: boolean) => void): void {
    const list = window.matchMedia(query);
    set(list.matches);
    const listener = (event: MediaQueryListEvent): void => {
      set(event.matches);
    };
    list.addEventListener('change', listener);
    this.#stops.push(() => {
      list.removeEventListener('change', listener);
    });
  }

  /** Stops listening (component teardown). */
  destroy(): void {
    for (const stop of this.#stops.splice(0)) stop();
  }
}
