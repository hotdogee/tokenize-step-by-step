/**
 * FLIP over WAAPI (05 §7), shared by the board's char boxes and token chips: `snapshot(container, selector, keyOf)` records
 * the First rects, the caller commits the DOM change, `commit()` reads the Last rects and pairs each element with its First
 * by key (or with the old element that covered it: a merge grows from its left part, a split shatters out of its parent),
 * and `flip()` plays the inverted translate + scaleX back to identity. Transform/opacity only; `will-change` exists only
 * while an animation runs; every animation is registered so `cancelAll()` stops a choreography mid-flight and fast
 * scrubbing never queues.
 */

const running = new Set<Animation>();
/** Running registered animations per element: `will-change` is removed when the last one ends (no style flush). */
const active = new Map<Element, number>();

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

/** Cancels every running choreography animation (`Animation.cancel()` on a step change, 05 §7). */
export function cancelAll(): void {
  for (const animation of [...running]) animation.cancel();
}

/** Number of registered animations still running (tests). */
export function runningCount(): number {
  return running.size;
}

export type KeyOf = (el: HTMLElement) => string | null;

export interface FlipPair {
  readonly el: HTMLElement;
  readonly first: DOMRect;
  readonly last: DOMRect;
}

/** Maps a key with no First of its own to the key of the old element that covered it, or null. */
export type CoverOf = (key: string, firsts: ReadonlyMap<string, DOMRect>) => string | null;

export interface Snapshot {
  readonly firsts: ReadonlyMap<string, DOMRect>;
  /** Pairs every element now matching the selector with its First rect; `added` have none. */
  commit(): { readonly pairs: FlipPair[]; readonly added: HTMLElement[] };
}

export interface SnapshotOptions {
  /** Pairs a key that has no First of its own with the old element that covered it. */
  readonly cover?: CoverOf;
  /** false: only track which elements are new (`added`); no rects are read (default true). */
  readonly measure?: boolean;
}

const UNMEASURED = new DOMRect();

/**
 * First rects of the elements matching `selector` under `container`, keyed by `keyOf` (null = not taking part);
 * `commit()` pairs the Last ones.
 */
export function snapshot(
  container: ParentNode,
  selector: string,
  keyOf: KeyOf,
  options: SnapshotOptions = {},
): Snapshot {
  const measure = options.measure ?? true;
  const rectOf = (el: HTMLElement): DOMRect => (measure ? el.getBoundingClientRect() : UNMEASURED);
  const firsts = new Map<string, DOMRect>();
  for (const el of container.querySelectorAll<HTMLElement>(selector)) {
    const key = keyOf(el);
    if (key !== null) firsts.set(key, rectOf(el));
  }
  return {
    firsts,
    commit() {
      const pairs: FlipPair[] = [];
      const added: HTMLElement[] = [];
      for (const el of container.querySelectorAll<HTMLElement>(selector)) {
        const key = keyOf(el);
        if (key === null) continue;
        const coverKey = firsts.has(key) ? key : (options.cover?.(key, firsts) ?? null);
        const first = coverKey === null ? undefined : firsts.get(coverKey);
        if (first === undefined) added.push(el);
        else pairs.push({ el, first, last: rectOf(el) });
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
 * Plays the pair's inverted transform (centre-based translate + scaleX) back to identity; `counter` children are
 * counter-scaled (sampled 1/scale keyframes) so glyphs and labels stay undistorted and only translate (AD-17).
 */
export function flip(
  pair: FlipPair,
  options: KeyframeAnimationOptions,
  counter: Iterable<Element> = [],
  hint = true,
): void {
  const { el, first, last } = pair;
  if (last.width < 1 || first.width < 1) return;
  const dx = first.left + first.width / 2 - (last.left + last.width / 2);
  const sx = first.width / last.width;
  run(el, [{ transform: `translateX(${String(dx)}px) scaleX(${String(sx)})` }, { transform: 'none' }], options, hint);
  if (Math.abs(sx - 1) < 0.01) return;
  const frames: Keyframe[] = [];
  for (let i = 0; i <= 6; i++)
    frames.push({ offset: i / 6, transform: `scaleX(${String(1 / (sx + ((1 - sx) * i) / 6))})` });
  for (const child of counter) run(child, frames, options, hint);
}
