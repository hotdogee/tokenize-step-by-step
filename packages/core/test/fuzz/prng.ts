/**
 * Seeded pseudo-random numbers for the fuzz generators (WP12): sfc32 (Chris Doty-Humphrey's Small Fast Counter, 32-bit),
 * keyed by a numeric seed and a stream name so every tokenizer gets its own reproducible sequence from one `--seed`.
 * Pure arithmetic on 32-bit integers: the same seed gives the same strings on every platform and Node version.
 */

/** A deterministic random source. */
export interface Rng {
  /** Uniform in [0, 1). */
  next(): number;
  /** Uniform integer in [0, n) (n ≥ 1). */
  int(n: number): number;
  /** Uniform integer in [min, max] (inclusive). */
  between(min: number, max: number): number;
  /** One element of a non-empty list. */
  pick<T>(items: readonly T[]): T;
  /** True with probability `p`. */
  chance(p: number): boolean;
}

/** FNV-1a over the UTF-16 code units of `text` (32-bit), used to turn a stream name into seed material. */
export function fnv1a32(text: string): number {
  let hash = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) {
    hash ^= text.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return hash >>> 0;
}

/** splitmix32 step: a well-mixed 32-bit value from `state` (used only to seed sfc32). */
function splitmix32(state: number): number {
  let z = (state + 0x9e3779b9) >>> 0;
  z = Math.imul(z ^ (z >>> 16), 0x85ebca6b) >>> 0;
  z = Math.imul(z ^ (z >>> 13), 0xc2b2ae35) >>> 0;
  return (z ^ (z >>> 16)) >>> 0;
}

/** A generator for `seed` (any safe integer, e.g. 20261025) and `stream` (e.g. a tokenizer id). */
export function createRng(seed: number, stream: string): Rng {
  if (!Number.isSafeInteger(seed) || seed < 0)
    throw new RangeError(`seed must be a non-negative integer, got ${String(seed)}`);
  const low = seed >>> 0;
  const high = Math.floor(seed / 2 ** 32) >>> 0;
  const key = fnv1a32(stream);
  let a = splitmix32(low ^ key);
  let b = splitmix32(a ^ high);
  let c = splitmix32(b ^ 0x5bd1e995);
  let d = 1;
  const raw = (): number => {
    const t = (((a + b) >>> 0) + d) >>> 0;
    d = (d + 1) >>> 0;
    a = b ^ (b >>> 9);
    b = (c + (c << 3)) >>> 0;
    c = ((c << 21) | (c >>> 11)) >>> 0;
    c = (c + t) >>> 0;
    return t;
  };
  for (let i = 0; i < 15; i++) raw(); // discard the warm-up outputs (sfc32 recommendation)
  const next = (): number => raw() / 2 ** 32;
  const int = (n: number): number => {
    if (!(n >= 1)) throw new RangeError(`int(n) needs n ≥ 1, got ${String(n)}`);
    return Math.floor(next() * n);
  };
  return {
    next,
    int,
    between: (min, max) => min + int(max - min + 1),
    pick: <T>(items: readonly T[]): T => {
      const item = items[int(items.length)];
      if (item === undefined) throw new RangeError('pick() from an empty list');
      return item;
    },
    chance: (p) => next() < p,
  };
}
