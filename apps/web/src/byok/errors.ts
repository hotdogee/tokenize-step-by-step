/**
 * BYOK error mapping (05 §12, §13): a call's `Failure` → the panel's message code, shown in a `role="alert"` element.
 *
 * Anthropic: 401/403 → the key; 400 → the workspace id when the provider's message names it, else the model (both are
 * what a 400 from `count_tokens` means for a well-formed body, research §3.2); 404 → the model; 429 → the rate limit;
 * 5xx/529 → the provider; a rejected fetch (network or CORS — browsers do not tell them apart) → the zero-data-retention
 * sentence, because ZDR organisations get no CORS headers. xAI: the same, except that a 400/404/422 is the model only when
 * its message says so, and a rejected fetch is a plain network/CORS message.
 */
import type { ByokMessageKey } from './i18n/en.ts';
import type { Failure } from './request.ts';
import { redact } from './request.ts';

export type ByokProvider = 'anthropic' | 'xai';

/** Display names in the "{provider} said" line (brand names, not translated). */
export const PROVIDER_NAMES: Readonly<Record<ByokProvider, string>> = { anthropic: 'Anthropic', xai: 'xAI' };

export type ByokErrorCode =
  'key' | 'workspace' | 'model' | 'request' | 'rate-limit' | 'server' | 'zdr' | 'network' | 'timeout' | 'bad-response';

/** What the panel shows: the code, the HTTP status (when there was one) and the provider's own sentence (redacted). */
export interface ByokError {
  readonly code: ByokErrorCode;
  readonly status: number | null;
  readonly detail: string | null;
}

function httpCode(provider: ByokProvider, status: number, message: string): ByokErrorCode {
  if (status === 401 || status === 403) return 'key';
  if (status === 429) return 'rate-limit';
  if (status >= 500) return 'server';
  if (provider === 'anthropic') {
    if (status === 400) return /workspace/i.test(message) ? 'workspace' : 'model';
    if (status === 404) return 'model';
    return 'request';
  }
  if ((status === 400 || status === 404 || status === 422) && /model/i.test(message)) return 'model';
  return 'request';
}

/** Maps `failure` for `provider`; `key` is masked out of the provider's message. */
export function mapFailure(provider: ByokProvider, failure: Failure, key: string): ByokError {
  switch (failure.kind) {
    case 'http': {
      const message = failure.message ?? '';
      return {
        code: httpCode(provider, failure.status, message),
        status: failure.status,
        detail: failure.message === null ? null : redact(failure.message, key.trim()),
      };
    }
    case 'network':
      return { code: provider === 'anthropic' ? 'zdr' : 'network', status: null, detail: null };
    case 'timeout':
      return { code: 'timeout', status: null, detail: null };
    case 'bad-response':
      return { code: 'bad-response', status: null, detail: null };
  }
}

const MESSAGE_KEYS: Readonly<Record<ByokErrorCode, ByokMessageKey>> = {
  key: 'byok.error.key',
  workspace: 'byok.error.workspace',
  model: 'byok.error.model',
  request: 'byok.error.request',
  'rate-limit': 'byok.error.rateLimit',
  server: 'byok.error.server',
  zdr: 'byok.error.zdr',
  network: 'byok.error.network',
  timeout: 'byok.error.timeout',
  'bad-response': 'byok.error.badResponse',
};

/** The drawer catalog key of an error code's sentence (params: `status`, `host`, `n` = timeout seconds). */
export function errorMessageKey(code: ByokErrorCode): ByokMessageKey {
  return MESSAGE_KEYS[code];
}
