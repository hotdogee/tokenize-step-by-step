/**
 * The worker pool (PA-19): one client per tokenizer, reused while it is acquired, at most six kept while some are
 * unused (the least recently acquired unused one is terminated), and a load that starts only on `start()`.
 */
import type { TokenizerId } from '@tsbs/core';
import { describe, expect, it } from 'vitest';
import { FakeClients, flush } from './fake-client.test-helper.ts';
import { MAX_CLIENTS, TokenizerPool } from './tokenizer-pool.ts';

const IDS: readonly TokenizerId[] = [
  'openai-o200k_base',
  'anthropic-claude-legacy',
  'google-gemma4',
  'meta-llama4-muse',
  'xai-grok2',
  'openai-cl100k_base',
];

describe('TokenizerPool', () => {
  it('spawns one client per tokenizer, reuses it while acquired again, and counts its users', () => {
    const clients = new FakeClients();
    const pool = new TokenizerPool(clients.spawn);
    const first = pool.acquire('openai-o200k_base');
    const again = pool.acquire('openai-o200k_base');
    expect(again).toBe(first);
    expect(first.users).toBe(2);
    expect(clients.all).toHaveLength(1);
    const other = pool.acquire('xai-grok2');
    expect(other.client).not.toBe(first.client);
    expect(clients.all).toHaveLength(2);
    pool.release('openai-o200k_base');
    pool.release('openai-o200k_base');
    pool.release('openai-o200k_base'); // never below zero
    expect(first.users).toBe(0);
    expect(pool.get('openai-o200k_base')).toBe(first); // kept: unused, but the pool is not full
    expect(pool.entries().map((entry) => entry.id)).toEqual(['openai-o200k_base', 'xai-grok2']);
  });

  it('loads nothing on acquire; start() loads once, shares the load, and loads again after a failure', async () => {
    const clients = new FakeClients();
    const pool = new TokenizerPool(clients.spawn);
    const entry = pool.acquire('google-gemma4');
    const [client] = clients.all;
    expect(client?.loads).toHaveLength(0);
    const load = entry.start();
    expect(entry.start()).toBe(load);
    expect(client?.loads).toHaveLength(1);
    client?.loads[0]?.reject(Object.assign(new Error('offline'), { code: 'fetch', retryable: true }));
    await expect(load).rejects.toThrow('offline');
    const retry = entry.start();
    expect(client?.loads).toHaveLength(2);
    expect(entry.loaded).toBe(false);
    client?.loads[1]?.finish();
    await retry;
    expect(entry.loaded).toBe(true);
    expect(entry.start()).toBe(retry); // resident: the finished load is shared
  });

  it('starts the load again when the Worker has lost the tokenizer since (a respawn)', async () => {
    const clients = new FakeClients();
    const pool = new TokenizerPool(clients.spawn);
    const entry = pool.acquire('openai-o200k_base');
    const load = entry.start();
    clients.all[0]?.loads[0]?.finish();
    await load;
    clients.all[0]?.setResident(null);
    expect(entry.loaded).toBe(false);
    void entry.start();
    expect(clients.all[0]?.loads).toHaveLength(2);
  });

  it(`keeps at most ${String(MAX_CLIENTS)} clients: the least recently acquired unused one is terminated`, async () => {
    const clients = new FakeClients();
    const pool = new TokenizerPool(clients.spawn);
    for (const id of IDS.slice(0, MAX_CLIENTS)) pool.acquire(id);
    expect(pool.entries()).toHaveLength(MAX_CLIENTS);
    // Every client is in use: a seventh is spawned anyway (the pool never evicts a client someone shows).
    const seventh = pool.acquire('google-gemma2');
    expect(pool.entries()).toHaveLength(MAX_CLIENTS + 1);
    expect(clients.all.some((client) => client.terminated)).toBe(false);
    // A release trims it back: the unused entry goes.
    pool.release('anthropic-claude-legacy');
    expect(pool.entries()).toHaveLength(MAX_CLIENTS);
    expect(pool.get('anthropic-claude-legacy')).toBeUndefined();
    expect(clients.all[1]?.terminated).toBe(true);
    // An unused entry acquired again is the most recent: the next eviction takes the older unused one.
    pool.release('openai-o200k_base');
    pool.release('google-gemma4');
    pool.acquire('openai-o200k_base');
    pool.release('openai-o200k_base');
    pool.acquire('meta-llama3');
    expect(pool.get('google-gemma4')).toBeUndefined();
    expect(clients.all[2]?.terminated).toBe(true);
    expect(pool.get('openai-o200k_base')?.client).toBe(clients.all[0]);
    expect(pool.entries().at(-1)?.id).toBe('meta-llama3');
    expect(seventh.users).toBe(1);
    await flush();
  });

  it('honours a smaller maximum and spawns a fresh client for an evicted tokenizer', () => {
    const clients = new FakeClients();
    const pool = new TokenizerPool(clients.spawn, 1);
    pool.acquire('openai-o200k_base');
    pool.release('openai-o200k_base');
    pool.acquire('xai-grok2');
    expect(clients.all[0]?.terminated).toBe(true);
    const again = pool.acquire('openai-o200k_base');
    expect(again.client).toBe(clients.all[2]);
    expect(pool.entries().map((entry) => entry.id)).toEqual(['xai-grok2', 'openai-o200k_base']);
  });
});
