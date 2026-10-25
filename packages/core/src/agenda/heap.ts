/**
 * Binary min-heap of merge candidates for the agenda loop (04 §1.2), packed in typed arrays: priority in a `Float64Array`,
 * the `(l, m, r)` triple in three `Int32Array`s. Ordered by `(priority, l)`: lower priority first, ties to the smaller left
 * offset ("lowest rank, leftmost"). Entries are never deleted in place; the loop discards stale ones when they surface
 * (lazy invalidation).
 */
export class AgendaHeap {
  private prio: Float64Array;
  private left: Int32Array;
  private mid: Int32Array;
  private right: Int32Array;
  /** Number of entries. */
  size = 0;
  /** The entry removed by the last successful `pop()`. */
  topPriority = 0;
  topLeft = 0;
  topMid = 0;
  topRight = 0;

  constructor(capacity = 16) {
    const n = Math.max(1, capacity);
    this.prio = new Float64Array(n);
    this.left = new Int32Array(n);
    this.mid = new Int32Array(n);
    this.right = new Int32Array(n);
  }

  private grow(): void {
    const n = this.prio.length * 2;
    const prio = new Float64Array(n);
    prio.set(this.prio);
    this.prio = prio;
    const left = new Int32Array(n);
    left.set(this.left);
    this.left = left;
    const mid = new Int32Array(n);
    mid.set(this.mid);
    this.mid = mid;
    const right = new Int32Array(n);
    right.set(this.right);
    this.right = right;
  }

  /** Adds candidate `(p; l, m, r)`. */
  push(p: number, l: number, m: number, r: number): void {
    if (this.size === this.prio.length) this.grow();
    let i = this.size++;
    while (i > 0) {
      const parent = (i - 1) >> 1;
      const pp = this.prio[parent] ?? 0;
      if (pp < p || (pp === p && (this.left[parent] ?? 0) <= l)) break;
      this.prio[i] = pp;
      this.left[i] = this.left[parent] ?? 0;
      this.mid[i] = this.mid[parent] ?? 0;
      this.right[i] = this.right[parent] ?? 0;
      i = parent;
    }
    this.prio[i] = p;
    this.left[i] = l;
    this.mid[i] = m;
    this.right[i] = r;
  }

  /** Removes the minimum into `top*`; false when empty. */
  pop(): boolean {
    if (this.size === 0) return false;
    this.topPriority = this.prio[0] ?? 0;
    this.topLeft = this.left[0] ?? 0;
    this.topMid = this.mid[0] ?? 0;
    this.topRight = this.right[0] ?? 0;
    const last = --this.size;
    if (last === 0) return true;
    const p = this.prio[last] ?? 0;
    const l = this.left[last] ?? 0;
    const m = this.mid[last] ?? 0;
    const r = this.right[last] ?? 0;
    let i = 0;
    for (;;) {
      let child = 2 * i + 1;
      if (child >= last) break;
      const other = child + 1;
      if (other < last) {
        const cp = this.prio[child] ?? 0;
        const op = this.prio[other] ?? 0;
        if (op < cp || (op === cp && (this.left[other] ?? 0) < (this.left[child] ?? 0))) child = other;
      }
      const cp = this.prio[child] ?? 0;
      if (p < cp || (p === cp && l <= (this.left[child] ?? 0))) break;
      this.prio[i] = cp;
      this.left[i] = this.left[child] ?? 0;
      this.mid[i] = this.mid[child] ?? 0;
      this.right[i] = this.right[child] ?? 0;
      i = child;
    }
    this.prio[i] = p;
    this.left[i] = l;
    this.mid[i] = m;
    this.right[i] = r;
    return true;
  }
}
