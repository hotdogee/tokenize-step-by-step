/**
 * The comparison table's rows (PA-19): defaults, the stored choices, the `r=` round trip and the visible tokenizers; a
 * row's state (an error shows in an on-demand tier too); the on-demand run's rows, where a failed row never holds up the
 * next.
 */
import type { TokenizerId } from '@tsbs/core';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { FakeClients, flush, hubOf, syntheticResult } from '../app/fake-client.test-helper.ts';
import { ROW_OPTIONS } from '../app/result-hub.svelte.ts';
import { parseUrlState, urlFor, type UrlSnapshot } from '../app/url-state.ts';
import { ANTHROPIC_API, CompareRows, LAB_ROWS, ROW_CHOICES, rowState, runRows } from './rows.svelte.ts';

const store = new Map<string, string>();
beforeEach(() => {
  store.clear();
  vi.stubGlobal('localStorage', {
    getItem: (key: string) => store.get(key) ?? null,
    setItem: (key: string, value: string) => store.set(key, value),
    removeItem: (key: string) => store.delete(key),
  });
});

describe('CompareRows', () => {
  it('has one row per lab in the picker order, each on its primary tokenizer', () => {
    expect(LAB_ROWS.map((row) => row.lab)).toEqual(['openai', 'anthropic', 'google', 'meta', 'xai']);
    const rows = new CompareRows();
    expect(rows.visibleTokenizers()).toEqual([
      'openai-o200k_base',
      'anthropic-claude-legacy',
      'google-gemma4',
      'meta-llama4-muse',
      'xai-grok2',
    ]);
    expect(rows.nonDefault()).toEqual([]);
  });

  it('offers each lab its secondary tokenizers and Anthropic the API-key count', () => {
    expect(LAB_ROWS.map((row) => row.entries.map((entry) => entry.id))).toEqual([
      ['openai-o200k_base', 'openai-cl100k_base'],
      ['anthropic-claude-legacy'],
      ['google-gemma4', 'google-gemma2'],
      ['meta-llama4-muse', 'meta-llama3'],
      ['xai-grok2', 'xai-grok1'],
    ]);
    expect(LAB_ROWS.filter((row) => row.api).map((row) => row.lab)).toEqual(['anthropic']);
    expect(ROW_CHOICES).toEqual(['openai-cl100k_base', ANTHROPIC_API, 'google-gemma2', 'meta-llama3', 'xai-grok1']);
  });

  it('switches a row, stores the non-default choices and removes the key when all are defaults again', () => {
    const rows = new CompareRows();
    rows.select('xai', 'xai-grok1');
    rows.select('anthropic', ANTHROPIC_API);
    expect(rows.choice('xai')).toBe('xai-grok1');
    expect(rows.entryFor('anthropic')).toBeNull();
    expect(rows.visibleTokenizers()).toEqual(['openai-o200k_base', 'google-gemma4', 'meta-llama4-muse', 'xai-grok1']);
    expect(store.get('tsbs:rows')).toBe('anthropic-api,xai-grok1');
    rows.select('xai', 'xai-grok2');
    rows.select('anthropic', 'anthropic-claude-legacy');
    expect(store.has('tsbs:rows')).toBe(false);
  });

  it('ignores a choice another lab owns', () => {
    const rows = new CompareRows();
    rows.select('openai', 'xai-grok1');
    rows.select('google', ANTHROPIC_API);
    expect(rows.nonDefault()).toEqual([]);
  });

  it('restores the stored choices, and the URL’s win over them for the visit', () => {
    expect(new CompareRows(undefined, 'google-gemma2,nope').nonDefault()).toEqual(['google-gemma2']);
    const fromUrl = new CompareRows(['meta-llama3'], 'google-gemma2');
    expect(fromUrl.nonDefault()).toEqual(['meta-llama3']);
  });

  it('round-trips through r= (validated, deduplicated, in row order)', () => {
    const rows = new CompareRows();
    rows.select('meta', 'meta-llama3');
    rows.select('openai', 'openai-cl100k_base');
    const snapshot: UrlSnapshot = {
      tokenizer: 'openai-o200k_base',
      stage: 6,
      step: 0,
      byteView: 'hex',
      locale: 'en',
      textLang: 'auto',
      advanced: false,
      rows: rows.nonDefault(),
    };
    const url = new URL(urlFor('https://x.test/', snapshot));
    expect(url.searchParams.get('r')).toBe('openai-cl100k_base,meta-llama3');
    const parsed = parseUrlState(`${url.search},nope,meta-llama3`, ['openai-o200k_base'], ROW_CHOICES);
    expect(parsed.rows).toEqual(['openai-cl100k_base', 'meta-llama3']);
    expect(new CompareRows(parsed.rows).nonDefault()).toEqual(['openai-cl100k_base', 'meta-llama3']);
  });
});

describe('rowState', () => {
  const base = { api: false, result: null, text: 'b', loaded: false, loading: false, failed: false, onDemand: false };
  const result = syntheticResult('a', 'xai-grok2');

  it('draws the current result, a loaded tokenizer’s last one while it encodes, else waits', () => {
    expect(rowState({ ...base, result: syntheticResult('b', 'xai-grok2') })).toBe('current');
    expect(rowState({ ...base, result, loaded: true })).toBe('stale');
    expect(rowState({ ...base, result, loading: true })).toBe('loading');
    expect(rowState(base)).toBe('waiting');
    expect(rowState({ ...base, api: true })).toBe('api');
  });

  it('shows a failed row’s error with its action, in an on-demand tier too', () => {
    expect(rowState({ ...base, failed: true, result, loaded: true })).toBe('error');
    expect(rowState({ ...base, failed: true, onDemand: true })).toBe('error');
    expect(rowState({ ...base, onDemand: true })).toBe('onDemand');
  });
});

describe('runRows (the on-demand run’s rows, AD-27)', () => {
  const LONG = '長'.repeat(30);
  const GROK2: TokenizerId = 'xai-grok2';
  const GEMMA4: TokenizerId = 'google-gemma4';
  const failure = Object.assign(new Error('network'), { code: 'fetch', retryable: true });

  it('asks for the rows one after another, and a row whose load fails does not hold up the next', async () => {
    const clients = new FakeClients();
    const hub = hubOf(clients.spawn);
    hub.start();
    const asked: TokenizerId[] = [];
    let finished = false;
    void runRows(
      [GROK2, GEMMA4],
      LONG,
      (id, text) => {
        asked.push(id);
        return hub.request(id, text, ROW_OPTIONS, { trace: false });
      },
      () => true,
    ).then(() => {
      finished = true;
    });
    await flush();
    expect(asked).toEqual([GROK2]); // one after another
    clients.of(GROK2).loads[0]?.reject(failure);
    await flush();
    expect(asked).toEqual([GROK2, GEMMA4]);
    expect(hub.entry(GROK2)).toMatchObject({ pending: false, error: { code: 'fetch', phase: 'load' } });
    const gemma = clients.of(GEMMA4);
    gemma.loads[0]?.finish();
    await flush();
    gemma.encodes[0]?.answer();
    await flush();
    expect(finished).toBe(true);
    expect(hub.entry(GEMMA4).result?.input.text).toBe(LONG);
    // The failed row's Retry (a load again) still runs the text the run asked for.
    const retry = hub.load(GROK2);
    clients.of(GROK2).loads[1]?.finish();
    await retry;
    clients.of(GROK2).encodes[0]?.answer();
    await flush();
    expect(hub.entry(GROK2)).toMatchObject({ source: 'live', error: null });
    expect(hub.entry(GROK2).result?.input.text).toBe(LONG);
  });

  it('stops once the text has moved on', async () => {
    const asked: TokenizerId[] = [];
    let current = true;
    await runRows(
      [GROK2, GEMMA4],
      LONG,
      (id) => {
        asked.push(id);
        current = false;
        return Promise.resolve({ kind: 'none' });
      },
      () => current,
    );
    expect(asked).toEqual([GROK2]);
  });
});
