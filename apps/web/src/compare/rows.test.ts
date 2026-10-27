/** The comparison table's rows (PA-19): defaults, the stored choices, the `r=` round trip and the visible tokenizers. */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { parseUrlState, urlFor, type UrlSnapshot } from '../app/url-state.ts';
import { ANTHROPIC_API, CompareRows, LAB_ROWS, ROW_CHOICES } from './rows.svelte.ts';

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
