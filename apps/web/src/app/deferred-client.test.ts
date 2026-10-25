import type { LoadedInfo, TokenizationResult, TokenizerClientLike, TokenizerId } from '@tsbs/core';
import { DEFAULT_OPTIONS } from '@tsbs/core/model/result';
import { describe, expect, it, vi } from 'vitest';
import { ClientImportError, DeferredClient } from './deferred-client.ts';

/** A client that records calls and reports residency like the real one. */
function fakeClient(): TokenizerClientLike & { readonly calls: string[]; terminated: boolean } {
  const listeners = new Set<(id: TokenizerId | null) => void>();
  let resident: TokenizerId | null = null;
  const calls: string[] = [];
  const assets = Promise.reject(new Error('no wire sizes'));
  assets.catch(() => undefined); // like ExamplesClient: no wire sizes before the Worker client
  return {
    calls,
    terminated: false,
    features: Promise.resolve({ cacheApi: true, segmenter: true, brotli: false, subtleCrypto: true }),
    assets,
    get resident() {
      return resident;
    },
    onResident(cb) {
      listeners.add(cb);
      return () => listeners.delete(cb);
    },
    load(id) {
      calls.push(`load ${id}`);
      resident = id;
      for (const cb of listeners) cb(id);
      return Promise.resolve({ info: { id } } as unknown as LoadedInfo);
    },
    prefetch(id) {
      calls.push(`prefetch ${id}`);
      return Promise.resolve();
    },
    encode(text) {
      calls.push(`encode ${text}`);
      return Promise.resolve({ text } as unknown as TokenizationResult);
    },
    lookup() {
      calls.push('lookup');
      return Promise.resolve([]);
    },
    unload() {
      calls.push('unload');
      resident = null;
      for (const cb of listeners) cb(null);
      return Promise.resolve();
    },
    terminate() {
      this.terminated = true;
    },
  };
}

describe('DeferredClient', () => {
  it('imports the client on the first call that needs it, not when built, subscribed to or asked for features', async () => {
    const inner = fakeClient();
    const create = vi.fn(() => Promise.resolve(inner));
    const client = new DeferredClient(create);
    const residents: Array<TokenizerId | null> = [];
    client.onResident((id) => residents.push(id));
    void client.features;
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(create).not.toHaveBeenCalled();
    expect(client.resident).toBeNull();

    await client.load('openai-o200k_base');
    expect(create).toHaveBeenCalledTimes(1);
    expect(client.resident).toBe('openai-o200k_base');
    await expect(client.features).resolves.toMatchObject({ cacheApi: true });
    await expect(client.assets).rejects.toThrow('no wire sizes');
    await client.unload();
    expect(residents).toEqual(['openai-o200k_base', null]);
  });

  it('forwards calls made before the import settles in call order', async () => {
    const inner = fakeClient();
    const client = new DeferredClient(() => Promise.resolve(inner));
    await Promise.all([
      client.unload(),
      client.load('xai-grok2'),
      client.encode('台灣台南', DEFAULT_OPTIONS),
      client.prefetch('xai-grok1'),
      client.lookup({ ids: [1] }),
    ]);
    expect(inner.calls).toEqual(['unload', 'load xai-grok2', 'encode 台灣台南', 'prefetch xai-grok1', 'lookup']);
    client.terminate();
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(inner.terminated).toBe(true);
  });

  it('stops forwarding residency after unsubscribe', async () => {
    const client = new DeferredClient(() => Promise.resolve(fakeClient()));
    const residents: Array<TokenizerId | null> = [];
    const unsubscribe = client.onResident((id) => residents.push(id));
    unsubscribe();
    await client.load('google-gemma4');
    expect(residents).toEqual([]);
  });

  it('rejects every call with code fetch when the chunk cannot be imported (AD-11 reload alert)', async () => {
    const client = new DeferredClient(() =>
      Promise.reject(new TypeError('Failed to fetch dynamically imported module')),
    );
    const failure = client.load('openai-o200k_base');
    await expect(failure).rejects.toBeInstanceOf(ClientImportError);
    await expect(failure).rejects.toMatchObject({ code: 'fetch', message: /dynamically imported module/ });
    await expect(client.encode('x', DEFAULT_OPTIONS)).rejects.toMatchObject({ code: 'fetch' });
    await expect(client.features).rejects.toBeInstanceOf(ClientImportError);
    expect(client.resident).toBeNull();
  });
});
