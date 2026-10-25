/**
 * Motion in chromium (05 §7): the stop 2→3 morph FLIPs the char boxes (glyphs counter-scaled) and unfolds the byte cells;
 * a merge step FLIPs the changed chips and marks the merged part (star, pulse, "merged at this step"); rapid scrubbing
 * cancels the running FLIP (`Animation.cancel()`) and only crossfades, so `document.getAnimations()` drains; the in-app
 * reduced-motion switch leaves zero transform animations, opacity swaps ≤ 150 ms, `scrollIntoView` with
 * `behavior: 'auto'` and the loading bar without a transition; the switch crossfade uses a View Transition when
 * `document.startViewTransition` exists and an opacity fade on the board when it does not.
 */
import '../theme/base.css';
import { flushSync } from 'svelte';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { appWith, fixtureResult, frames } from '../board/board.test-helper.ts';
import { animatesTransform, durations, mountRail, type MountedRail } from '../pipeline/pipeline.test-helper.ts';
import { cancelAll, runningCount } from './flip.ts';
import { motionPrefs } from './motion-prefs.svelte.ts';
import { crossfade, startViewTransitionOf, wrapSwitches } from './view-transition.ts';

let mounted: MountedRail | null = null;

beforeEach(() => {
  motionPrefs.override = 'full';
});

afterEach(() => {
  mounted?.destroy();
  mounted = null;
  cancelAll();
  motionPrefs.override = null;
  delete document.documentElement.dataset['motion'];
  vi.restoreAllMocks();
});

const sleep = (ms: number): Promise<void> =>
  new Promise((resolve) => {
    setTimeout(resolve, ms);
  });

/** Moves the timeline position and lets Svelte commit it (the director animates around the commit). */
async function go(board: MountedRail, change: { stage?: 1 | 2 | 3 | 4 | 5 | 6; step?: number }): Promise<void> {
  if (change.stage !== undefined) board.app.setStage(change.stage);
  if (change.step !== undefined) board.app.step = change.step;
  flushSync();
  await frames(1);
}

/** Waits until every animation on the page has finished. */
async function drained(): Promise<void> {
  for (let i = 0; i < 100 && document.getAnimations().length > 0; i++) await sleep(20);
}

async function showDefault(stage: 1 | 2 | 3 | 4 | 5 | 6, step?: number): Promise<MountedRail> {
  mounted = await mountRail(appWith(fixtureResult('openai-o200k_base', 'zh-tw-tainan'), { stage, step: step ?? 0 }));
  await drained();
  return mounted;
}

describe('stop 2 → 3 (the "aha" morph, AD-17)', () => {
  it('FLIPs the char boxes with translate + scaleX, counter-scales the glyphs and unfolds the byte cells', async () => {
    const board = await showDefault(2);
    await go(board, { stage: 3 });
    const animations = document.getAnimations();
    const targets = animations.map((a) => (a.effect as KeyframeEffect).target as HTMLElement);
    const boxes = targets.filter((el) => el.classList.contains('bd-box'));
    expect(boxes.length).toBe(4); // 台灣台南: four char boxes change width
    expect(
      animations
        .filter((a) => (a.effect as KeyframeEffect).target?.classList.contains('bd-box'))
        .every(animatesTransform),
    ).toBe(true);
    const first = (
      animations.find((a) => boxes.includes((a.effect as KeyframeEffect).target as HTMLElement))
        ?.effect as KeyframeEffect
    ).getKeyframes()[0];
    expect(String(first?.['transform'])).toMatch(/translateX\(.+px\) scaleX\(0\.3/); // uniform cell → 3 byte columns
    expect(targets.filter((el) => el.classList.contains('bd-glyph'))).toHaveLength(4);
    expect(targets.filter((el) => el.classList.contains('bd-face'))).toHaveLength(12); // 12 bytes unfold
    expect(durations(animations).every((ms) => ms === 350)).toBe(true);
    for (const box of boxes) expect(box.style.getPropertyValue('will-change')).toBe('transform');
    await drained();
    for (const box of boxes) expect(box.style.getPropertyValue('will-change')).toBe(''); // only while animating
  });
});

describe('merge steps (05 §7)', () => {
  it('FLIPs the changed chips, pulses and marks the merged part', async () => {
    const board = await showDefault(5, 3);
    await sleep(150); // not a fast scrub
    await go(board, { step: 4 });
    const merged = board.grid.querySelectorAll<HTMLElement>('[data-tier="token"][data-just-merged]');
    expect(merged.length).toBeGreaterThan(0);
    for (const cell of merged) expect(cell.getAttribute('aria-describedby')).toContain('tsbs-just-merged');
    expect(document.getElementById('tsbs-just-merged')?.textContent).toBe('merged at this step');
    const animations = document.getAnimations();
    expect(animations.some(animatesTransform)).toBe(true);
    expect(animations.some((a) => (a.effect as KeyframeEffect).pseudoElement === '::before')).toBe(true); // the pulse
  });

  it('cancels the running FLIP on a rapid scrub and only crossfades, so the animations drain', async () => {
    const board = await showDefault(5, 1);
    await sleep(150);
    await go(board, { step: 2 });
    const flipping = document.getAnimations();
    expect(flipping.some(animatesTransform)).toBe(true);
    await go(board, { step: 3 });
    await go(board, { step: 4 });
    await go(board, { step: 6 });
    for (const animation of flipping) expect(animation.playState).toBe('idle'); // Animation.cancel()
    expect(document.getAnimations().filter(animatesTransform)).toEqual([]);
    expect(durations(document.getAnimations()).every((ms) => ms <= 80)).toBe(true);
    await sleep(150);
    expect(document.getAnimations()).toEqual([]);
    expect(runningCount()).toBe(0);
  });
});

describe('reduced motion (in-app switch)', () => {
  it('turns transform animations off, keeps opacity swaps ≤ 150 ms and scrolls with behavior "auto"', async () => {
    const board = await showDefault(2);
    const scrolls: Array<ScrollIntoViewOptions | boolean | undefined> = [];
    vi.spyOn(Element.prototype, 'scrollIntoView').mockImplementation((options) => {
      scrolls.push(options);
    });
    const toggle = board.rail.querySelector<HTMLInputElement>('[data-testid="reduce-motion"]');
    expect(toggle?.getAttribute('role')).toBe('switch');
    toggle?.click(); // full → reduced (the override was 'full')
    flushSync();
    expect(motionPrefs.reduced).toBe(true);
    expect(document.documentElement.dataset['motion']).toBe('reduced');
    await go(board, { stage: 3 });
    const animations = document.getAnimations();
    expect(animations.length).toBeGreaterThan(0);
    expect(animations.filter(animatesTransform)).toEqual([]);
    expect(Math.max(...durations(animations))).toBeLessThanOrEqual(150);
    await drained();
    await go(board, { stage: 5, step: 2 });
    await sleep(150);
    await go(board, { step: 3 });
    expect(document.getAnimations().filter(animatesTransform)).toEqual([]);
    const outlined = board.grid.querySelectorAll('[data-merge-outline]'); // the static 600 ms outline
    expect(outlined.length).toBeGreaterThan(0);
    expect(scrolls.length).toBeGreaterThan(0);
    for (const options of scrolls) expect(options).toMatchObject({ behavior: 'auto', block: 'nearest' });
  });

  it('gives the loading bar no transition', async () => {
    const app = appWith(fixtureResult('openai-o200k_base', 'zh-tw-tainan'));
    app.loading = { tokenizer: 'google-gemma4', phase: 'download', loaded: 10, total: 100 };
    mounted = await mountRail(app, { picker: true, motion: false });
    const bar = mounted.target.querySelector<HTMLElement>('[role="progressbar"]');
    expect(bar).not.toBeNull();
    if (bar === null) return;
    expect(getComputedStyle(bar).transitionDuration).not.toBe('0s');
    motionPrefs.setReduced(true);
    expect(getComputedStyle(bar).transitionDuration).toBe('0s');
    expect(getComputedStyle(bar).transitionProperty).toBe('none');
  });
});

describe('switch crossfades (View Transition with an opacity fallback)', () => {
  it('falls back to an opacity fade of the board when startViewTransition is absent', async () => {
    const proto = Document.prototype as unknown as { startViewTransition?: unknown };
    const original = proto.startViewTransition;
    delete proto.startViewTransition;
    try {
      expect(startViewTransitionOf()).toBeNull();
      const target = document.createElement('div');
      document.body.append(target);
      let applied = false;
      const done = crossfade(
        target,
        () => {
          applied = true;
        },
        false,
      );
      expect(applied).toBe(true); // applied at once, no snapshot to wait for
      await done;
      const fades = target.getAnimations();
      expect(fades).toHaveLength(1);
      expect(fades.filter(animatesTransform)).toEqual([]);
      expect((fades[0]?.effect as KeyframeEffect).getKeyframes().map((frame) => frame['opacity'])).toEqual([
        '0.3',
        '1',
      ]);
      expect(durations(fades)).toEqual([220]);
      target.remove();
    } finally {
      proto.startViewTransition = original;
    }
  });

  it('uses document.startViewTransition with the board named, and nothing under reduced motion', async () => {
    const target = document.createElement('section');
    document.body.append(target);
    const calls: string[] = [];
    const spy = vi.spyOn(document, 'startViewTransition');
    spy.mockImplementation((callback) => {
      calls.push(target.style.getPropertyValue('view-transition-name'));
      const done = Promise.resolve(typeof callback === 'function' ? callback() : undefined).then(() => undefined);
      return {
        finished: done,
        updateCallbackDone: done,
        ready: done,
        skipTransition: () => undefined,
      } as unknown as ViewTransition;
    });
    let applied = 0;
    const apply = (): void => {
      applied += 1;
    };
    await crossfade(target, apply, false);
    expect(calls).toEqual(['tsbs-board']);
    expect(applied).toBe(1);
    await crossfade(target, apply, true);
    expect(calls).toHaveLength(1);
    expect(applied).toBe(2);
    target.remove();
  });

  it('wraps the byte-view, tokenizer and locale switches and restores them', async () => {
    const proto = Document.prototype as unknown as { startViewTransition?: unknown };
    const original = proto.startViewTransition;
    delete proto.startViewTransition;
    try {
      const seen: string[] = [];
      const app = {
        setByteView(view: 'hex' | 'dec' | 'both') {
          seen.push(`view:${view}`);
        },
        selectTokenizer(id: never): Promise<void> {
          seen.push(`tokenizer:${String(id)}`);
          return Promise.resolve();
        },
      };
      const locale = {
        set(value: never) {
          seen.push(`locale:${String(value)}`);
        },
      };
      const board = document.createElement('div');
      document.body.append(board);
      const restore = wrapSwitches(
        { app, locale },
        () => board,
        () => false,
      );
      app.setByteView('dec');
      await app.selectTokenizer('xai-grok2' as never);
      locale.set('ja' as never);
      expect(seen).toEqual(['view:dec', 'tokenizer:xai-grok2', 'locale:ja']);
      await frames(1);
      expect(board.getAnimations().length).toBeGreaterThan(0);
      restore();
      for (const animation of board.getAnimations()) animation.cancel();
      app.setByteView('hex'); // the original again: no crossfade
      await frames(1);
      expect(seen.at(-1)).toBe('view:hex');
      expect(board.getAnimations()).toEqual([]);
      board.remove();
    } finally {
      proto.startViewTransition = original;
    }
  });
});
