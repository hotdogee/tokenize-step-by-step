/**
 * The playback controller (05 §2): Play replays the merge steps of the current replay scope (scope.ts) at
 * clamp(60 ms, 12 s / steps, 450 ms) ÷ speed per step — from the scope's start when the position is at its end or off
 * stop 5 — and stops at the scope's end; a step taken by hand while playing continues from there. It drives the timeline
 * position through AppState (`stage`, `step`, `playing`, `speed`). Follow mode (the merged part scrolled into view, motion
 * director) turns off when the user scrolls by hand and back on only with "jump to end" (the scrubber's end), as 05 §2
 * says: Play does not turn it back on, so a reader who scrolled away keeps their place.
 */
import type { AppState } from '../app/app-state.svelte.ts';
import { positionOf, stepAt, stepDuration, type ReplayScope } from './scope.ts';

/** The timer functions the controller uses (tests pass a manual clock). */
export interface Clock {
  setTimeout(callback: () => void, ms: number): unknown;
  clearTimeout(handle: unknown): void;
}

const browserClock: Clock = {
  setTimeout: (callback, ms) => globalThis.setTimeout(callback, ms),
  clearTimeout: (handle) => {
    globalThis.clearTimeout(handle as ReturnType<typeof setTimeout>);
  },
};

export class Playback {
  /** Follow mode (05 §2). */
  follow = $state(true);
  readonly #app: AppState;
  readonly #scope: () => ReplayScope | null;
  readonly #clock: Clock;
  #timer: unknown = null;

  constructor(app: AppState, scope: () => ReplayScope | null, clock: Clock = browserClock) {
    this.#app = app;
    this.#scope = scope;
    this.#clock = clock;
  }

  /** The scrubber position of the timeline position (stops 1–4 → 0, stop 6 → the scope's end). */
  position(scope: ReplayScope): number {
    const { stage, step } = this.#app;
    if (stage < 5) return 0;
    return stage === 6 ? scope.count : positionOf(scope, step);
  }

  /** Shows scrubber position `p` (stop 5 at the scope's step p). `manual`: the user moved there ("jump to end"). */
  seek(scope: ReplayScope, p: number, manual = false): void {
    const app = this.#app;
    if (app.stage !== 5) app.setStage(5);
    app.step = stepAt(scope, p);
    if (manual && p >= scope.count) this.follow = true;
  }

  play(): void {
    const scope = this.#scope();
    if (scope === null || scope.count === 0) return;
    // Off stop 5, at the scope's end, or outside the scope (another chunk was focused): start from the scope's start.
    const p = this.position(scope);
    if (this.#app.stage !== 5 || p >= scope.count || stepAt(scope, p) !== this.#app.step) this.seek(scope, 0);
    this.#app.playing = true;
    this.#schedule(scope);
  }

  pause(): void {
    this.#clock.clearTimeout(this.#timer);
    this.#timer = null;
    this.#app.playing = false;
  }

  toggle(): void {
    if (this.#app.playing) this.pause();
    else this.play();
  }

  #schedule(scope: ReplayScope): void {
    this.#clock.clearTimeout(this.#timer);
    this.#timer = this.#clock.setTimeout(
      () => {
        this.#tick();
      },
      stepDuration(scope.count, this.#app.speed),
    );
  }

  #tick(): void {
    this.#timer = null;
    const scope = this.#scope();
    if (!this.#app.playing || scope === null) return;
    const next = this.position(scope) + 1;
    if (next > scope.count) {
      this.pause();
      return;
    }
    this.seek(scope, next);
    if (next >= scope.count) this.pause();
    else this.#schedule(scope);
  }
}
