/**
 * Motion in chromium (05 §7): the stop 2→3 morph keeps its First state through the frame that paints the commit (no
 * animation, the boxes' stop-2 geometry) and then FLIPs the char boxes (glyphs counter-scaled) and unfolds the byte
 * cells, and a change before the start restores the board's own geometry; leaving stop 5 fades a copy of the chunk
 * brackets out; a merge step FLIPs the changed chips, slides a copy of the right part into the left one, draws the
 * byte-tier caret and marks the merged part (star, pulse, "merged at this step"), and a 1-column cell's pulse, or its
 * reduced-motion outline, settles to a 1 px ring at the chip's edge that stays; the bottom sheet slides in when it
 * expands; rapid scrubbing cancels the running FLIP (`Animation.cancel()`) and only crossfades, so
 * `document.getAnimations()` drains; the in-app reduced-motion switch leaves zero transform animations, opacity swaps ≤
 * 150 ms, `scrollIntoView` with `behavior: 'auto'` and the loading bar without a transition; the switch crossfade uses
 * a View Transition when `document.startViewTransition` exists and an opacity fade on the board when it does not.
 */
import '../theme/base.css';
import { flushSync } from 'svelte';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { page } from 'vitest/browser';
import { appWith, cellPx, fixtureResult, frames, rowEndSplit } from '../board/board.test-helper.ts';
import { animatesTransform, durations, mountRail, type MountedRail } from '../pipeline/pipeline.test-helper.ts';
import { cancelAll, heldCount, runningCount } from './flip.ts';
import { MOTION_KEY, MotionPrefs, motionPrefs } from './motion-prefs.svelte.ts';
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
  // The switch persists its override; the next test file's fresh MotionPrefs would read it (one origin, one storage).
  localStorage.removeItem(MOTION_KEY);
  delete document.documentElement.dataset['motion'];
  vi.restoreAllMocks();
});

const sleep = (ms: number): Promise<void> =>
  new Promise((resolve) => {
    setTimeout(resolve, ms);
  });

/**
 * Moves the timeline position and lets Svelte commit it (the director animates around the commit): a step animates at
 * once, a stage change three frames later (flip.ts `Plan.startAfterPaint`), so stage changes wait four frames.
 */
async function go(board: MountedRail, change: { stage?: 1 | 2 | 3 | 4 | 5 | 6; step?: number }): Promise<void> {
  if (change.stage !== undefined) board.app.setStage(change.stage);
  if (change.step !== undefined) board.app.step = change.step;
  flushSync();
  await frames(change.stage === undefined ? 1 : 4);
}

/**
 * Each char box's `--dx` / `--w` as the board wrote them; an empty side is the CSS default the board leaves unwritten (no
 * shift; the cell's span — CharCell.svelte, so the server-rendered first paint carries no `style` attribute, PA-15).
 */
function boxVars(grid: HTMLElement): string[] {
  return [...grid.querySelectorAll<HTMLElement>('.bd-box')].map(
    (box) => `${box.style.getPropertyValue('--dx')}/${box.style.getPropertyValue('--w')}`,
  );
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
  it('keeps the First state through the commit frame, then starts the animations', async () => {
    const board = await showDefault(2);
    const first = boxVars(board.grid);
    expect(first).toEqual(['/1', '-2/1', '-4/1', '-6/1']); // uniform cells left-packed over 3-byte columns
    board.app.setStage(3);
    flushSync(); // the board committed stop 3 ...
    expect(board.grid.querySelectorAll('.bd-cell-byte')).toHaveLength(12);
    expect(boxVars(board.grid)).toEqual(first); // ... but the boxes keep their stop-2 geometry for the commit frame
    expect(document.getAnimations()).toEqual([]);
    expect(heldCount()).toBe(1);
    await frames(2); // the frame after: the boxes at their byte spans under the inverted transform, still no animation
    expect(boxVars(board.grid)).toEqual(['/', '/', '/', '/']);
    for (const box of board.grid.querySelectorAll<HTMLElement>('.bd-box'))
      expect(box.offsetWidth).toBe((box.parentElement?.offsetWidth ?? 0) - 2); // the defaults: as wide as the 3 columns
    expect(document.getAnimations()).toEqual([]);
    const box = board.grid.querySelector<HTMLElement>('.bd-box');
    expect(box?.style.getPropertyValue('transform')).toMatch(/translateX\(.+px\) scaleX\(0\.3/);
    await frames(1);
    expect(heldCount()).toBe(0);
    expect(document.getAnimations().length).toBeGreaterThan(0);
    expect(box?.style.getPropertyValue('transform')).toBe(''); // the animation took over from the held keyframe
  });

  it("restores the board's own geometry when the position changes before the morph starts", async () => {
    const board = await showDefault(2);
    board.app.setStage(3);
    flushSync();
    board.app.setStage(4);
    flushSync(); // cancelled while held: the board's stop-3 values come back before it commits stop 4
    await frames(4);
    expect(boxVars(board.grid)).toEqual(['/', '/', '/', '/']);
    await drained();
    expect(heldCount()).toBe(0);
    for (const box of board.grid.querySelectorAll<HTMLElement>('.bd-box')) expect(box.style.transform).toBe('');
  });

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

describe('stop 5 → 6', () => {
  it('fades a detached copy of the leaving chunk brackets out, invisible to the board and assistive technology', async () => {
    const board = await showDefault(5, 8);
    expect(board.grid.querySelectorAll('[data-tier="chunk"]').length).toBeGreaterThan(0);
    await go(board, { stage: 6 });
    expect(board.grid.querySelectorAll('[data-tier="chunk"]')).toHaveLength(0);
    const ghosts = [...board.grid.querySelectorAll<HTMLElement>('.mo-ghost')];
    expect(ghosts.length).toBeGreaterThan(0);
    for (const ghost of ghosts) {
      expect(ghost.classList.contains('bd-tier-chunk')).toBe(true);
      expect(ghost.getAttribute('aria-hidden')).toBe('true');
      expect(ghost.inert).toBe(true);
      expect(ghost.querySelectorAll('[role], [tabindex], [id], [data-tier]')).toHaveLength(0);
      const fades = ghost
        .getAnimations()
        .map((a) => (a.effect as KeyframeEffect).getKeyframes().map((f) => f['opacity']));
      expect(fades).toEqual([['1', '0']]);
    }
    await drained();
    expect(board.grid.querySelectorAll('.mo-ghost')).toHaveLength(0);
  });
});

describe('merge steps (05 §7)', () => {
  it('FLIPs the changed chips, slides the right part into the left one, draws the caret, pulses and marks the merged part', async () => {
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
    const right = [...board.grid.querySelectorAll<HTMLElement>('.bd-tier-token > .mo-ghost')];
    expect(right).toHaveLength(1); // a copy of the right part, sliding the 2 px gap and fading into the merged chip
    expect(right[0]?.getAttribute('aria-hidden')).toBe('true');
    expect(right[0]?.hasAttribute('data-tier')).toBe(false);
    const slide = right[0]?.getAnimations()[0]?.effect as KeyframeEffect | undefined;
    expect(slide?.getKeyframes().map((f) => [f['opacity'], f['transform']])).toEqual([
      ['1', 'none'],
      ['0', 'translateX(-2px)'],
    ]);
    const carets = [...board.grid.querySelectorAll<HTMLElement>('[data-merge-caret]')];
    expect(carets.length).toBeGreaterThan(0); // under the junction, in each byte row
    for (const caret of carets) expect(caret.closest('.bd-cell-byte')).toBe(caret);
    await drained();
    expect(board.grid.querySelectorAll('.mo-ghost')).toHaveLength(0);
    await go(board, { step: 5 });
    for (const caret of carets) expect(caret.hasAttribute('data-merge-caret')).toBe(false); // the next step's own
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

describe('the 1-column just-merged ring (PA-17)', () => {
  afterEach(async () => {
    document.documentElement.dataset['cellSize'] = 'M';
    await page.viewport(1440, 900);
  });

  /** The cell's `::before` outline as computed, its animation included. */
  const outline = (cell: Element): { opacity: string; width: string; offset: string } => {
    const style = getComputedStyle(cell, '::before');
    return { opacity: style.opacity, width: style.outlineWidth, offset: style.outlineOffset };
  };
  const px = (value: string): number => Number.parseFloat(value);

  for (const [width, size, cellSize] of [
    [1280, 'S', 27],
    [600, 'M', 36],
  ] as const) {
    for (const reduced of [false, true]) {
      it(`settles a 1-column cell's pulse to a 1 px ring at the chip's edge, ${reduced ? 'reduced' : 'full'} motion, ${String(cellSize)} px cell`, async () => {
        await page.viewport(width, 900);
        document.documentElement.dataset['cellSize'] = size;
        expect(cellPx()).toBe(cellSize);
        motionPrefs.override = reduced ? 'reduce' : 'full';
        // A 3-byte part the row end cuts 1 | 2, formed by the second of two merge steps (the board's K first).
        mounted = await mountRail(appWith(rowEndSplit(8, [], 654321, 2), { stage: 5, step: 1 }));
        const k = Number(mounted.grid.getAttribute('aria-colcount'));
        mounted.destroy();
        const board = await mountRail(appWith(rowEndSplit(k, [], 654321, 2), { stage: 5, step: 1 }));
        mounted = board;
        await drained();
        await sleep(150); // not a fast scrub
        await go(board, { step: 2 });
        const merged = [...board.grid.querySelectorAll<HTMLElement>('[data-tier="token"][data-just-merged]')];
        expect(merged.map((cell) => cell.getAttribute('aria-colspan'))).toEqual(['1', '2']);
        const [narrow, wide] = merged;
        if (narrow === undefined || wide === undefined) throw new Error('no part cut 1 | 2');
        if (!reduced) {
          // The WAAPI pulse: the 1-column cell's ends at the ring, the wider one's at opacity 0.
          const last = (cell: Element): Keyframe | undefined =>
            cell
              .getAnimations({ subtree: true })
              .map((animation) => animation.effect)
              .find(
                (effect): effect is KeyframeEffect =>
                  effect instanceof KeyframeEffect && effect.pseudoElement === '::before',
              )
              ?.getKeyframes()
              .at(-1);
          expect(last(narrow)).toMatchObject({ opacity: '1', outlineWidth: '1px', outlineOffset: '0px' });
          expect(last(wide)).toMatchObject({ opacity: '0' });
          expect(last(wide)).not.toHaveProperty('outlineWidth');
        } else expect(narrow.hasAttribute('data-merge-outline')).toBe(true);
        await sleep(150);
        expect(outline(narrow)).toMatchObject({ width: '2px', offset: '1px' }); // the pulse's 2 px geometry
        if (reduced) expect(outline(narrow).opacity).toBe('1');
        await sleep(850); // 1 s after the step
        expect(outline(narrow)).toEqual({ opacity: '1', width: '1px', offset: '0px' });
        expect(outline(wide).opacity).toBe('0');
        expect(getComputedStyle(wide.querySelector('.bd-chip') ?? wide, '::after').content).not.toBe('none'); // star
        // The ring lies on the chip's border box: the cell's `::before` is inset 0 1px, as the chip is.
        const before = getComputedStyle(narrow, '::before');
        const box = narrow.getBoundingClientRect();
        const chip = (narrow.querySelector('.bd-chip') ?? narrow).getBoundingClientRect();
        expect(box.left + px(before.left)).toBeCloseTo(chip.left, 2);
        expect(box.top + px(before.top)).toBeCloseTo(chip.top, 2);
        expect(px(before.width)).toBeCloseTo(chip.width, 2);
        expect(px(before.height)).toBeCloseTo(chip.height, 2);
        // Reached by scrubbing (no pulse), the cell carries the ring at once.
        await go(board, { step: 1 });
        await go(board, { step: 2 });
        const scrubbed = board.grid.querySelector('[data-tier="token"][data-just-merged].s1') ?? board.grid;
        expect(outline(scrubbed)).toEqual({ opacity: '1', width: '1px', offset: '0px' });
      });
    }
  }
});

describe('bottom sheet (< 768 px)', () => {
  it('slides up and fades in when it expands and fades when it collapses; reduced motion: opacity only', async () => {
    const { watchSheet } = await import('./choreography.ts');
    const host = document.createElement('div');
    host.dataset['surface'] = 'sheet';
    host.dataset['expanded'] = 'false';
    document.body.append(host);
    let reduced = false;
    const stop = watchSheet(document.body, () => reduced);
    try {
      host.dataset['expanded'] = 'true';
      await frames(1);
      const slide = host.getAnimations();
      expect(slide.some(animatesTransform)).toBe(true);
      expect(durations(slide)).toEqual([200]);
      cancelAll();
      host.dataset['expanded'] = 'false';
      await frames(1);
      expect(host.getAnimations().filter(animatesTransform)).toEqual([]);
      expect(host.getAnimations()).toHaveLength(1);
      cancelAll();
      reduced = true;
      host.dataset['expanded'] = 'true';
      await frames(1);
      expect(host.getAnimations().filter(animatesTransform)).toEqual([]);
      expect(durations(host.getAnimations())).toEqual([120]);
    } finally {
      stop();
      host.remove();
    }
  });
});

describe('reduced motion (system setting, observed live)', () => {
  it('follows a live prefers-reduced-motion change unless the in-app switch overrides it', () => {
    const listeners: Array<(event: MediaQueryListEvent) => void> = [];
    const query = {
      matches: false,
      media: '(prefers-reduced-motion: reduce)',
      addEventListener: (_type: string, listener: (event: MediaQueryListEvent) => void) => listeners.push(listener),
      removeEventListener: () => undefined,
    } as unknown as MediaQueryList;
    const matchMedia = vi.spyOn(window, 'matchMedia').mockReturnValue(query);
    const change = (matches: boolean): void => {
      for (const listener of listeners) listener({ matches } as MediaQueryListEvent);
    };
    const prefs = new MotionPrefs(null);
    expect(matchMedia).toHaveBeenCalledWith('(prefers-reduced-motion: reduce)');
    expect(prefs).toMatchObject({ system: false, reduced: false, scrollBehavior: 'smooth' });
    change(true); // the user turns on "reduce motion" in the OS while the page is open
    expect(prefs).toMatchObject({ system: true, reduced: true, scrollBehavior: 'auto' });
    expect(document.documentElement.dataset['motion']).toBe('reduced');
    change(false);
    expect(prefs.reduced).toBe(false);
    expect(document.documentElement.dataset['motion']).toBeUndefined();
    prefs.override = 'reduce'; // the in-app switch wins over the system setting
    change(false);
    expect(prefs.reduced).toBe(true);
    prefs.override = 'full';
    change(true);
    expect(prefs.reduced).toBe(false);
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

  it('handles a transition skipped by the next one: its rejected ready and finished are never unhandled', async () => {
    const target = document.createElement('section');
    document.body.append(target);
    const unhandled: unknown[] = [];
    const onUnhandled = (event: PromiseRejectionEvent): void => {
      unhandled.push(event.reason);
    };
    window.addEventListener('unhandledrejection', onUnhandled);
    // What Chromium and WebKit hand back when a new transition starts before this one is ready.
    const skipped = (): Promise<void> =>
      Promise.reject(new DOMException('Transition was skipped. New ViewTransition started', 'AbortError'));
    vi.spyOn(document, 'startViewTransition').mockImplementation((callback) => {
      const done = Promise.resolve(typeof callback === 'function' ? callback() : undefined).then(() => undefined);
      return {
        finished: skipped(),
        updateCallbackDone: done,
        ready: skipped(),
        skipTransition: () => undefined,
      } as unknown as ViewTransition;
    });
    try {
      let applied = false;
      await crossfade(
        target,
        () => {
          applied = true;
        },
        false,
      );
      expect(applied).toBe(true);
      await frames(2);
      expect(unhandled).toEqual([]);
      expect(target.style.getPropertyValue('view-transition-name')).toBe('');
    } finally {
      window.removeEventListener('unhandledrejection', onUnhandled);
      target.remove();
    }
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
