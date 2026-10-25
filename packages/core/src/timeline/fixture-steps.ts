/**
 * Conversion between the fixtures' merge steps and timeline offsets (03 §B.5, 04 §1.4).
 *
 * A fixture step `[position, rank]` means "merge part `position` with part `position + 1` of the chunk's current part
 * list", starting from one part per byte (tools/oracle/README.md § Fixture schema). The timeline stores byte offsets
 * `(left, mid, end)` instead. Both directions use a Fenwick tree over the chunk's interior boundaries, so a chunk of m bytes
 * converts in O(m log m):
 *
 * - `fixtureStepsToOffsets` (position → offsets) is what `fromFixtureCase` and the conformance runner use;
 * - `offsetsToFixtureSteps` / `timelineToFixtureMerges` (offsets → position = live boundaries in `(chunkStart, left]`) exist
 *   for the tests only (the shipped result never stores positions, AD-9).
 */
import type { FixtureMerge, FixtureMergeStep } from '../fixture/fixture-types.ts';
import type { TokenizationResult } from '../model/result.ts';
import { StepKind } from '../model/result.ts';
import { Fenwick } from './fenwick.ts';

/** One merge in offset form. */
export interface OffsetStep {
  readonly left: number;
  readonly mid: number;
  readonly end: number;
  readonly rank: number;
}

/** Replays fixture steps on one part per byte of the chunk `[start, end)`; throws a RangeError on an impossible position. */
export function fixtureStepsToOffsets(start: number, end: number, steps: readonly FixtureMergeStep[]): OffsetStep[] {
  const interior = Math.max(0, end - start - 1);
  const live = new Fenwick(interior, 1);
  let alive = interior;
  const out: OffsetStep[] = [];
  for (const [position, rank] of steps) {
    if (!Number.isInteger(position) || position < 0 || position >= alive) {
      throw new RangeError(
        `merge position ${String(position)} with ${String(alive + 1)} parts in [${String(start)}, ${String(end)})`,
      );
    }
    const left = position === 0 ? start : start + 1 + live.findKth(position);
    const midSlot = live.findKth(position + 1);
    const right = position + 2 <= alive ? start + 1 + live.findKth(position + 2) : end;
    live.add(midSlot, -1);
    alive--;
    out.push({ left, mid: start + 1 + midSlot, end: right, rank });
  }
  return out;
}

/** Tests only: the fixture positions of offset-form merges of the chunk `[start, end)`. */
export function offsetsToFixtureSteps(
  start: number,
  end: number,
  steps: ReadonlyArray<Pick<OffsetStep, 'left' | 'mid' | 'rank'>>,
): FixtureMergeStep[] {
  const live = new Fenwick(Math.max(0, end - start - 1), 1);
  return steps.map(({ left, mid, rank }) => {
    const position = left === start ? 0 : live.prefix(left - start - 1);
    live.add(mid - start - 1, -1);
    return [position, rank] as const;
  });
}

/** Tests only: a result's timeline in fixture form, one record per chunk (needs a full, untruncated timeline). */
export function timelineToFixtureMerges(result: TokenizationResult): FixtureMerge[] {
  const { chunks, timeline } = result;
  if (timeline === null) throw new Error('timelineToFixtureMerges needs a timeline');
  const perChunk: Array<Array<Pick<OffsetStep, 'left' | 'mid' | 'rank'>>> = Array.from(
    { length: chunks.count },
    () => [],
  );
  for (let i = 0; i < timeline.stepCount; i++) {
    if (timeline.stepKind[i] !== StepKind.Merge) continue;
    perChunk[timeline.stepChunk[i] ?? 0]?.push({
      left: timeline.stepLeft[i] ?? 0,
      mid: timeline.stepMid[i] ?? 0,
      rank: timeline.stepRank[i] ?? 0,
    });
  }
  return perChunk.map((steps, c) => {
    const start = chunks.byteStart[c] ?? 0;
    const end = chunks.byteStart[c + 1] ?? 0;
    return { chunk: c, directHit: chunks.directHit[c] === 1, steps: offsetsToFixtureSteps(start, end, steps) };
  });
}
