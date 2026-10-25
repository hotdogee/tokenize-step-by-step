/**
 * Timeline replay (AD-9, 04 §1.4): the live boundaries after k steps, straight from the born/died arrays (O(bytes), no
 * engine), and `ReplayCursor`, which moves between neighbouring steps in O(boundaries touched) for the scrubber.
 *
 * A boundary list is a sorted `Uint32Array` that starts with 0 and ends with `byteCount`; consecutive entries delimit the
 * live parts. When `leadingZeroWidthPart` is set and the virtual boundary is still live, 0 appears twice, so the first part
 * is the zero-width `[0, 0)` (Grok-1's dummy `▁`, 04 §1.4). Empty text gives `[0]` (no parts). The list covers the whole
 * text; SpecialString chunks keep their permanent inside boundaries here, and `TokenizationView.partsAt` folds each of
 * them into one part (03 §B.2: live parts are restricted to byte-level chunks and the spm text).
 */
import type { MergeTimeline } from '../model/result.ts';
import { StepKind } from '../model/result.ts';
import { isBoundaryLive } from './timeline.ts';

function checkStep(timeline: MergeTimeline, k: number): void {
  if (!Number.isInteger(k) || k < 0 || k > timeline.stepCount) {
    throw new RangeError(`step ${String(k)} is outside 0..${String(timeline.stepCount)}`);
  }
}

/** Live boundaries after `k` steps (0 ≤ k ≤ stepCount). */
export function replay(timeline: MergeTimeline, k: number): Uint32Array {
  checkStep(timeline, k);
  const born = timeline.boundaryBorn;
  const died = timeline.boundaryDied;
  const n = born.length - 1;
  if (n <= 0) return new Uint32Array(1);
  const out: number[] = [0];
  if (timeline.leadingZeroWidthPart && isBoundaryLive(born[0] ?? 0, died[0] ?? 0, k)) out.push(0);
  for (let b = 1; b < n; b++) if (isBoundaryLive(born[b] ?? 0, died[b] ?? 0, k)) out.push(b);
  out.push(n);
  return Uint32Array.from(out);
}

/**
 * Incremental replay: `seek(k)` touches only the boundaries born or killed by the steps between the old and the new
 * position, so ±1 is O(1) amortised; `boundaries()` materialises the current list in O(bytes). Also tracks, per left
 * offset, the latest applied merge that starts there (so the view can name the part a merge formed).
 */
export class ReplayCursor {
  readonly timeline: MergeTimeline;
  private readonly n: number;
  private readonly live: Uint8Array;
  private readonly touchStart: Uint32Array;
  private readonly touched: Uint32Array;
  private readonly top: Int32Array;
  private readonly below: Int32Array;
  private k = 0;

  constructor(timeline: MergeTimeline) {
    this.timeline = timeline;
    const born = timeline.boundaryBorn;
    const died = timeline.boundaryDied;
    const steps = timeline.stepCount;
    this.n = born.length - 1;
    this.live = new Uint8Array(born.length);
    const counts = new Uint32Array(steps + 2);
    const inRange = (v: number): boolean => v >= 1 && v <= steps;
    for (let b = 0; b < born.length; b++) {
      const bb = born[b] ?? 0;
      const dd = died[b] ?? 0;
      this.live[b] = isBoundaryLive(bb, dd, 0) ? 1 : 0;
      if (inRange(bb)) counts[bb + 1] = (counts[bb + 1] ?? 0) + 1;
      if (inRange(dd) && dd !== bb) counts[dd + 1] = (counts[dd + 1] ?? 0) + 1;
    }
    for (let s = 1; s < counts.length; s++) counts[s] = (counts[s] ?? 0) + (counts[s - 1] ?? 0);
    this.touchStart = counts.slice();
    const touched = new Uint32Array(counts[steps + 1] ?? 0);
    const put = (step: number, b: number): void => {
      const at = counts[step] ?? 0;
      touched[at] = b;
      counts[step] = at + 1;
    };
    for (let b = 0; b < born.length; b++) {
      const bb = born[b] ?? 0;
      const dd = died[b] ?? 0;
      if (inRange(bb)) put(bb, b);
      if (inRange(dd) && dd !== bb) put(dd, b);
    }
    this.touched = touched;
    this.top = new Int32Array(born.length);
    this.below = new Int32Array(steps + 1);
  }

  /** Current position (number of steps applied). */
  get step(): number {
    return this.k;
  }

  private retouch(j: number, at: number): void {
    const born = this.timeline.boundaryBorn;
    const died = this.timeline.boundaryDied;
    const end = this.touchStart[j + 1] ?? 0;
    for (let t = this.touchStart[j] ?? 0; t < end; t++) {
      const b = this.touched[t] ?? 0;
      this.live[b] = isBoundaryLive(born[b] ?? 0, died[b] ?? 0, at) ? 1 : 0;
    }
  }

  /** Moves to step `k` (0 ≤ k ≤ stepCount). */
  seek(k: number): void {
    checkStep(this.timeline, k);
    const { stepKind, stepLeft } = this.timeline;
    while (this.k < k) {
      const j = ++this.k;
      this.retouch(j, j);
      if (stepKind[j - 1] === StepKind.Merge) {
        const l = stepLeft[j - 1] ?? 0;
        this.below[j] = this.top[l] ?? 0;
        this.top[l] = j;
      }
    }
    while (this.k > k) {
      const j = this.k--;
      this.retouch(j, j - 1);
      if (stepKind[j - 1] === StepKind.Merge) this.top[stepLeft[j - 1] ?? 0] = this.below[j] ?? 0;
    }
  }

  /** Is interior boundary `b` live at the current step? (0 and byteCount always are.) */
  isLive(b: number): boolean {
    return b === 0 || b === this.n || this.live[b] === 1;
  }

  /** With `leadingZeroWidthPart`: is the zero-width leading part still separate at the current step? */
  get leadingPartLive(): boolean {
    return this.timeline.leadingZeroWidthPart && this.live[0] === 1;
  }

  /** The latest applied merge (1-based step) whose left part starts at `left`, or 0. */
  latestMergeAt(left: number): number {
    return this.top[left] ?? 0;
  }

  /** The boundary list at the current step (same as `replay(timeline, step)`). */
  boundaries(): Uint32Array {
    if (this.n <= 0) return new Uint32Array(1);
    const out: number[] = [0];
    if (this.leadingPartLive) out.push(0);
    for (let b = 1; b < this.n; b++) if (this.live[b] === 1) out.push(b);
    out.push(this.n);
    return Uint32Array.from(out);
  }
}
