/**
 * The BYOK HTTP path (05 §13): a POST with credentials omitted, no referrer, no cache, no redirects; HTTP errors carry the
 * provider's message; a rejected fetch is a network failure; a timeout and a caller abort are told apart.
 */
import { describe, expect, it } from 'vitest';
import { callProvider, providerMessage, redact, type ProviderRequest } from './request.ts';

const REQUEST: ProviderRequest = {
  url: 'https://api.x.ai/v1/tokenize-text',
  headers: { 'content-type': 'application/json', authorization: 'Bearer k' },
  body: '{"text":"a","model":"grok-4.7"}',
};

const json = (status: number, body: unknown): Response =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

describe('callProvider', () => {
  it('POSTs with credentials omitted, no referrer, no cache and no redirects', async () => {
    let seen: { url: string; init: RequestInit } | null = null;
    const outcome = await callProvider(REQUEST, new AbortController().signal, (url, init) => {
      seen = { url, init };
      return Promise.resolve(json(200, { token_ids: [] }));
    });
    expect(outcome).toEqual({ ok: true, json: { token_ids: [] } });
    expect(seen).toMatchObject({
      url: REQUEST.url,
      init: {
        method: 'POST',
        headers: REQUEST.headers,
        body: REQUEST.body,
        credentials: 'omit',
        mode: 'cors',
        cache: 'no-store',
        redirect: 'error',
        referrerPolicy: 'no-referrer',
      },
    });
  });

  it("reports an HTTP error with the provider's message", async () => {
    const outcome = await callProvider(REQUEST, new AbortController().signal, () =>
      Promise.resolve(json(401, { type: 'error', error: { type: 'authentication_error', message: 'invalid key' } })),
    );
    expect(outcome).toEqual({ ok: false, failure: { kind: 'http', status: 401, message: 'invalid key' } });
  });

  it('reports a rejected fetch (network or CORS) as a network failure', async () => {
    const outcome = await callProvider(REQUEST, new AbortController().signal, () =>
      Promise.reject(new TypeError('Failed to fetch')),
    );
    expect(outcome).toEqual({ ok: false, failure: { kind: 'network' } });
  });

  it('reports a body that is not JSON as a bad response', async () => {
    const outcome = await callProvider(REQUEST, new AbortController().signal, () =>
      Promise.resolve(new Response('<html>', { status: 200 })),
    );
    expect(outcome).toEqual({ ok: false, failure: { kind: 'bad-response' } });
  });

  it('times out, and tells a caller abort apart from a timeout', async () => {
    const hang = (_url: string, init: RequestInit): Promise<Response> =>
      new Promise((_resolve, reject) => {
        init.signal?.addEventListener('abort', () => {
          reject(new DOMException('aborted', 'AbortError'));
        });
      });
    expect(await callProvider(REQUEST, new AbortController().signal, hang, 10)).toEqual({
      ok: false,
      failure: { kind: 'timeout' },
    });
    const controller = new AbortController();
    const pending = callProvider(REQUEST, controller.signal, hang, 10_000);
    controller.abort();
    expect(await pending).toEqual({ ok: false, aborted: true });
  });
});

describe('providerMessage and redact', () => {
  it('reads Anthropic and xAI error shapes', () => {
    expect(providerMessage({ error: { message: 'Overloaded' } })).toBe('Overloaded');
    expect(providerMessage({ code: 'x', error: 'unauthenticated:no-credentials' })).toBe(
      'unauthenticated:no-credentials',
    );
    expect(providerMessage({ message: 'nope' })).toBe('nope');
    expect(providerMessage({ error: {} })).toBeNull();
    expect(providerMessage('text')).toBeNull();
    expect(providerMessage({ error: 'x'.repeat(400) })?.length).toBe(300);
  });

  it('masks every occurrence of the key', () => {
    expect(redact('bad key abcd1234 (abcd1234)', 'abcd1234')).toBe('bad key ••• (•••)');
    expect(redact('short', 'ab')).toBe('short');
  });
});
