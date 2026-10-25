/**
 * Test-only literal port of tiktoken's quadratic `_byte_pair_merge` (tiktoken 0.14.0, src/lib.rs) — the reference the
 * agenda loop must reproduce step for step (AD-5, 04 §1.2). `Rank::MAX` is `RANK_MAX`; the scan keeps the first minimum
 * (strict `<`), i.e. "lowest rank, leftmost".
 */
export const RANK_MAX = Number.MAX_SAFE_INTEGER;

export interface ReferenceMerge {
  /** Index of the left part in the current part list (the fixtures' `position`). */
  readonly position: number;
  readonly left: number;
  readonly mid: number;
  readonly end: number;
  readonly rank: number;
}

export interface ReferenceResult {
  readonly merges: readonly ReferenceMerge[];
  /** Final part starts plus `piece.length`. */
  readonly boundaries: readonly number[];
}

/** Runs the reference on `piece` with `rankOf(bytes)` (undefined = not a vocabulary entry). */
export function bytePairMergeReference(
  piece: Uint8Array,
  rankOf: (bytes: Uint8Array) => number | undefined,
): ReferenceResult {
  if (piece.length < 2) return { merges: [], boundaries: piece.length === 0 ? [0] : [0, 1] };
  const rank = (start: number, end: number): number => rankOf(piece.subarray(start, end)) ?? RANK_MAX;
  // parts[i] = [start offset, rank of merging part i with part i+1]
  const parts: Array<[number, number]> = [];
  let min: [number, number] = [RANK_MAX, -1];
  for (let i = 0; i < piece.length - 1; i++) {
    const r = rank(i, i + 2);
    if (r < min[0]) min = [r, i];
    parts.push([i, r]);
  }
  parts.push([piece.length - 1, RANK_MAX]);
  parts.push([piece.length, RANK_MAX]);
  const getRank = (i: number): number => {
    const a = parts[i];
    const d = parts[i + 3];
    return a !== undefined && d !== undefined ? rank(a[0], d[0]) : RANK_MAX;
  };
  const merges: ReferenceMerge[] = [];
  while (min[0] !== RANK_MAX) {
    const i = min[1];
    merges.push({
      position: i,
      left: parts[i]?.[0] ?? 0,
      mid: parts[i + 1]?.[0] ?? 0,
      end: parts[i + 2]?.[0] ?? 0,
      rank: min[0],
    });
    const before = parts[i - 1];
    if (i > 0 && before !== undefined) before[1] = getRank(i - 1);
    const self = parts[i];
    if (self !== undefined) self[1] = getRank(i);
    parts.splice(i + 1, 1);
    min = [RANK_MAX, -1];
    for (let j = 0; j < parts.length - 1; j++) {
      const r = parts[j]?.[1] ?? RANK_MAX;
      if (r < min[0]) min = [r, j];
    }
  }
  return { merges, boundaries: parts.map(([start]) => start) };
}

/** Deterministic 32-bit PRNG (mulberry32) for synthetic vocabularies. */
export function prng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * A synthetic rank table over `piece`: each distinct substring of length 2..maxLen is a vocabulary entry with probability
 * `density`, and the entries get distinct ranks in random order (seeded).
 */
export function syntheticRanks(piece: Uint8Array, density: number, seed: number, maxLen = 8): Map<string, number> {
  const random = prng(seed);
  const keys = new Set<string>();
  for (let len = 2; len <= Math.min(maxLen, piece.length); len++) {
    for (let i = 0; i + len <= piece.length; i++) keys.add(String.fromCharCode(...piece.subarray(i, i + len)));
  }
  const chosen = [...keys].filter(() => random() < density);
  for (let i = chosen.length - 1; i > 0; i--) {
    const j = Math.floor(random() * (i + 1));
    const t = chosen[i] ?? '';
    chosen[i] = chosen[j] ?? '';
    chosen[j] = t;
  }
  return new Map(chosen.map((key, rank) => [key, rank]));
}

/** Byte-string key used by `syntheticRanks`. */
export function keyOf(bytes: Uint8Array): string {
  return String.fromCharCode(...bytes);
}
