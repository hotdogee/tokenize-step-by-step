/**
 * Whole-board crossfades for the tokenizer, byte-view and locale switches (05 §7): `document.startViewTransition` with one
 * `view-transition-name` on the board container (Chrome 111 / Safari 18 / Firefox 144), FEATURE-detected — never by user
 * agent — with an opacity fallback where the API is absent (Safari 16–17, Firefox < 144), and instant under reduced
 * motion. A View Transition snapshots the old state before its callback runs, so the state change must start inside the
 * callback: `wrapSwitches()` therefore wraps the three entry points every caller goes through (`AppState.setByteView` —
 * also behind `cycleByteView`/`h` —, `AppState.selectTokenizer`, `LocaleStore.set`) on the page's instances and returns
 * the function that restores them. The precomputed → live result crossfade is WP13's.
 */
import { tick } from 'svelte';

/** Switch crossfade duration (05 §7). */
export const SWITCH_MS = 220;
/** The board container's `view-transition-name` while a switch transition runs. */
export const BOARD_TRANSITION_NAME = 'tsbs-board';

interface ViewTransitionLike {
  readonly finished: Promise<void>;
  readonly ready: Promise<void>;
  readonly updateCallbackDone: Promise<void>;
}
type StartViewTransition = (callback: () => Promise<void>) => ViewTransitionLike;

/** The document's `startViewTransition`, when the engine has one. */
export function startViewTransitionOf(doc: Document = document): StartViewTransition | null {
  const start = (doc as unknown as { startViewTransition?: unknown }).startViewTransition;
  return typeof start === 'function' ? (start.bind(doc) as StartViewTransition) : null;
}

/**
 * Applies `update` with a crossfade of `target`: a View Transition, else (no API) the update and then a 220 ms opacity
 * fade-in of the target, else (reduced motion, or no target) the plain update. Resolves once the DOM shows the new state.
 * A transition skipped by the next one (quick switches) rejects its `ready` and `finished` with an `AbortError`; both are
 * handled here, so a skip is never an unhandled rejection.
 */
export function crossfade(target: HTMLElement | null, update: () => void, reduced: boolean): Promise<void> {
  if (reduced || target === null) {
    update();
    return tick();
  }
  const start = startViewTransitionOf();
  if (start !== null) {
    target.style.setProperty('view-transition-name', BOARD_TRANSITION_NAME);
    try {
      const transition = start(async () => {
        update();
        await tick();
      });
      void transition.ready.catch(() => undefined);
      void transition.finished
        .catch(() => undefined)
        .then(() => {
          target.style.removeProperty('view-transition-name');
        });
      return transition.updateCallbackDone.catch(() => undefined);
    } catch {
      target.style.removeProperty('view-transition-name');
    }
  }
  update();
  return tick().then(() => {
    // will-change only while the fade runs (05 §7); not a choreography animation, so flip.ts stays a lazy chunk.
    target.style.setProperty('will-change', 'opacity');
    const fade = target.animate([{ opacity: 0.3 }, { opacity: 1 }], { duration: SWITCH_MS, easing: 'ease-out' });
    const done = (): void => {
      target.style.removeProperty('will-change');
    };
    fade.addEventListener('finish', done);
    fade.addEventListener('cancel', done);
  });
}

/** What `wrapSwitches` wraps (structural, so tests pass stand-ins). */
export interface SwitchTargets {
  readonly app: {
    setByteView(view: 'hex' | 'dec' | 'both'): void;
    selectTokenizer(id: never): Promise<void>;
  };
  readonly locale: { set(locale: never): void };
}

/** Wraps the three switches in `crossfade`; returns the function that restores the originals. */
export function wrapSwitches(
  targets: SwitchTargets,
  board: () => HTMLElement | null,
  reduced: () => boolean,
): () => void {
  const { app, locale } = targets;
  const setByteView = app.setByteView.bind(app);
  const selectTokenizer = app.selectTokenizer.bind(app);
  const setLocale = locale.set.bind(locale);
  app.setByteView = (view) => {
    void crossfade(
      board(),
      () => {
        setByteView(view);
      },
      reduced(),
    );
  };
  app.selectTokenizer = (id) =>
    new Promise<void>((resolve, reject) => {
      void crossfade(
        board(),
        () => {
          selectTokenizer(id).then(resolve, reject);
        },
        reduced(),
      );
    });
  locale.set = (value) => {
    void crossfade(
      board(),
      () => {
        setLocale(value);
      },
      reduced(),
    );
  };
  return () => {
    app.setByteView = setByteView;
    app.selectTokenizer = selectTokenizer;
    locale.set = setLocale;
  };
}
