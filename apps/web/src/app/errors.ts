/**
 * User-facing errors (05 §12, 04 §5), pure: what the client rejected with → a `UiError`, and a `UiError` → the alert's
 * message and action.
 *
 * | code                    | message (05 §12)                                         | action |
 * | ----------------------- | -------------------------------------------------------- | ------ |
 * | fetch, not retryable    | "A new version is available — reload" (stale deploy, 404) | reload |
 * | fetch, retryable        | "Could not download <name> — retry" (network, 5xx)        | retry  |
 * | integrity, decompress   | "Download was corrupted — retry" (after the loader's one automatic refetch) | retry |
 * | format                  | "A new version is available — reload" (asset rebuild needed) | reload |
 * | oom                     | "Not enough memory to load <name> … — try <fallback>"    | back: reload the previous tokenizer from cache |
 * | quota                   | informational: the tokenizer works without the cache       | none   |
 * | pretokenize, alignment  | "This text could not be tokenized" (an engine error; retrying gives the same) | none |
 * | not-loaded, internal    | "Something went wrong: <message>"                         | retry (reloads the tokenizer) |
 *
 * A cancelled request (`cancelled`, AD-21) is never an error.
 */
import type { ErrorCode, TokenizerId } from '@tsbs/core';
import type { MessageKey } from '../i18n/en.ts';
import type { Params } from '../i18n/types.ts';

/** A user-facing error: an `ErrorCode` plus what the alert needs to offer an action. */
export interface UiError {
  readonly code: ErrorCode;
  readonly message: string;
  readonly retryable: boolean;
  readonly tokenizer: TokenizerId;
  /** For `oom`: the tokenizer the back action reloads (AD-19). */
  readonly previous: TokenizerId | null;
}

export type ErrorAction = 'reload' | 'retry' | 'back';

/** What the alert shows for a `UiError`. */
export interface ErrorView {
  readonly key: MessageKey;
  readonly params: Params;
  readonly action: ErrorAction | null;
  /** Informational (`quota`): no action, the page works on. */
  readonly informational: boolean;
}

const CODES: readonly ErrorCode[] = [
  'fetch',
  'integrity',
  'format',
  'decompress',
  'quota',
  'not-loaded',
  'pretokenize',
  'alignment',
  'oom',
  'internal',
];

/** True for the single cancellation name of AD-21 (`CancelledError`, on the wire and in the client). */
export function isCancelledError(error: unknown): boolean {
  return (
    error instanceof Error &&
    (error.name === 'cancelled' || error.name === 'CancelledError' || error.message === 'cancelled')
  );
}

/** The `UiError` of anything a client call rejected with (`TokenizerError`, `ClientImportError`, or anything else). */
export function toUiError(error: unknown, tokenizer: TokenizerId, previous: TokenizerId | null): UiError {
  const record = (typeof error === 'object' && error !== null ? error : {}) as Partial<
    Record<'code' | 'message' | 'retryable', unknown>
  >;
  const code = CODES.includes(record.code as ErrorCode) ? (record.code as ErrorCode) : 'internal';
  return {
    code,
    message: typeof record.message === 'string' ? record.message : String(error),
    retryable: record.retryable === true || code === 'integrity' || code === 'decompress',
    tokenizer,
    previous: previous === tokenizer ? null : previous,
  };
}

/** The alert for `error`; `name` gives a tokenizer's display name, `fallback` the one to suggest after an `oom`. */
export function errorView(error: UiError, name: (id: TokenizerId) => string, fallback: TokenizerId): ErrorView {
  const informational = { informational: false } as const;
  switch (error.code) {
    case 'fetch':
      return error.retryable
        ? { key: 'error.network', params: { name: name(error.tokenizer) }, action: 'retry', ...informational }
        : { key: 'error.fetch', params: {}, action: 'reload', ...informational };
    case 'format':
      return { key: 'error.fetch', params: {}, action: 'reload', ...informational };
    case 'integrity':
    case 'decompress':
      return { key: 'error.integrity', params: {}, action: 'retry', ...informational };
    case 'oom':
      return {
        key: 'error.oom',
        params: { name: name(error.tokenizer), fallback: name(error.previous ?? fallback) },
        action: 'back',
        ...informational,
      };
    case 'quota':
      return { key: 'error.quota', params: {}, action: null, informational: true };
    case 'pretokenize':
    case 'alignment':
      return { key: 'error.engine', params: { code: error.code }, action: null, ...informational };
    case 'not-loaded':
    case 'internal':
      return { key: 'error.internal', params: { message: error.message }, action: 'retry', ...informational };
  }
}
