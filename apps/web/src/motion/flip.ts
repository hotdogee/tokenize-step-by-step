/**
 * FLIP over WAAPI (05 §7), shared by the board's char boxes and token chips, **without reading layout after a commit**:
 *
 * - `snapshot(scopes, selector, keyOf, { geometry })` records each element's First horizontal span through a
 *   `Geometry` — computed from the board's byte-stable column model (AD-17: a gridcell's `aria-colindex`/`aria-colspan`,
 *   a char box's `--dx`/`--w`), never `getBoundingClientRect()` — the caller commits the DOM change, and `commit()`
 *   computes the Last spans the same way and pairs each element with its First by key (or with the old element that
 *   covered it: a merge grows from its left part, a split shatters out of its parent). Reading layout right after Svelte
 *   re-rendered hundreds of cells would force a synchronous style + layout pass inside the commit task.
 * - A `Plan` collects the animations of one commit. `start()` runs them now; `startAfterPaint()` shows their starting
 *   states without animating (by default the first keyframe as inline transform / opacity / clip-path, which create no
 *   compositor layers; a FLIP can hold its element's own geometry instead) and creates the animations once the commit
 *   frame has painted (two animation frames later), so a frame that already renders hundreds of new cells never also
 *   layerizes hundreds of animated elements (06 §3: no frame over 32 ms).
 * - Transform/opacity only; `will-change` exists only while an animation runs; every animation and every held start is
 *   registered, so `cancelAll()` stops a choreography mid-flight (and drops held inline styles) and fast scrubbing never
 *   queues.
 */

const running = new Set<Animation>();
/** Running registered animations per element: `will-change` is removed when the last one ends (no style flush). */
const active = new Map<Element, number>();
/** Starts held until after the commit frame painted; `cancel()` drops them and restores the inline styles. */
const held = new Set<{ cancel(): void }>();

/**
 * Animates `el` with `keyframes` (registered). `hint`: set `will-change` for the duration only — skipped for large batches,
 * where hundreds of style writes at the start and the end cost more than the hint saves. Null where WAAPI is missing.
 */
export function run(
  el: Element,
  keyframes: Keyframe[],
  options: KeyframeAnimationOptions,
  hint = true,
): Animation | null {
  if (!(el instanceof HTMLElement || el instanceof SVGElement) || typeof el.animate !== 'function') return null;
  const props = hint ? ['transform', 'opacity'].filter((prop) => keyframes.some((frame) => prop in frame)) : [];
  const current = el.style.getPropertyValue('will-change');
  for (const prop of current === '' ? [] : current.split(', ')) if (!props.includes(prop)) props.push(prop);
  if (props.length > 0) el.style.setProperty('will-change', props.join(', '));
  const animation = el.animate(keyframes, options);
  running.add(animation);
  active.set(el, (active.get(el) ?? 0) + 1);
  const done = (): void => {
    if (!running.delete(animation)) return;
    const left = (active.get(el) ?? 1) - 1;
    if (left > 0) active.set(el, left);
    else {
      active.delete(el);
      el.style.removeProperty('will-change');
    }
  };
  animation.addEventListener('finish', done);
  animation.addEventListener('cancel', done);
  return animation;
}

/** Cancels every running choreography animation and every held start (`Animation.cancel()` on a change, 05 §7). */
export function cancelAll(): void {
  for (const start of [...held]) start.cancel();
  for (const animation of [...running]) animation.cancel();
}

/** Number of registered animations still running (tests). */
export function runningCount(): number {
  return running.size;
}

/** Number of plans waiting for the commit frame to paint (tests). */
export function heldCount(): number {
  return held.size;
}

/**
 * Shows a planned animation's starting state until it starts (`Plan.startAfterPaint`); returns the function that
 * restores what it changed.
 */
export type Hold = () => () => void;

/** The inline properties the default hold may set: those of the first keyframe (no layout, no new layers). */
const HOLDABLE = ['transform', 'opacity', 'clipPath'] as const;

export interface PlanExtra {
  /** `will-change` while it runs (see `run`); default true. */
  readonly hint?: boolean;
  /** Runs once the animation finishes or is cancelled (or at once where WAAPI is missing). */
  readonly onEnd?: () => void;
  /**
   * How `startAfterPaint` shows the starting state in the frame that paints the commit: by default the first keyframe
   * as inline styles (where that is what the animation shows at t = 0: no delay, or a backwards fill); a custom hold
   * (a FLIP's First geometry, which keeps that frame from re-laying out and repainting the element at all) or null
   * (nothing: an ancestor's custom hold covers it) defer the first-keyframe hold by one frame (see `startAfterPaint`).
   */
  readonly hold?: Hold | null;
}

interface Planned {
  readonly el: HTMLElement | SVGElement;
  readonly keyframes: Keyframe[];
  readonly options: KeyframeAnimationOptions;
  readonly hint: boolean;
  readonly onEnd: () => void;
  /** The first keyframe as inline styles, or null where the animation does not show it at t = 0. */
  readonly keyframeHold: Hold | null;
  /** A custom first-frame hold (PlanExtra.hold); undefined: the keyframe hold from the start. */
  readonly customHold: Hold | null | undefined;
}

/** The default hold: the first keyframe's transform / opacity / clip-path as inline styles. */
function holdFirstKeyframe(
  el: HTMLElement | SVGElement,
  keyframes: Keyframe[],
  options: KeyframeAnimationOptions,
): Hold | null {
  const first = keyframes[0];
  const fill = options.fill ?? 'none';
  if (first === undefined || ((options.delay ?? 0) > 0 && fill !== 'backwards' && fill !== 'both')) return null;
  return () => {
    const saved: Array<readonly [string, string]> = [];
    for (const key of HOLDABLE) {
      const value = first[key];
      if (typeof value !== 'string' && typeof value !== 'number') continue;
      const prop = key === 'clipPath' ? 'clip-path' : key;
      saved.push([prop, el.style.getPropertyValue(prop)]);
      el.style.setProperty(prop, String(value));
    }
    return () => {
      for (const [prop, value] of saved) {
        if (value === '') el.style.removeProperty(prop);
        else el.style.setProperty(prop, value);
      }
    };
  };
}

/** The animations of one commit (see the module comment). */
export class Plan {
  readonly #items: Planned[] = [];
  #open = 0;
  #settled: Array<() => void> = [];

  /** Plans `keyframes` on `el`. Elements without WAAPI are skipped (their `onEnd` runs at once). */
  add(el: Element, keyframes: Keyframe[], options: KeyframeAnimationOptions, extra: PlanExtra = {}): void {
    if (!(el instanceof HTMLElement || el instanceof SVGElement) || typeof el.animate !== 'function') {
      extra.onEnd?.();
      return;
    }
    this.#open++;
    let ended = false;
    const onEnd = (): void => {
      if (ended) return;
      ended = true;
      extra.onEnd?.();
      if (--this.#open === 0) for (const callback of this.#settled.splice(0)) callback();
    };
    this.#items.push({
      el,
      keyframes,
      options,
      hint: extra.hint ?? true,
      onEnd,
      keyframeHold: holdFirstKeyframe(el, keyframes, options),
      customHold: extra.hold,
    });
  }

  get size(): number {
    return this.#items.length;
  }

  /** Runs `callback` once every planned animation has finished or been cancelled (at once when there are none). */
  onSettled(callback: () => void): void {
    if (this.#open === 0) callback();
    else this.#settled.push(callback);
  }

  /** Runs every planned animation now. */
  start(): void {
    for (const { el, keyframes, options, hint, onEnd } of this.#items) {
      const animation = run(el, keyframes, options, hint);
      if (animation === null) onEnd();
      else {
        animation.addEventListener('finish', onEnd, { once: true });
        animation.addEventListener('cancel', onEnd, { once: true });
      }
    }
  }

  /**
   * Shows every planned animation's starting state now without animating and starts the animations once the frame
   * that paints the commit has rendered (two animation frames later). With custom holds (`PlanExtra.hold`) the start
   * takes one more frame: the commit frame shows the custom holds (a FLIP's First geometry: no relayout or repaint of
   * those elements in that frame), the next frame swaps them for the first keyframes (the elements re-lay out and
   * repaint at their Last geometry under their inverted transforms), and the animations start in the frame after —
   * three frames, none of which renders the board, re-lays out the boxes and creates hundreds of compositor layers at
   * once. `cancelAll()` before the start drops it and restores whatever the holds changed.
   */
  startAfterPaint(): void {
    if (this.#items.length === 0) return;
    const items = this.#items;
    let restores: Array<() => void> = [];
    const apply = (holds: ReadonlyArray<Hold | null | undefined>): void => {
      for (const hold of holds) if (hold !== null && hold !== undefined) restores.push(hold());
    };
    const restore = (): void => {
      for (const undo of restores.splice(0)) undo();
    };
    const custom = items.some((item) => item.customHold !== undefined);
    apply(items.map((item) => (item.customHold === undefined ? item.keyframeHold : item.customHold)));
    let frame = 0;
    const entry = {
      cancel: () => {
        cancelAnimationFrame(frame);
        held.delete(entry);
        restore();
        for (const { onEnd } of items) onEnd();
      },
    };
    const start = (): void => {
      held.delete(entry);
      restore();
      this.start();
    };
    held.add(entry);
    // This callback runs before the commit frame renders; the one it requests, after that frame painted.
    frame = requestAnimationFrame(() => {
      frame = requestAnimationFrame(() => {
        if (!custom) {
          start();
          return;
        }
        restore();
        restores = [];
        apply(items.map((item) => item.keyframeHold));
        frame = requestAnimationFrame(start);
      });
    });
  }
}

/** A horizontal span in px, in the coordinates of the element's packed row. */
export interface Span {
  readonly left: number;
  readonly width: number;
}

/** An element's span from attributes and inline custom properties only (null = not taking part). Never reads layout. */
export type Geometry = (el: HTMLElement) => Span | null;

/** The containers a snapshot looks in, by name (the board's packed rows in the viewport, by row index). */
export type Scopes = ReadonlyMap<string, ParentNode>;

/** An element's key within its scope (null = not taking part). */
export type KeyOf = (el: HTMLElement, scope: string) => string | null;

export interface FlipPair {
  readonly el: HTMLElement;
  readonly first: Span;
  readonly last: Span;
}

/** Maps a key with no First of its own to the key of the old element that covered it, or null. */
export type CoverOf = (key: string, firsts: ReadonlyMap<string, Span>) => string | null;

export interface Snapshot {
  readonly firsts: ReadonlyMap<string, Span>;
  /** Pairs every element now matching the selector with its First span; `added` have none. */
  commit(): { readonly pairs: FlipPair[]; readonly added: HTMLElement[] };
}

export interface SnapshotOptions {
  /** Spans of the elements (FLIP layers). Without one only which elements are new is tracked (`added`). */
  readonly geometry?: Geometry;
  /** Pairs a key that has no First of its own with the old element that covered it. */
  readonly cover?: CoverOf;
}

const NONE: Span = { left: 0, width: 0 };

/**
 * First spans of the elements matching `selector` in each scope, keyed by `keyOf`; `commit()` pairs the Last ones (in the
 * same scopes, which outlive the commit).
 */
export function snapshot(scopes: Scopes, selector: string, keyOf: KeyOf, options: SnapshotOptions = {}): Snapshot {
  const geometry = options.geometry;
  const spanOf = (el: HTMLElement): Span | null => (geometry === undefined ? NONE : geometry(el));
  const firsts = new Map<string, Span>();
  for (const [scope, container] of scopes)
    for (const el of container.querySelectorAll<HTMLElement>(selector)) {
      const key = keyOf(el, scope);
      const span = key === null ? null : spanOf(el);
      if (key !== null && span !== null) firsts.set(key, span);
    }
  return {
    firsts,
    commit() {
      const pairs: FlipPair[] = [];
      const added: HTMLElement[] = [];
      for (const [scope, container] of scopes)
        for (const el of container.querySelectorAll<HTMLElement>(selector)) {
          const key = keyOf(el, scope);
          if (key === null) continue;
          const coverKey = firsts.has(key) ? key : (options.cover?.(key, firsts) ?? null);
          const first = coverKey === null ? undefined : firsts.get(coverKey);
          const last = first === undefined ? null : spanOf(el);
          if (first === undefined) added.push(el);
          else if (last !== null) pairs.push({ el, first, last });
        }
      return { pairs, added };
    },
  };
}

/** True when the pair did not move or resize (≤ 0.5 px). */
export function unchanged({ first, last }: FlipPair): boolean {
  return Math.abs(first.left - last.left) < 0.5 && Math.abs(first.width - last.width) < 0.5;
}

/**
 * Plans the pair's inverted transform (centre-based translate + scaleX) back to identity; `counter` children are
 * counter-scaled (sampled 1/scale keyframes) so glyphs and labels stay undistorted and only translate (AD-17). With a
 * custom `extra.hold` (the element's First geometry), the counters hold nothing: until the start nothing is transformed.
 */
export function flip(
  plan: Plan,
  pair: FlipPair,
  options: KeyframeAnimationOptions,
  counter: Iterable<Element> = [],
  extra: PlanExtra = {},
): void {
  const { el, first, last } = pair;
  if (last.width < 1 || first.width < 1) return;
  const dx = first.left + first.width / 2 - (last.left + last.width / 2);
  const sx = first.width / last.width;
  plan.add(
    el,
    [{ transform: `translateX(${String(dx)}px) scaleX(${String(sx)})` }, { transform: 'none' }],
    options,
    extra,
  );
  if (Math.abs(sx - 1) < 0.01) return;
  const frames: Keyframe[] = [];
  for (let i = 0; i <= 6; i++)
    frames.push({ offset: i / 6, transform: `scaleX(${String(1 / (sx + ((1 - sx) * i) / 6))})` });
  const counterExtra = extra.hold === undefined ? extra : { ...extra, hold: null };
  for (const child of counter) plan.add(child, frames, options, counterExtra);
}
