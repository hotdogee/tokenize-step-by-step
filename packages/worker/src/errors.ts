/**
 * Errors with a protocol `ErrorCode` (04 §5, §6). The loader and host throw `TokenizerError` inside the Worker and post it
 * as an `error` message; `TokenizerClient` rejects with a `TokenizerError` rebuilt from that message. A superseded or
 * cancelled request never uses this class: it rejects with the single name `cancelled` (`CancelledError`, AD-21).
 */
import type { ErrorCode } from '@tsbs/core/protocol';

/** A failure the UI can act on: `code` picks the message and action (05 §12), `retryable` offers "try again". */
export class TokenizerError extends Error {
  override readonly name = 'TokenizerError';
  readonly code: ErrorCode;
  readonly retryable: boolean;

  constructor(code: ErrorCode, message: string, retryable: boolean, options?: { readonly cause?: unknown }) {
    super(message, options);
    this.code = code;
    this.retryable = retryable;
  }
}

/** The payload of a wire `error` message. */
export interface WireError {
  readonly code: ErrorCode;
  readonly message: string;
  readonly retryable: boolean;
}

/** Where an error was thrown: a `RangeError` while building tables is an out-of-memory condition (AD-19). */
export type ErrorPhase = 'load' | 'encode' | 'other';

const ENGINE_ERRORS: Readonly<Record<string, ErrorCode>> = {
  FormatError: 'format',
  PretokenizeError: 'pretokenize',
  AlignmentError: 'alignment',
};

/** True for the engine's allocation failures ("Invalid array length", "Array buffer allocation failed", …). */
function looksLikeAllocationFailure(message: string): boolean {
  return /alloc|array length|memory|buffer size/i.test(message);
}

/**
 * Maps anything thrown in the Worker to a wire error (04 §5): `TokenizerError` keeps its code; `FormatError` →
 * `format` (asset rebuild needed); `PretokenizeError` / `AlignmentError` → their codes; a `RangeError` during a load,
 * or an allocation failure during an encode → `oom` (retryable with a hint, AD-19); anything else → `internal`.
 */
export function toWireError(error: unknown, phase: ErrorPhase): WireError {
  if (error instanceof TokenizerError) return { code: error.code, message: error.message, retryable: error.retryable };
  const name = error instanceof Error ? error.name : '';
  const message = error instanceof Error ? error.message : String(error);
  const known = ENGINE_ERRORS[name];
  if (known !== undefined) return { code: known, message, retryable: false };
  if (error instanceof RangeError && (phase === 'load' || looksLikeAllocationFailure(message))) {
    return { code: 'oom', message, retryable: true };
  }
  return { code: 'internal', message: message === '' ? 'internal error' : message, retryable: false };
}
