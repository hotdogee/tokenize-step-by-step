/**
 * `MockTokenizerClient`: the `TokenizerClientLike` contract over fixture results (load before encode, latest encode wins,
 * `cancelled` as the single rejection name, abort signals, lookup, unknown text).
 */
import { describe, expect, it } from 'vitest';
import {
  checkInvariants,
  DEFAULT_OPTIONS,
  isCancelled,
  MockClientError,
  MockTokenizerClient,
  toExamplesWire,
  type Progress,
  type TokenizerClientLike,
} from '../src/index.ts';
import { loadFixture, REFS } from './helpers/fixtures.ts';

function client(unknownText?: 'synthesize' | 'reject'): MockTokenizerClient {
  return new MockTokenizerClient({
    sources: [
      { ref: REFS['openai-o200k_base'], data: loadFixture('openai-o200k_base') },
      {
        ref: REFS['xai-grok1'],
        data: toExamplesWire(loadFixture('xai-grok1'), 'xai-grok1', ['zh-tw-tainan', 'leading-spaces']),
      },
    ],
    ...(unknownText ? { unknownText } : {}),
  });
}

describe('MockTokenizerClient', () => {
  it('implements TokenizerClientLike', async () => {
    const c: TokenizerClientLike = client();
    const features = await c.features;
    expect(features.cacheApi).toBe(false);
    const assets = await c.assets;
    expect(Object.keys(assets)).toHaveLength(9);
  });

  it('loads, notifies residency and encodes fixture texts with the caller seq', async () => {
    const c = client();
    const seen: Array<string | null> = [];
    const off = c.onResident((id) => seen.push(id));
    await expect(c.encode('台灣台南', DEFAULT_OPTIONS)).rejects.toMatchObject({ code: 'not-loaded' });
    const progress: Progress[] = [];
    const loaded = await c.load('openai-o200k_base', (p) => progress.push(p));
    expect(loaded.info.id).toBe('openai-o200k_base');
    expect(progress.at(-1)?.phase).toBe('build');
    expect(c.resident).toBe('openai-o200k_base');
    const result = await c.encode('台灣台南', DEFAULT_OPTIONS);
    expect(Array.from(result.tokens.id)).toEqual([3735, 133072, 3735, 14609]);
    expect(result.seq).toBeGreaterThan(0);
    expect(result.timeline?.stepCount).toBeGreaterThan(0);
    const untraced = await c.encode('台灣台南', { ...DEFAULT_OPTIONS, trace: false });
    expect(untraced.timeline).toBeNull();
    await c.unload();
    expect(c.resident).toBeNull();
    off();
    await c.load('xai-grok1');
    expect(seen).toEqual(['openai-o200k_base', null]);
    const grok = await c.encode('台灣台南', DEFAULT_OPTIONS);
    expect(grok.stats.splitChars).toBe(1);
    expect(checkInvariants(grok)).toEqual([]);
  });

  it('cancels a superseded encode and honours abort signals', async () => {
    const c = client();
    await c.load('openai-o200k_base');
    const first = c.encode('台灣台南', DEFAULT_OPTIONS);
    const second = c.encode('Hello world', DEFAULT_OPTIONS);
    await expect(first).rejects.toSatisfy(isCancelled);
    const ok = await second;
    expect(ok.text).toBe('Hello world');
    const controller = new AbortController();
    const aborted = c.encode('台灣台南', DEFAULT_OPTIONS, undefined, controller.signal);
    controller.abort();
    await expect(aborted).rejects.toMatchObject({ name: 'cancelled' });
    const pre = new AbortController();
    pre.abort();
    await expect(c.encode('x', DEFAULT_OPTIONS, undefined, pre.signal)).rejects.toSatisfy(isCancelled);
    const pending = c.encode('台灣台南', DEFAULT_OPTIONS);
    c.terminate();
    await expect(pending).rejects.toSatisfy(isCancelled);
  });

  it('synthesises or rejects unknown text', async () => {
    const lenient = client();
    await lenient.load('openai-o200k_base');
    const made = await lenient.encode('not in the corpus ✓', DEFAULT_OPTIONS);
    expect(made.tokens.count).toBe(made.chars.count);
    expect(checkInvariants(made)).toEqual([]);
    const strict = client('reject');
    await strict.load('openai-o200k_base');
    await expect(strict.encode('not in the corpus ✓', DEFAULT_OPTIONS)).rejects.toBeInstanceOf(MockClientError);
    await expect(strict.load('google-gemma4')).rejects.toMatchObject({ code: 'fetch' });
    await expect(strict.prefetch('openai-o200k_base')).resolves.toBeUndefined();
  });

  it('looks up ids and byte strings', async () => {
    const c = client();
    await expect(c.lookup({ ids: [1] })).rejects.toMatchObject({ code: 'not-loaded' });
    await c.load('xai-grok1');
    const entries = await c.lookup({ ids: [130876, 336, 5], bytes: new TextEncoder().encode('台') });
    expect(entries[0]).toMatchObject({ id: 130876, piece: '台' });
    expect(Array.from(entries[0]?.bytes ?? [])).toEqual([0xe5, 0x8f, 0xb0]);
    expect(entries[1]).toMatchObject({ id: 336, piece: '▁▁▁▁' });
    expect(entries[2]).toEqual({ id: 5, bytes: null, piece: null });
    expect(entries[3]?.id).toBe(130876);
  });
});
