/**
 * The shared agenda loop (04 §1): equivalence with a literal port of tiktoken's quadratic `_byte_pair_merge` on synthetic
 * ranks (fast-check; no vocabulary needed), `mergeStep` time slices ≡ `mergeAll`, frozen parts, lazy invalidation and
 * the heap order.
 */
import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import {
  AgendaHeap,
  bytePartList,
  createMergeState,
  mergeAll,
  mergeStep,
  NO_MERGE,
  partListFromStarts,
  partSpans,
  type PairPriority,
  type TraceRecorder,
} from '../src/index.ts';
import { bytePairMergeReference, keyOf, syntheticRanks } from './helpers/reference-bpe.ts';
import { RUNS } from './helpers/runs.ts';

interface Step {
  readonly kind: number;
  readonly left: number;
  readonly mid: number;
  readonly end: number;
  readonly rank: number;
  readonly resultId: number;
  readonly chunk: number;
}

function collector(): TraceRecorder & { readonly steps: Step[] } {
  const steps: Step[] = [];
  return {
    steps,
    record(kind, left, mid, end, rank, resultId, chunk) {
      steps.push({ kind, left, mid, end, rank, resultId, chunk });
    },
  };
}

/** RankPriority over a synthetic table: priority = rank of the merged bytes, mergedId = rank + 1000. */
function rankPriority(piece: Uint8Array, ranks: Map<string, number>): PairPriority {
  return {
    priority: (l, _m, r) => ranks.get(keyOf(piece.subarray(l, r))) ?? NO_MERGE,
    mergedId: (l, _m, r) => (ranks.get(keyOf(piece.subarray(l, r))) ?? -1) + 1000,
  };
}

const syntheticCase = (maxLength: number, minLength = 0) =>
  fc.record({
    alphabet: fc.integer({ min: 2, max: 4 }),
    symbols: fc.array(fc.nat(3), { minLength, maxLength, size: 'max' }),
    density: fc.double({ min: 0.05, max: 1, noNaN: true }),
    seed: fc.nat(),
    offset: fc.nat(40),
  });

function pieceOf(alphabet: number, symbols: readonly number[]): Uint8Array {
  return Uint8Array.from(symbols, (s) => 0x61 + (s % alphabet));
}

describe('agenda ≡ tiktoken _byte_pair_merge (fast-check, synthetic ranks)', () => {
  it('produces the same merge sequence and the same final parts', () => {
    fc.assert(
      fc.property(syntheticCase(48), ({ alphabet, symbols, density, seed, offset }) => {
        const piece = pieceOf(alphabet, symbols);
        const ranks = syntheticRanks(piece, density, seed);
        const reference = bytePairMergeReference(piece, (bytes) => ranks.get(keyOf(bytes)));
        // Run the agenda on a buffer where the chunk starts at `offset` (offsets are working-buffer offsets).
        const buffer = new Uint8Array(offset + piece.length);
        buffer.set(piece, offset);
        const prio = rankPriority(buffer, ranks);
        const trace = collector();
        const parts = bytePartList(offset, offset + piece.length);
        if (piece.length === 0) return;
        mergeAll(parts, prio, 7, trace);
        expect(trace.steps.map((s) => [s.left - offset, s.mid - offset, s.end - offset, s.rank])).toEqual(
          reference.merges.map((m) => [m.left, m.mid, m.end, m.rank]),
        );
        for (const s of trace.steps) {
          expect(s.kind).toBe(0);
          expect(s.chunk).toBe(7);
          expect(s.resultId).toBe(s.rank + 1000);
        }
        const finalStarts = partSpans(parts).map(([s]) => s - offset);
        expect([...finalStarts, piece.length]).toEqual(reference.boundaries);
        expect(parts.count).toBe(finalStarts.length);
      }),
      { numRuns: RUNS },
    );
  });

  it('breaks rank ties leftmost (the same byte string twice)', () => {
    const piece = Uint8Array.from([0x61, 0x62, 0x61, 0x62]);
    const ranks = new Map([['ab', 0]]);
    const trace = collector();
    mergeAll(bytePartList(0, 4), rankPriority(piece, ranks), 0, trace);
    expect(trace.steps.map((s) => s.left)).toEqual([0, 2]);
  });
});

describe('mergeStep time slices ≡ mergeAll', () => {
  it('gives identical traces and parts when resumed every 256 pops', () => {
    let sliced = 0;
    fc.assert(
      fc.property(syntheticCase(1500, 300), ({ alphabet, symbols, density, seed }) => {
        const piece = pieceOf(alphabet, symbols);
        if (piece.length === 0) return;
        const ranks = syntheticRanks(piece, density, seed, 6);
        const whole = collector();
        const wholeParts = bytePartList(0, piece.length);
        mergeAll(wholeParts, rankPriority(piece, ranks), 0, whole);
        const slices = collector();
        const slicedParts = bytePartList(0, piece.length);
        const state = createMergeState(slicedParts, rankPriority(piece, ranks), 0, slices);
        let calls = 0;
        while (!mergeStep(state, 0)) calls++;
        if (calls > 0) sliced++;
        expect(state.done).toBe(true);
        expect(slices.steps).toEqual(whole.steps);
        expect(partSpans(slicedParts)).toEqual(partSpans(wholeParts));
      }),
      { numRuns: Math.max(50, Math.floor(RUNS / 5)) },
    );
    expect(sliced).toBeGreaterThan(0);
  });

  it('returns done immediately for an empty heap and keeps returning true', () => {
    const state = createMergeState(bytePartList(0, 3), { priority: () => NO_MERGE, mergedId: () => -1 }, 0, null);
    expect(state.done).toBe(true);
    expect(mergeStep(state, 4)).toBe(true);
    expect(mergeStep(state, 4)).toBe(true);
  });

  it('rejects a state it did not create', () => {
    const parts = bytePartList(0, 2);
    const fake = { parts, prio: { priority: () => 0, mergedId: () => 0 }, chunk: 0, pops: 0, done: false };
    expect(() => mergeStep(fake, 1)).toThrow(TypeError);
  });
});

describe('part lists and frozen parts', () => {
  it('never merges a frozen part and still merges around it', () => {
    // parts: a b [X] c d — X frozen; every adjacent pair is mergeable at priority = left offset.
    const parts = partListFromStarts([0, 1, 2, 3, 4], 5, [0, 0, 1, 0, 0]);
    const trace = collector();
    mergeAll(parts, { priority: (l) => l, mergedId: () => 1 }, 0, trace);
    expect(partSpans(parts)).toEqual([
      [0, 2],
      [2, 3],
      [3, 5],
    ]);
    expect(trace.steps.map((s) => [s.left, s.mid, s.end])).toEqual([
      [0, 1, 2],
      [3, 4, 5],
    ]);
  });

  it('handles negative priorities (spm −score) and multi-byte symbols', () => {
    // three 3-byte symbols; merging the last two scores higher (lower −score) than the first two.
    const parts = partListFromStarts([0, 3, 6], 9);
    const trace = collector();
    const prio: PairPriority = {
      priority: (l, m, r) => (r - l === 6 ? (l === 3 ? -10 : -5) : r - l === 9 ? -1 : NO_MERGE),
      mergedId: (l, m, r) => l * 100 + m * 10 + r,
    };
    mergeAll(parts, prio, 0, trace);
    expect(trace.steps.map((s) => [s.left, s.mid, s.end, s.rank])).toEqual([
      [3, 6, 9, -10],
      [0, 3, 9, -1],
    ]);
    expect(partSpans(parts)).toEqual([[0, 9]]);
  });

  it('discards stale candidates whose neighbours changed (lazy invalidation)', () => {
    // "abc": ab (rank 1) and bc (rank 0). bc merges first; the queued ab is stale and must not merge.
    const piece = Uint8Array.from([0x61, 0x62, 0x63]);
    const ranks = new Map([
      ['bc', 0],
      ['ab', 1],
    ]);
    const trace = collector();
    const parts = bytePartList(0, 3);
    mergeAll(parts, rankPriority(piece, ranks), 0, trace);
    expect(trace.steps.map((s) => [s.left, s.mid, s.end])).toEqual([[1, 2, 3]]);
    expect(partSpans(parts)).toEqual([
      [0, 1],
      [1, 3],
    ]);
  });

  it('validates the list', () => {
    expect(() => partListFromStarts([0, 0], 1)).toThrow(RangeError);
    const parts = partListFromStarts([0, 1], 2);
    parts.count = 5;
    expect(() => createMergeState(parts, { priority: () => 0, mergedId: () => 0 }, 0, null)).toThrow(RangeError);
  });
});

describe('AgendaHeap', () => {
  it('pops in (priority, left) order', () => {
    fc.assert(
      fc.property(fc.array(fc.tuple(fc.integer({ min: -5, max: 5 }), fc.nat(20)), { maxLength: 200 }), (entries) => {
        const heap = new AgendaHeap(1);
        entries.forEach(([p, l], i) => {
          heap.push(p, l, i, i + 1);
        });
        const popped: Array<[number, number]> = [];
        while (heap.pop()) popped.push([heap.topPriority, heap.topLeft]);
        const sorted = entries.map(([p, l]) => [p, l] as [number, number]).sort((a, b) => a[0] - b[0] || a[1] - b[1]);
        expect(popped).toEqual(sorted);
        expect(heap.size).toBe(0);
      }),
      { numRuns: RUNS },
    );
  });
});
