/**
 * The single rejection of a superseded or aborted request (AD-21): `name === 'cancelled'`, shared by `TokenizerClient`
 * (`@tsbs/worker`) and `MockTokenizerClient` (`fixture/mock-client`). It lives apart from the mock so the production client
 * does not pull the whole mock module into its chunk.
 */
export class CancelledError extends Error {
  override readonly name = 'cancelled';
  constructor() {
    super('cancelled');
  }
}

/** True for `CancelledError` and anything else named `cancelled` (the real client's rejection). */
export function isCancelled(error: unknown): boolean {
  return error instanceof Error && error.name === 'cancelled';
}
