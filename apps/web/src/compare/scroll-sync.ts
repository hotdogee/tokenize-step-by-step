/**
 * The comparison table's three horizontal scrollers kept in step (PA-19): a user scroll of any one moves the others to
 * the same `scrollLeft`. The echo of a programmatic move (its own `scroll` event, a frame later) is recognised and
 * ignored, so a scroller the user is still dragging is never pulled back to an older position. Listeners are passive.
 */
export interface ScrollSync {
  /** Moves every scroller to `left` (clamped by the browser) and reports where they ended up. */
  to(left: number): number;
  stop(): void;
}

export function syncScroll(elements: readonly HTMLElement[], onScroll: (left: number) => void): ScrollSync {
  /** What a programmatic move left each scroller at: its next `scroll` event at that position is the echo. */
  const expected = new Map<HTMLElement, number>();
  const drive = (from: HTMLElement | null, left: number): void => {
    for (const element of elements) {
      if (element === from || Math.abs(element.scrollLeft - left) <= 0.5) continue;
      element.scrollLeft = left;
      expected.set(element, element.scrollLeft);
    }
    onScroll(left);
  };
  const listeners = elements.map((element) => {
    const listener = (): void => {
      const left = element.scrollLeft;
      const echo = expected.get(element);
      expected.delete(element);
      if (echo !== undefined && Math.abs(left - echo) < 1) return;
      drive(element, left);
    };
    element.addEventListener('scroll', listener, { passive: true });
    return { element, listener };
  });
  return {
    to(left) {
      drive(null, left);
      const actual = elements[0]?.scrollLeft ?? left;
      if (Math.abs(actual - left) > 0.5) onScroll(actual);
      return actual;
    },
    stop() {
      for (const { element, listener } of listeners) element.removeEventListener('scroll', listener);
    },
  };
}
