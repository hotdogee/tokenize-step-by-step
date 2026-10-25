/**
 * The shared agenda merge loop (AD-5, AD-33; 04 §1.1–1.3) that both engines run: a doubly linked part list plus a binary
 * min-heap keyed `(priority, leftOffset)` with lazy invalidation. It is resumable (AD-21): `createMergeState` seeds the
 * heap, `mergeStep(state, budgetMs)` pops until the heap is empty or the time slice is over (the clock is sampled every
 * 256 pops), and `mergeAll` is `createMergeState` + `mergeStep(state, Infinity)`. Slicing never changes the result: the
 * state between slices is exactly the heap and the list.
 *
 * Equivalence with tiktoken's quadratic "lowest rank, leftmost" scan is argued in docs/adr/0003-agenda-equivalence.md and
 * checked by a fast-check property against a literal port of `_byte_pair_merge` (test/agenda.test.ts).
 *
 * The working-buffer parts must be non-empty (an spm dummy prefix is 3 real bytes there; it becomes zero-width only after
 * the recorder maps offsets through `normToOrig`). A priority that is not below `NO_MERGE` (incl. NaN) is never queued.
 */
import { StepKind } from '../model/result.ts';
import { AgendaHeap } from './heap.ts';
import {
  NO_MERGE,
  type CreateMergeState,
  type MergeAll,
  type MergeState,
  type MergeStep,
  type PairPriority,
  type PartList,
  type TraceRecorder,
} from './types.ts';

/** `performance` is not in lib ES2023; read it structurally (`Date` keeps this from being a weak type). */
const clock: { readonly Date: DateConstructor; readonly performance?: { now(): number } } = globalThis;

/** Milliseconds from a monotonic clock where the runtime has one (`performance.now()`), else `Date.now()`. */
function now(): number {
  return clock.performance ? clock.performance.now() : clock.Date.now();
}

/** The concrete state behind `MergeState`: the frozen fields plus the heap and the offset → slot index. */
class Agenda implements MergeState {
  readonly parts: PartList;
  readonly prio: PairPriority;
  readonly chunk: number;
  pops = 0;
  done = false;
  readonly heap: AgendaHeap;
  readonly trace: TraceRecorder | null;
  /** Offset of the first part; `slotAt[o − base]` is the live slot that starts at offset o, or −1. */
  readonly base: number;
  readonly slotAt: Int32Array;

  constructor(parts: PartList, prio: PairPriority, chunk: number, trace: TraceRecorder | null) {
    this.parts = parts;
    this.prio = prio;
    this.chunk = chunk;
    this.trace = trace;
    const { start, end, next } = parts;
    let first = -1;
    let last = -1;
    let count = 0;
    for (let a = parts.head; a !== -1; a = next[a] ?? -1) {
      const s = start[a] ?? 0;
      const e = end[a] ?? 0;
      if (!(e > s)) throw new RangeError(`agenda part [${String(s)}, ${String(e)}) is empty`);
      if (last !== -1 && s !== last) throw new RangeError(`agenda parts are not contiguous at offset ${String(s)}`);
      if (first === -1) first = s;
      last = e;
      count++;
    }
    if (count !== parts.count)
      throw new RangeError(`PartList.count is ${String(parts.count)} but ${String(count)} parts are linked`);
    this.base = Math.max(0, first);
    this.slotAt = new Int32Array(Math.max(0, last - this.base)).fill(-1);
    this.heap = new AgendaHeap(2 * count + 1);
    for (let a = parts.head; a !== -1; a = next[a] ?? -1) this.slotAt[(start[a] ?? 0) - this.base] = a;
    const { frozen } = parts;
    for (let a = parts.head; a !== -1;) {
      const b = next[a] ?? -1;
      if (b === -1) break;
      if (!frozen[a] && !frozen[b]) {
        const l = start[a] ?? 0;
        const m = start[b] ?? 0;
        const r = end[b] ?? 0;
        const p = prio.priority(l, m, r);
        if (p < NO_MERGE) this.heap.push(p, l, m, r);
      }
      a = b;
    }
    this.done = this.heap.size === 0;
  }
}

/** Seeds the heap with every adjacent pair of non-frozen parts (04 §1.2). */
export const createMergeState: CreateMergeState = (parts, prio, chunk, trace) => new Agenda(parts, prio, chunk, trace);

/** Pops until the heap is empty or `budgetMs` has elapsed (sampled every 256 pops). Returns `state.done`. */
export const mergeStep: MergeStep = (state, budgetMs) => {
  if (!(state instanceof Agenda)) throw new TypeError('mergeStep needs a state made by createMergeState');
  if (state.done) return true;
  const { parts, prio, heap, slotAt, base, trace, chunk } = state;
  const { start, end, next, prev, frozen } = parts;
  const timed = budgetMs !== Number.POSITIVE_INFINITY;
  const t0 = timed ? now() : 0;
  while (heap.size > 0) {
    if ((++state.pops & 255) === 0 && timed && now() - t0 >= budgetMs) return false;
    heap.pop();
    const p = heap.topPriority;
    const l = heap.topLeft;
    const m = heap.topMid;
    const r = heap.topRight;
    const a = slotAt[l - base] ?? -1;
    if (a === -1 || start[a] !== l || end[a] !== m) continue; // stale: left part changed
    const b = next[a] ?? -1;
    if (b === -1 || end[b] !== r) continue; // stale: right part changed
    if (prio.priority(l, m, r) !== p) continue; // stale (defensive)
    // merge: a absorbs b
    end[a] = r;
    const after = next[b] ?? -1;
    next[a] = after;
    if (after !== -1) prev[after] = a;
    next[b] = -1;
    prev[b] = -1;
    slotAt[m - base] = -1;
    parts.count--;
    trace?.record(StepKind.Merge, l, m, r, p, prio.mergedId(l, m, r), chunk);
    const before = prev[a] ?? -1;
    if (before !== -1 && !frozen[before]) {
      const s = start[before] ?? 0;
      const q = prio.priority(s, l, r);
      if (q < NO_MERGE) heap.push(q, s, l, r);
    }
    if (after !== -1 && !frozen[after]) {
      const e = end[after] ?? 0;
      const q = prio.priority(l, r, e);
      if (q < NO_MERGE) heap.push(q, l, r, e);
    }
  }
  state.done = true;
  return true;
};

/** `createMergeState` + `mergeStep(state, Infinity)`: used by `encode()`, the conformance runner and the benches. */
export const mergeAll: MergeAll = (parts, prio, chunk, trace) => {
  mergeStep(createMergeState(parts, prio, chunk, trace), Number.POSITIVE_INFINITY);
};
