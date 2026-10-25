/**
 * Comparison of our engine with the Python oracle (ids AND byte spans, PA-9) and of the oracle with a second opinion
 * (ids only). Pure functions over plain arrays, so the run loop and the shrinker share them.
 */
import type { Encoded } from './engines.ts';
import type { OracleResult } from './oracle-client.ts';

/** How an engine result differs from the oracle's. */
export type Mismatch =
  | { readonly kind: 'engine-error'; readonly message: string }
  | { readonly kind: 'ids'; readonly at: number }
  | { readonly kind: 'spans'; readonly at: number };

/** Index of the first position where the two lists differ (`min(length)` when one is a prefix), or -1. */
export function firstDifference<T>(a: readonly T[], b: readonly T[], same: (x: T, y: T) => boolean): number {
  const n = Math.min(a.length, b.length);
  for (let i = 0; i < n; i++) if (!same(a[i] as T, b[i] as T)) return i;
  return a.length === b.length ? -1 : n;
}

const sameNumber = (x: number, y: number): boolean => x === y;
const sameSpan = (x: readonly [number, number], y: readonly [number, number]): boolean =>
  x[0] === y[0] && x[1] === y[1];

/** True when `a` and `b` hold the same ids in the same order. */
export function sameIds(a: readonly number[], b: readonly number[]): boolean {
  return firstDifference(a, b, sameNumber) === -1;
}

/**
 * The engine's disagreement with the oracle, or null when ids and spans are equal. `oracle` must be a successful
 * answer (an oracle error is reported separately, `oracle-error`).
 */
export function compareWithOracle(
  engine: Encoded | { readonly error: string },
  oracle: Extract<OracleResult, { ids: readonly number[] }>,
): Mismatch | null {
  if ('error' in engine) return { kind: 'engine-error', message: engine.error };
  const ids = firstDifference(engine.ids, oracle.ids, sameNumber);
  if (ids !== -1) return { kind: 'ids', at: ids };
  const spans = firstDifference(engine.spans, oracle.spans, sameSpan);
  return spans === -1 ? null : { kind: 'spans', at: spans };
}

/** True when the oracle produced an answer (not `{ error }`). */
export function isAnswer(
  result: OracleResult | undefined,
): result is Extract<OracleResult, { ids: readonly number[] }> {
  return result !== undefined && !('error' in result);
}
