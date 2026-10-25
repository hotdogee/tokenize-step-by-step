/**
 * Constructors and readers for the agenda's `PartList` (04 §1.1): a doubly linked list over `Int32Array`s indexed by part
 * slot, with half-open `[start, end)` offsets into the engine's working buffer and a `frozen` flag per slot (spm
 * USER_DEFINED / matched specials never merge). Parts must be non-empty and contiguous in list order.
 */
import type { PartList } from './types.ts';

/** A list whose slot i is `[starts[i], starts[i+1])`, the last ending at `end`; `frozen[i] = 1` marks a frozen part. */
export function partListFromStarts(starts: ArrayLike<number>, end: number, frozen?: ArrayLike<number>): PartList {
  const n = starts.length;
  const list: PartList = {
    start: new Int32Array(n),
    end: new Int32Array(n),
    next: new Int32Array(n),
    prev: new Int32Array(n),
    frozen: new Uint8Array(n),
    head: n > 0 ? 0 : -1,
    count: n,
  };
  for (let i = 0; i < n; i++) {
    const s = starts[i] ?? 0;
    const e = i + 1 < n ? (starts[i + 1] ?? end) : end;
    if (!(e > s)) throw new RangeError(`part ${String(i)} [${String(s)}, ${String(e)}) is empty or reversed`);
    list.start[i] = s;
    list.end[i] = e;
    list.next[i] = i + 1 < n ? i + 1 : -1;
    list.prev[i] = i - 1;
    list.frozen[i] = frozen?.[i] ? 1 : 0;
  }
  return list;
}

/** One part per byte of `[start, end)` (byte-level BPE's starting point). */
export function bytePartList(start: number, end: number): PartList {
  const starts = new Int32Array(Math.max(0, end - start));
  for (let i = 0; i < starts.length; i++) starts[i] = start + i;
  return partListFromStarts(starts, end);
}

/** The live parts as `[start, end)` pairs in list order. */
export function partSpans(parts: PartList): Array<readonly [number, number]> {
  const out: Array<readonly [number, number]> = [];
  for (let a = parts.head; a !== -1; a = parts.next[a] ?? -1) out.push([parts.start[a] ?? 0, parts.end[a] ?? 0]);
  return out;
}

/** The live slots in list order. */
export function partSlots(parts: PartList): number[] {
  const out: number[] = [];
  for (let a = parts.head; a !== -1; a = parts.next[a] ?? -1) out.push(a);
  return out;
}
