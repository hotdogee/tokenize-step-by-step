/**
 * Timeline recording and replay (AD-9, 04 §1.4): NEVER/ALIVE sentinels, `trace.maxSteps` truncation (replay at stepCount
 * equals the final tokens), the cursor ≡ `replay`, offset mapping with the zero-width leading part and byte-fallback
 * splits, the Fenwick conversions.
 */
import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import {
  ALIVE,
  analyzeText,
  buildResult,
  bytePartList,
  checkInvariants,
  ChunkKind,
  isBoundaryLive,
  maxStepsOf,
  mergeAll,
  NEVER,
  NO_MERGE,
  partListFromStarts,
  partSpans,
  recorderFor,
  replay,
  ReplayCursor,
  stepAt,
  StepKind,
  TimelineRecorder,
  TokenFlag,
  TokenizationView,
  TokenKind,
  type MergeTimeline,
  type PairPriority,
} from '../src/index.ts';
import { Fenwick } from '../src/timeline/fenwick.ts';
import { fixtureStepsToOffsets, offsetsToFixtureSteps } from '../src/timeline/fixture-steps.ts';
import { keyOf, syntheticRanks } from './helpers/reference-bpe.ts';
import { RUNS } from './helpers/runs.ts';

function rankPriority(buffer: Uint8Array, ranks: Map<string, number>): PairPriority {
  return {
    priority: (l, _m, r) => ranks.get(keyOf(buffer.subarray(l, r))) ?? NO_MERGE,
    mergedId: (l, _m, r) => ranks.get(keyOf(buffer.subarray(l, r))) ?? -1,
  };
}

/** A tiny one-chunk byte-level "engine" over synthetic ranks (latin text, so bytes = chars). */
function synthEncode(text: string, ranks: Map<string, number>, maxSteps: number) {
  const analysis = analyzeText(text);
  const n = analysis.utf8.length;
  const recorder = new TimelineRecorder(n, { maxSteps, rank: 'resultId' });
  const parts = bytePartList(0, n);
  if (n > 0) mergeAll(parts, rankPriority(analysis.utf8, ranks), 0, recorder);
  const spans = n > 0 ? partSpans(parts) : [];
  const timeline = recorder.finish();
  const result = buildResult({
    tokenizer: 'openai-o200k_base',
    family: 'bytelevel-bpe',
    analysis,
    chunks: { byteStart: n > 0 ? [0, n] : [0], kind: n > 0 ? [ChunkKind.Regex] : [] },
    tokens: {
      id: spans.map(([s, e]) => ranks.get(keyOf(analysis.utf8.subarray(s, e))) ?? analysis.utf8[s] ?? 0),
      byteStart: [...spans.map(([s]) => s), n],
      kind: spans.map(() => TokenKind.Normal),
    },
    timeline,
  });
  return { result, timeline, final: [...spans.map(([s]) => s), n] };
}

const latinCase = fc.record({
  text: fc.array(fc.constantFrom('a', 'b', 'c'), { maxLength: 60, size: 'max' }).map((a) => a.join('')),
  density: fc.double({ min: 0.1, max: 1, noNaN: true }),
  seed: fc.nat(),
  maxSteps: fc.nat(40),
});

describe('sentinels and liveness', () => {
  it('implements the 03 §B.2 live test', () => {
    expect(isBoundaryLive(0, ALIVE, 0)).toBe(true);
    expect(isBoundaryLive(NEVER, ALIVE, 5)).toBe(false);
    expect(isBoundaryLive(0, 3, 2)).toBe(true);
    expect(isBoundaryLive(0, 3, 3)).toBe(false);
    expect(isBoundaryLive(2, ALIVE, 1)).toBe(false);
    expect(isBoundaryLive(2, ALIVE, 2)).toBe(true);
  });

  it('reads trace options', () => {
    expect(maxStepsOf(false)).toBeNull();
    expect(maxStepsOf(true)).toBe(Number.POSITIVE_INFINITY);
    expect(maxStepsOf({ maxSteps: 7 })).toBe(7);
    expect(recorderFor(4, false)).toBeNull();
    expect(() => new TimelineRecorder(4, { maxSteps: -1 })).toThrow(RangeError);
  });
});

describe('truncation (trace: { maxSteps })', () => {
  it('replay(stepCount) equals the final tokens and earlier steps equal the full timeline', () => {
    fc.assert(
      fc.property(latinCase, ({ text, density, seed, maxSteps }) => {
        const ranks = syntheticRanks(new TextEncoder().encode(text), density, seed, 5);
        const full = synthEncode(text, ranks, Number.POSITIVE_INFINITY);
        const cut = synthEncode(text, ranks, maxSteps);
        const total = full.timeline.stepCount;
        expect(cut.timeline.stepCount).toBe(Math.min(total, maxSteps));
        expect(cut.timeline.truncated).toBe(total > maxSteps);
        expect(Array.from(replay(cut.timeline, cut.timeline.stepCount))).toEqual(cut.final);
        for (let k = 0; k < cut.timeline.stepCount; k++) {
          expect(Array.from(replay(cut.timeline, k))).toEqual(Array.from(replay(full.timeline, k)));
        }
        expect(checkInvariants(cut.result)).toEqual([]);
        expect(checkInvariants(full.result)).toEqual([]);
        for (let t = 0; t < cut.result.tokens.count; t++) {
          const formed = cut.result.tokens.stepFormed[t] ?? -1;
          expect(formed).toBeLessThanOrEqual(cut.timeline.stepCount);
          if ((full.result.tokens.stepFormed[t] ?? -1) <= cut.timeline.stepCount) {
            expect(formed).toBe(full.result.tokens.stepFormed[t]);
          } else expect(formed).toBe(-1);
        }
      }),
      { numRuns: RUNS },
    );
  });

  it('records stepRank as the merged id with rank: resultId', () => {
    const { timeline } = synthEncode('abab', new Map([['ab', 3]]), Number.POSITIVE_INFINITY);
    expect(Array.from(timeline.stepRank)).toEqual([3, 3]);
    expect(Array.from(timeline.stepResultId)).toEqual([3, 3]);
    expect(stepAt(timeline, 2)).toMatchObject({ step: 2, left: 2, mid: 3, end: 4, rank: 3 });
    expect(() => stepAt(timeline, 0)).toThrow(RangeError);
  });

  it('maxSteps: 0 keeps no steps and still replays to the final tokens', () => {
    const { timeline, final } = synthEncode('abab', new Map([['ab', 3]]), 0);
    expect(timeline.stepCount).toBe(0);
    expect(timeline.truncated).toBe(true);
    expect(Array.from(replay(timeline, 0))).toEqual(final);
  });
});

describe('ReplayCursor ≡ replay', () => {
  it('matches replay after arbitrary seeks', () => {
    fc.assert(
      fc.property(latinCase, fc.array(fc.nat(), { maxLength: 20 }), ({ text, density, seed, maxSteps }, seeks) => {
        const ranks = syntheticRanks(new TextEncoder().encode(text), density, seed, 5);
        const { timeline } = synthEncode(text, ranks, maxSteps % 3 === 0 ? maxSteps : Number.POSITIVE_INFINITY);
        const cursor = new ReplayCursor(timeline);
        for (const raw of seeks) {
          const k = raw % (timeline.stepCount + 1);
          cursor.seek(k);
          expect(cursor.step).toBe(k);
          expect(Array.from(cursor.boundaries())).toEqual(Array.from(replay(timeline, k)));
        }
      }),
      { numRuns: RUNS },
    );
  });

  it('rejects steps outside 0..stepCount', () => {
    const { timeline } = synthEncode('ab', new Map([['ab', 0]]), Number.POSITIVE_INFINITY);
    expect(() => replay(timeline, 2)).toThrow(RangeError);
    expect(() => {
      new ReplayCursor(timeline).seek(-1);
    }).toThrow(RangeError);
    expect(Array.from(replay(new TimelineRecorder(0).finish(), 0))).toEqual([0]);
  });
});

describe('spm-shaped timelines: offset map, zero-width leading part, byte-fallback split', () => {
  // "a灣" with a dummy prefix: norm = ▁(E2 96 81) a 灣(E7 81 A3); normToOrig maps the dummy's 3 bytes to 0.
  const text = 'a灣';
  const analysis = analyzeText(text);
  const normToOrig = [0, 0, 0, 0, 1, 2, 3, 4];
  const recorder = new TimelineRecorder(analysis.utf8.length, { offsetMap: normToOrig, leadingZeroWidthPart: true });
  recorder.neverBorn(1, 4); // intra-code-point boundaries of 灣 (SentencePiece order: born by the split)
  const parts = partListFromStarts([0, 3, 4], 7);
  // ▁ + a merges (priority −1, id 500); 灣 is not a piece and never merges.
  mergeAll(parts, { priority: (l, m) => (l === 0 && m === 3 ? -1 : NO_MERGE), mergedId: () => 500 }, 0, recorder);
  recorder.record(StepKind.ByteFallbackSplit, 4, 4, 7, 0, 69 + 0xe7, 0);
  const timeline: MergeTimeline = recorder.finish();
  const result = buildResult({
    tokenizer: 'xai-grok1',
    family: 'spm-bpe',
    analysis,
    chunks: { byteStart: [0, 4], kind: [ChunkKind.SpmText] },
    tokens: {
      id: [500, 69 + 0xe7, 69 + 0x81, 69 + 0xa3],
      byteStart: [0, 1, 2, 3, 4],
      kind: [TokenKind.Normal, TokenKind.Byte, TokenKind.Byte, TokenKind.Byte],
    },
    timeline,
  });

  it('maps the dummy merge to the virtual boundary 0 and the split to intra-code-point births', () => {
    expect(timeline.stepCount).toBe(2);
    expect([timeline.stepLeft[0], timeline.stepMid[0], timeline.stepEnd[0]]).toEqual([0, 0, 1]);
    expect([timeline.stepKind[1], timeline.stepLeft[1], timeline.stepMid[1], timeline.stepEnd[1]]).toEqual([
      1, 1, 1, 4,
    ]);
    expect(timeline.boundaryDied[0]).toBe(1);
    expect(Array.from(timeline.boundaryBorn.subarray(2, 4))).toEqual([2, 2]);
    expect(Array.from(replay(timeline, 0))).toEqual([0, 0, 1, 4]);
    expect(Array.from(replay(timeline, 1))).toEqual([0, 1, 4]);
    expect(Array.from(replay(timeline, 2))).toEqual([0, 1, 2, 3, 4]);
  });

  it('builds a sound result: Byte flags, split stepFormed, view parts', () => {
    expect(checkInvariants(result)).toEqual([]);
    expect(Array.from(result.tokens.stepFormed)).toEqual([1, 2, 2, 2]);
    expect(result.tokens.flags[1]).toBe(TokenFlag.ByteFallback | TokenFlag.Partial | TokenFlag.EndsMidChar);
    const view = new TokenizationView(result);
    const p0 = view.partsAt(0);
    expect(Array.from(p0.partStart)).toEqual([0, 0, 1, 4]);
    expect(Array.from(p0.partChunk)).toEqual([-1, 0, 0]);
    expect(p0.justMerged).toBe(-1);
    const p1 = view.partsAt(1);
    expect(Array.from(p1.partStart)).toEqual([0, 1, 4]);
    expect(Array.from(p1.partId)).toEqual([500, -1]);
    expect(p1.justMerged).toBe(0);
    const p2 = view.partsAt(2);
    expect(Array.from(p2.partId)).toEqual([500, 69 + 0xe7, 69 + 0x81, 69 + 0xa3]);
    expect(p2.justMerged).toBe(1);
    expect(view.stepSentence(2)).toMatchObject({
      kind: 'split',
      leftHex: ['E7', '81', 'A3'],
      rightHex: [],
      partOf: 'whole',
    });
    expect(view.stepSentence(1)).toMatchObject({ kind: 'merge', leftHex: [], rightHex: ['61'], charsText: 'a' });
  });
});

describe('Fenwick tree and fixture-step conversion', () => {
  it('matches a naive prefix-sum array', () => {
    fc.assert(
      fc.property(fc.integer({ min: 1, max: 64 }), fc.array(fc.nat(), { maxLength: 64 }), (size, removals) => {
        const tree = new Fenwick(size, 1);
        const naive = new Array<number>(size).fill(1);
        for (const r of removals) {
          const i = r % size;
          if (naive[i] === 1) {
            naive[i] = 0;
            tree.add(i, -1);
          }
          let sum = 0;
          for (let k = 0; k < size; k++) {
            sum += naive[k] ?? 0;
            expect(tree.prefix(k)).toBe(sum);
          }
          for (let k = 1; k <= sum + 1; k++) {
            let acc = 0;
            let expected = -1;
            for (let j = 0; j < size; j++) {
              acc += naive[j] ?? 0;
              if (acc >= k) {
                expected = j;
                break;
              }
            }
            expect(tree.findKth(k)).toBe(expected);
          }
        }
      }),
      { numRuns: Math.max(50, RUNS / 10) },
    );
  });

  it('converts positions to offsets and back on a chunk that does not start at 0', () => {
    const steps = [
      [0, 5877],
      [5, 5877],
      [7, 11239],
      [0, 55038],
      [4, 55038],
      [5, 59563],
      [1, 66285],
    ] as const;
    const offsets = fixtureStepsToOffsets(10, 22, steps);
    expect(offsets[0]).toEqual({ left: 10, mid: 11, end: 12, rank: 5877 });
    expect(offsets[6]).toEqual({ left: 13, mid: 14, end: 15, rank: 66285 });
    expect(offsetsToFixtureSteps(10, 22, offsets)).toEqual(steps);
    expect(() => fixtureStepsToOffsets(0, 2, [[1, 0]])).toThrow(RangeError);
  });
});
