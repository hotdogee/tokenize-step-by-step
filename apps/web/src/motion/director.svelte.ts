/**
 * Drives the board's choreography from the timeline position (05 §7). `directMotion()` must be called while a component
 * initialises (it registers effects): a pre-effect snapshots the board BEFORE Svelte commits a new (stage, step) — the
 * rail renders before the board, so its pre-effect runs before the board's DOM update in the same flush — and an effect
 * plays the animations after the commit. Every change first cancels what is still running (`Animation.cancel()`), a step
 * change counts as fast scrubbing when it moves more than one step or comes < 100 ms after the previous one, and a new
 * result is never animated (WP13 owns the precomputed → live crossfade).
 *
 * At stop 5 it also marks the part the current step formed: `data-just-merged` (the star, motion.css), the hidden
 * "merged at this step" description added to the cell's `aria-describedby` (restored before the next commit, so the
 * board's own attributes are never left changed), the byte-tier caret under a merge's junction (`data-merge-caret`), the
 * pulse after a forward step and, in follow mode, a `scrollIntoView({ block: 'nearest' })` with the reduced-motion
 * behaviour — after every step change, also one that arrives at stop 5 from another stop ("show this step" or a
 * merge-list row from stop 6). On a virtualized board the board keeps the row holding that part mounted (Board.svelte
 * `mergedRow`), so the cells are there to mark and scroll to however far the jump went.
 *
 * The choreography (choreography.ts + flip.ts) is a lazy chunk loaded on the first interaction with the page; until it
 * arrives changes are discrete. Once loaded it also slides the bottom sheet in when it expands (`watchSheet`).
 */
import { untrack } from 'svelte';
import type { TokenizationResult, TokenizationView } from '@tsbs/core';
import { StepKind } from '@tsbs/core/model/result';
import type { AppState } from '../app/app-state.svelte.ts';
import type * as Choreography from './choreography.ts';
import { motionPrefs } from './motion-prefs.svelte.ts';

/** A step change within this many ms of the previous one is fast scrubbing (05 §7). */
export const FAST_SCRUB_MS = 100;
/** The merged part's pulse, or under reduced motion its static outline (05 §7). */
export const PULSE_MS = 600;

export interface DirectorOptions {
  /** The board's grid element, once mounted. */
  grid(): HTMLElement | null;
  /** The view of the current result (shared with the board, `board/view-cache.ts`). */
  view(): TokenizationView | null;
  /** Follow mode: keep the merged part in view. */
  follow(): boolean;
  /** Id of the hidden "merged at this step" description. */
  readonly describedBy: string;
}

interface Position {
  readonly stage: number;
  readonly step: number;
  readonly result: TokenizationResult | null;
  readonly at: number;
}

interface Mark {
  readonly el: HTMLElement;
  readonly describedBy: string | null;
}

export interface MotionDirector {
  /** Loads the choreography chunk (idempotent). */
  load(): Promise<void>;
  readonly loaded: boolean;
}

export function directMotion(app: AppState, options: DirectorOptions): MotionDirector {
  let choreography: typeof Choreography | null = null;
  let loading: Promise<void> | null = null;
  let last: Position | null = null;
  let prepared: Choreography.Prepared | null = null;
  let marks: Mark[] = [];
  /** Byte cells showing the merge caret (`data-merge-caret`). */
  let carets: HTMLElement[] = [];
  let outlineTimer: ReturnType<typeof setTimeout> | undefined;
  let stopSheet: (() => void) | null = null;
  let destroyed = false;

  $effect(() => () => {
    destroyed = true;
    stopSheet?.();
  });

  function clearMarks(): void {
    clearTimeout(outlineTimer);
    for (const { el, describedBy } of marks) {
      delete el.dataset['justMerged'];
      delete el.dataset['mergeOutline'];
      if (describedBy === null) el.removeAttribute('aria-describedby');
      else el.setAttribute('aria-describedby', describedBy);
    }
    marks = [];
    for (const el of carets) delete el.dataset['mergeCaret'];
    carets = [];
  }

  /** The cells (all fragments) of the parts step `k` formed: the merged part, or every byte of a split. */
  function formedCells(grid: HTMLElement, view: TokenizationView, k: number): HTMLElement[] {
    const timeline = view.result.timeline;
    const parts = view.partsAt(k);
    if (timeline === null || parts.justMerged < 0) return [];
    const end = timeline.stepKind[k - 1] === StepKind.ByteFallbackSplit ? (timeline.stepEnd[k - 1] ?? 0) : 0;
    const cells: HTMLElement[] = [];
    let i = parts.justMerged;
    do {
      cells.push(...grid.querySelectorAll<HTMLElement>(`[data-tier="token"][data-index="${String(i)}"]`));
      i++;
    } while ((parts.partStart[i] ?? end) < end);
    return cells;
  }

  /** Merge step `k`: the right part's index before it (the left part's index + 1), or null for a split / no timeline. */
  function rightPartOf(view: TokenizationView | null, k: number): number | null {
    const timeline = view?.result.timeline ?? null;
    if (view === null || timeline === null || k < 1 || k > view.stepCount) return null;
    if (timeline.stepKind[k - 1] !== StepKind.Merge) return null;
    const left = view.partsAt(k).justMerged;
    return left < 0 ? null : left + 1;
  }

  /** The byte cells (hex and dec rows) at the junction of merge step `k` (its right part's first byte). */
  function junctionCells(grid: HTMLElement, view: TokenizationView, k: number): HTMLElement[] {
    const timeline = view.result.timeline;
    if (timeline?.stepKind[k - 1] !== StepKind.Merge) return [];
    const mid = String(timeline.stepMid[k - 1] ?? 0);
    return [
      ...grid.querySelectorAll<HTMLElement>(
        `[data-tier="hex"][data-index="${mid}"], [data-tier="dec"][data-index="${mid}"]`,
      ),
    ];
  }

  function mark(cells: readonly HTMLElement[]): void {
    for (const el of cells) {
      const describedBy = el.getAttribute('aria-describedby');
      marks.push({ el, describedBy });
      el.dataset['justMerged'] = '';
      el.setAttribute(
        'aria-describedby',
        describedBy === null ? options.describedBy : `${describedBy} ${options.describedBy}`,
      );
    }
  }

  $effect.pre(() => {
    const stage = app.stage;
    const step = app.step;
    const result = app.currentResult;
    untrack(() => {
      clearMarks();
      prepared = null;
      const grid = options.grid();
      if (choreography === null || grid === null || last === null) return;
      choreography.cancelAll();
      if (result !== last.result) return;
      const reduced = motionPrefs.reduced;
      if (stage !== last.stage) {
        prepared = choreography.prepare(grid, { kind: 'stage', from: last.stage, to: stage }, reduced);
      } else if (stage === 5 && step !== last.step) {
        const fast = Math.abs(step - last.step) > 1 || performance.now() - last.at < FAST_SCRUB_MS;
        const forward = step > last.step;
        const mergeRight = !fast && forward ? rightPartOf(options.view(), step) : null;
        prepared = choreography.prepare(grid, { kind: 'step', fast, forward, mergeRight }, reduced);
      }
    });
  });

  $effect(() => {
    const stage = app.stage;
    const step = app.step;
    const result = app.currentResult;
    untrack(() => {
      const previous = last;
      last = { stage, step, result, at: performance.now() };
      prepared?.play();
      prepared = null;
      const grid = options.grid();
      const view = options.view();
      if (stage !== 5 || step < 1 || grid === null || view === null || step > view.stepCount) return;
      const cells = formedCells(grid, view, step);
      mark(cells);
      carets = junctionCells(grid, view, step);
      for (const el of carets) el.dataset['mergeCaret'] = '';
      const moved = previous !== null && previous.result === result && previous.step !== step;
      if (!moved) return;
      if (previous.stage === 5 && step === previous.step + 1 && last.at - previous.at >= FAST_SCRUB_MS) {
        if (!motionPrefs.reduced) {
          choreography?.pulse(cells);
          choreography?.revealCaret(carets);
        } else {
          // Reduced motion: a discrete swap and a 600 ms static outline — an attribute, not an animation.
          for (const el of cells) el.dataset['mergeOutline'] = '';
          outlineTimer = setTimeout(() => {
            for (const el of cells) delete el.dataset['mergeOutline'];
          }, PULSE_MS);
        }
      }
      const first = cells.find((el) => 'first' in el.dataset);
      if (options.follow())
        first?.scrollIntoView({ block: 'nearest', inline: 'nearest', behavior: motionPrefs.scrollBehavior });
    });
  });

  return {
    load() {
      loading ??= import('./choreography.ts').then(
        (module) => {
          choreography = module;
          if (!destroyed) stopSheet = module.watchSheet(document.body, () => motionPrefs.reduced);
        },
        () => {
          loading = null; // a stale deploy: stay discrete; the next interaction retries
        },
      );
      return loading;
    },
    get loaded() {
      return choreography !== null;
    },
  };
}
