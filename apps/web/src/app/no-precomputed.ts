/**
 * The rejection the precomputed-examples client (`examples-client.ts`) gives an encode whose text is not one of the
 * example chips. A module of its own so AppState can recognise it without importing the client, which loads after first
 * paint (`deferred-client.ts`).
 */

/** Rejection of an encode whose text is not one of the precomputed examples (no engine exists yet). */
export class NoPrecomputedResultError extends Error {
  override readonly name = 'NoPrecomputedResultError';
}

/** True for `NoPrecomputedResultError` (by name, so it survives any re-wrapping). */
export function isNoPrecomputedResult(error: unknown): boolean {
  return error instanceof Error && error.name === 'NoPrecomputedResultError';
}
