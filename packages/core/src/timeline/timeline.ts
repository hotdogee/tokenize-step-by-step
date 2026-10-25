/**
 * Merge-timeline semantics (AD-9, 03 §B.2 `MergeTimeline`): boundary liveness with the `NEVER` / `ALIVE` sentinels.
 *
 * Steps are numbered from 1: step k (1 ≤ k ≤ stepCount) is stored at array index k − 1, `partsAt(k)` / `replay(timeline, k)`
 * show the state after the first k steps (k = 0: nothing merged yet), a merge recorded as step k sets `died[mid] = k`, a
 * split recorded as step k sets `born[b] = k`, and `TokenTable.stepFormed` holds that same k.
 */
import { ALIVE, NEVER, type MergeTimeline } from '../model/result.ts';

/** The 03 §B.2 live test: `born !== NEVER && born <= k && (died === ALIVE || died > k)`. */
export function isBoundaryLive(born: number, died: number, k: number): boolean {
  return born !== NEVER && born <= k && (died === ALIVE || died > k);
}

/** Is boundary `b` live after `k` steps? (`b = 0` with `leadingZeroWidthPart` is the virtual boundary, 04 §1.4.) */
export function isLiveAt(timeline: MergeTimeline, b: number, k: number): boolean {
  return isBoundaryLive(timeline.boundaryBorn[b] ?? NEVER, timeline.boundaryDied[b] ?? ALIVE, k);
}

/** One recorded step, by its 1-based number. */
export interface TimelineStep {
  readonly step: number;
  readonly kind: number;
  readonly left: number;
  readonly mid: number;
  readonly end: number;
  readonly rank: number;
  readonly resultId: number;
  readonly chunk: number;
}

/** Reads step `k` (1 ≤ k ≤ stepCount); throws a RangeError outside that range. */
export function stepAt(timeline: MergeTimeline, k: number): TimelineStep {
  if (!Number.isInteger(k) || k < 1 || k > timeline.stepCount) {
    throw new RangeError(`step ${String(k)} is outside 1..${String(timeline.stepCount)}`);
  }
  const i = k - 1;
  return {
    step: k,
    kind: timeline.stepKind[i] ?? 0,
    left: timeline.stepLeft[i] ?? 0,
    mid: timeline.stepMid[i] ?? 0,
    end: timeline.stepEnd[i] ?? 0,
    rank: timeline.stepRank[i] ?? 0,
    resultId: timeline.stepResultId[i] ?? -1,
    chunk: timeline.stepChunk[i] ?? 0,
  };
}
