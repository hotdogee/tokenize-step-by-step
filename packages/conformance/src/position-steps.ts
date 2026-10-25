/**
 * Merge-step conformance (03 §B.5, 04 §7): a fixture's per-chunk `[position, rank]` steps are replayed on one part per
 * byte into `(left, mid, end)` offsets and compared, in order, with the timeline steps recorded for that chunk; the
 * fixture's `rank` is the merged token id, so it must equal both `stepResultId` and `stepRank` (Grok-2 / Claude pass only
 * with their `idOffset` applied). `directHit` must equal `chunks.directHit`.
 */
import type { FixtureMerge, TokenizationResult } from '@tsbs/core';
import { StepKind } from '@tsbs/core';
import { fixtureStepsToOffsets } from '@tsbs/core/timeline/fixture-steps';

/** Mismatches between a result's timeline and the fixture's `merges` (empty when they agree). */
export function compareMergeSteps(result: TokenizationResult, merges: readonly FixtureMerge[]): string[] {
  const out: string[] = [];
  const { chunks, timeline } = result;
  if (timeline === null) return ['no timeline (encode with trace: true)'];
  if (timeline.truncated) return ['timeline is truncated'];
  const perChunk = new Map<number, number[]>();
  for (let i = 0; i < timeline.stepCount; i++) {
    if (timeline.stepKind[i] !== StepKind.Merge) continue;
    const c = timeline.stepChunk[i] ?? 0;
    const list = perChunk.get(c) ?? [];
    list.push(i);
    perChunk.set(c, list);
  }
  const covered = new Set<number>();
  for (const m of merges) {
    covered.add(m.chunk);
    if (m.chunk >= chunks.count) {
      out.push(`merges chunk ${String(m.chunk)} does not exist`);
      continue;
    }
    if ((chunks.directHit[m.chunk] === 1) !== m.directHit)
      out.push(`chunk ${String(m.chunk)}: directHit is not ${String(m.directHit)}`);
    const start = chunks.byteStart[m.chunk] ?? 0;
    const end = chunks.byteStart[m.chunk + 1] ?? 0;
    let expected: ReturnType<typeof fixtureStepsToOffsets>;
    try {
      expected = fixtureStepsToOffsets(start, end, m.steps);
    } catch (error) {
      out.push(`chunk ${String(m.chunk)}: ${error instanceof Error ? error.message : String(error)}`);
      continue;
    }
    const actual = perChunk.get(m.chunk) ?? [];
    if (actual.length !== expected.length) {
      out.push(`chunk ${String(m.chunk)}: ${String(actual.length)} steps, fixture has ${String(expected.length)}`);
      continue;
    }
    expected.forEach((step, k) => {
      const i = actual[k] ?? 0;
      const got = [
        timeline.stepLeft[i],
        timeline.stepMid[i],
        timeline.stepEnd[i],
        timeline.stepResultId[i],
        timeline.stepRank[i],
      ];
      const want = [step.left, step.mid, step.end, step.rank, step.rank];
      if (got.some((v, j) => v !== want[j])) {
        out.push(
          `chunk ${String(m.chunk)} step ${String(k)}: got (l,m,r,id,rank) ${got.join(',')}, fixture ${want.join(',')}`,
        );
      }
    });
  }
  for (const c of perChunk.keys())
    if (!covered.has(c)) out.push(`chunk ${String(c)} has steps the fixture does not list`);
  return out;
}
