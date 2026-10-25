/**
 * Fenwick (binary indexed) tree over 0/1 counts — "how many live boundaries lie left of x" and "where is the k-th live
 * boundary" in O(log n). Used to convert between the fixtures' `[position, rank]` merge steps and byte offsets (03 §B.5).
 */
export class Fenwick {
  private readonly tree: Int32Array;
  /** Number of slots (indices 0..size−1). */
  readonly size: number;

  /** A tree of `size` slots, each initialised to `initial` (0 or 1). */
  constructor(size: number, initial: 0 | 1 = 0) {
    this.size = size;
    this.tree = new Int32Array(size + 1);
    if (initial === 1) {
      for (let i = 1; i <= size; i++) {
        this.tree[i] = (this.tree[i] ?? 0) + 1;
        const parent = i + (i & -i);
        if (parent <= size) this.tree[parent] = (this.tree[parent] ?? 0) + (this.tree[i] ?? 0);
      }
    }
  }

  /** Adds `delta` to slot `index`. */
  add(index: number, delta: number): void {
    for (let i = index + 1; i <= this.size; i += i & -i) this.tree[i] = (this.tree[i] ?? 0) + delta;
  }

  /** Sum of slots `0..index` (inclusive); 0 for index < 0. */
  prefix(index: number): number {
    let sum = 0;
    for (let i = Math.min(index, this.size - 1) + 1; i > 0; i -= i & -i) sum += this.tree[i] ?? 0;
    return sum;
  }

  /** Smallest index whose prefix sum reaches `k` (k ≥ 1), or −1 when the total is below `k`. */
  findKth(k: number): number {
    if (k < 1) return -1;
    let pos = 0;
    let remaining = k;
    let step = 1;
    while (step * 2 <= this.size) step *= 2;
    for (; step > 0; step >>= 1) {
      const next = pos + step;
      if (next <= this.size && (this.tree[next] ?? 0) < remaining) {
        pos = next;
        remaining -= this.tree[next] ?? 0;
      }
    }
    return pos < this.size ? pos : -1;
  }
}
