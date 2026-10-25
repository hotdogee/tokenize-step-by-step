/** BYOK error mapper (05 §12, §13): HTTP status / network failures → the panel's message codes. */
import { describe, expect, it } from 'vitest';
import { errorMessageKey, mapFailure, type ByokErrorCode } from './errors.ts';
import { BYOK_CATALOGS } from './i18n/catalogs.ts';

const http = (status: number, message: string | null = null) => ({ kind: 'http', status, message }) as const;

describe('mapFailure: Anthropic', () => {
  const code = (status: number, message: string | null = null): ByokErrorCode =>
    mapFailure('anthropic', http(status, message), 'sk-ant-secret').code;

  it('maps 401/403 to the key, 429 to the rate limit, 5xx and 529 to the provider', () => {
    expect(code(401, 'invalid x-api-key')).toBe('key');
    expect(code(403)).toBe('key');
    expect(code(429)).toBe('rate-limit');
    expect(code(500)).toBe('server');
    expect(code(529, 'Overloaded')).toBe('server');
  });

  it('maps a 400 naming the workspace to the workspace id, any other 400 or a 404 to the model', () => {
    expect(code(400, 'anthropic-workspace-id header is required for this key')).toBe('workspace');
    expect(code(400, 'model: claude-x is not a valid model')).toBe('model');
    expect(code(400)).toBe('model');
    expect(code(404, 'model: not_found')).toBe('model');
    expect(code(413)).toBe('request');
  });

  it('maps a rejected fetch (network or CORS) to the zero-data-retention sentence', () => {
    expect(mapFailure('anthropic', { kind: 'network' }, 'k')).toEqual({ code: 'zdr', status: null, detail: null });
  });

  it('keeps the status and the provider message, with the key masked', () => {
    expect(mapFailure('anthropic', http(401, 'invalid key sk-ant-secret'), ' sk-ant-secret ')).toEqual({
      code: 'key',
      status: 401,
      detail: 'invalid key •••',
    });
  });
});

describe('mapFailure: xAI', () => {
  const code = (status: number, message: string | null = null): ByokErrorCode =>
    mapFailure('xai', http(status, message), 'xai-secret').code;

  it('maps the statuses like Anthropic, the model only when the message says so', () => {
    expect(code(401, 'unauthenticated:no-credentials')).toBe('key');
    expect(code(429)).toBe('rate-limit');
    expect(code(503)).toBe('server');
    expect(code(400, 'Model grok-9 does not exist')).toBe('model');
    expect(code(404, 'The model grok-3 was retired')).toBe('model');
    expect(code(422, 'text: field required')).toBe('request');
    expect(code(400)).toBe('request');
  });

  it('maps a rejected fetch to the plain network/CORS message, a timeout and a bad body to their own', () => {
    expect(mapFailure('xai', { kind: 'network' }, 'k').code).toBe('network');
    expect(mapFailure('xai', { kind: 'timeout' }, 'k').code).toBe('timeout');
    expect(mapFailure('xai', { kind: 'bad-response' }, 'k').code).toBe('bad-response');
  });
});

describe('errorMessageKey', () => {
  it('names a drawer catalog key for every code', () => {
    const codes: ByokErrorCode[] = [
      'key',
      'workspace',
      'model',
      'request',
      'rate-limit',
      'server',
      'zdr',
      'network',
      'timeout',
      'bad-response',
    ];
    for (const value of codes) expect(BYOK_CATALOGS.en[errorMessageKey(value)], value).toBeDefined();
    expect(BYOK_CATALOGS.en[errorMessageKey('zdr')]).toContain(
      'Zero-data-retention organisations cannot call this endpoint from a browser',
    );
  });
});
