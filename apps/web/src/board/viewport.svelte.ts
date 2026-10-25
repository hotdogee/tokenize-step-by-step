/**
 * The viewport facts the board depends on (05 §3.3, §5, §9; AD-34), as reactive `matchMedia` state: the inspector
 * surface by **width only** (≥ 1024 side rail, 768–1023 anchored panel, < 768 bottom sheet — pointer type never selects
 * it), the 480 px breakpoint that moves U+ labels, chunk brackets and narrow-chip ids on/off the board, hex **and** dec rows at
 * ≥ 1024 px, and reduced motion for `scrollIntoView`. Server rendering (tests) gets the desktop defaults.
 */

export type InspectorSurface = 'rail' | 'anchored' | 'sheet';

export class BoardViewport {
  /** ≥ 1024 px: side rail, hex and dec rows. */
  wide = $state(true);
  /** ≥ 768 px: no bottom sheet. */
  medium = $state(true);
  /** ≥ 480 px: U+ labels, chunk brackets and the ids of narrow chips on the board (05 §3.3). */
  small = $state(true);
  reducedMotion = $state(false);
  readonly #stops: Array<() => void> = [];

  constructor() {
    if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return;
    this.#watch('(min-width: 1024px)', (on) => (this.wide = on));
    this.#watch('(min-width: 768px)', (on) => (this.medium = on));
    this.#watch('(min-width: 480px)', (on) => (this.small = on));
    this.#watch('(prefers-reduced-motion: reduce)', (on) => (this.reducedMotion = on));
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
