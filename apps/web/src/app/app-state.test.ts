import type { Progress, TokenizerId } from '@tsbs/core';
import { toExamplesWire } from '@tsbs/core/fixture/examples-wire';
import { DEFAULT_OPTIONS } from '@tsbs/core/model/result';
import { describe, expect, it } from 'vitest';
import { cachedTokenizers } from '../shell/cache-probe.ts';
import { progressPercent } from '../shell/progress.ts';
import { AppState, optionsFor } from './app-state.svelte.ts';
import { createExamplesClient, defaultResult } from './bootstrap.ts';
import { SHIPPING_FIXTURES } from './fixtures.test-helper.ts';
import { isNoPrecomputedResult } from './no-precomputed.ts';
import { EXAMPLES, EXAMPLES_INDEX, tokenizerEntry } from './registry.ts';
import { STORAGE_KEYS } from './storage.ts';

const flush = (): Promise<void> => new Promise((resolve) => setTimeout(resolve, 0));

/** Serves each tokenizer's examples file (every chip, built from its committed fixture) at its examples-index URL. */
function fixtureFetch(missing: readonly TokenizerId[] = []): (url: string) => Promise<Response> {
  const byUrl = new Map(Object.entries(EXAMPLES_INDEX.files).map(([id, url]) => [url, id as TokenizerId] as const));
  return (url) => {
    const id = byUrl.get(url);
    const fixture = id === undefined ? undefined : SHIPPING_FIXTURES.get(id);
    if (id === undefined || fixture === undefined || missing.includes(id))
      return Promise.resolve(new Response('not found', { status: 404 }));
    const body = JSON.stringify(
      toExamplesWire(
        fixture,
        id,
        EXAMPLES.map((chip) => chip.fixtureCase),
      ),
    );
    return Promise.resolve(new Response(body, { headers: { 'Content-Length': String(new Blob([body]).size) } }));
  };
}

/** A committed fixture case. */
function fixtureCase(id: TokenizerId, name: string): { readonly ids: readonly number[] } {
  const found = SHIPPING_FIXTURES.get(id)?.cases.find((c) => c.name === name);
  if (found === undefined) throw new Error(`${id} ${name}`);
  return found;
}

describe('ExamplesClient (precomputed examples over MockTokenizerClient)', () => {
  it('fetches the examples on first load with monotone progress and reports the resident tokenizer', async () => {
    const client = createExamplesClient(fixtureFetch());
    const residents: Array<string | null> = [];
    client.onResident((id) => residents.push(id));
    const progress: Progress[] = [];
    const loaded = await client.load('openai-o200k_base', (p) => progress.push(p));
    expect(progress[0]?.phase).toBe('download');
    expect(progress.at(-1)?.phase).toBe('build');
    const percents = progress.map(progressPercent);
    expect([...percents].sort((a, b) => a - b)).toEqual(percents);
    expect(percents.at(-1)).toBe(100);
    expect(loaded.info.id).toBe('openai-o200k_base');
    expect(loaded.info.unicodeVersion).toBe('16.0.0');
    expect(client.resident).toBe('openai-o200k_base');
    await client.unload();
    expect(residents).toEqual(['openai-o200k_base', null]);
  });

  it('answers every chip with its oracle result and rejects other text as not precomputed', async () => {
    const client = createExamplesClient(fixtureFetch());
    await client.load('openai-cl100k_base');
    const tainan = await client.encode('台灣台南', DEFAULT_OPTIONS);
    expect([...tainan.tokens.id]).toEqual(fixtureCase('openai-cl100k_base', 'zh-tw-tainan').ids);
    expect(tainan.stats.partialTokens).toBe(2); // 灣 = E7 81 + A3 (05 §4.1)
    await expect(client.encode('not an example ✓', DEFAULT_OPTIONS)).rejects.toSatisfy(isNoPrecomputedResult);
  });

  it('lets a newer load supersede one that is still fetching (one resident)', async () => {
    const client = createExamplesClient(fixtureFetch());
    const first = client.load('xai-grok2');
    const second = client.load('google-gemma4');
    await expect(first).rejects.toMatchObject({ name: 'cancelled' });
    await second;
    expect(client.resident).toBe('google-gemma4');
  });

  it('reports a missing examples file as a fetch error and knows no wire sizes before the Worker client', async () => {
    const client = createExamplesClient(fixtureFetch(['xai-grok1']));
    await expect(client.load('xai-grok1')).rejects.toMatchObject({ code: 'fetch' });
    await expect(client.assets).rejects.toThrow(/WP07/);
  });
});

describe('AppState (05 §1.1)', () => {
  const make = (): AppState => new AppState(createExamplesClient(fixtureFetch()), defaultResult());

  it('starts with the precomputed default example on o200k', () => {
    const app = make();
    expect(app.text).toBe('台灣台南');
    expect(app.tokenizer).toBe('openai-o200k_base');
    expect(app.resultSource).toBe('precomputed');
    expect(app.currentResult?.stats.tokens).toBe(4);
  });

  it('loads, then replaces the precomputed result with the live one', async () => {
    const app = make();
    await app.selectTokenizer('openai-cl100k_base');
    await app.selectTokenizer('openai-o200k_base');
    await flush();
    expect(app.resident).toBe('openai-o200k_base');
    expect(app.loading).toBeNull();
    expect(app.resultSource).toBe('live');
    expect(app.status).toContain('o200k_base');
  });

  it('lets the last tokenizer switch win (strict one-resident, AD-19)', async () => {
    const app = make();
    const first = app.selectTokenizer('xai-grok2');
    const second = app.selectTokenizer('google-gemma4');
    await Promise.all([first, second]);
    await flush();
    expect(app.tokenizer).toBe('google-gemma4');
    expect(app.resident).toBe('google-gemma4');
    expect(app.loading).toBeNull();
    expect(app.error).toBeNull();
  });

  it('answers example chips live and keeps tokens pending for text it has no result for', async () => {
    const app = make();
    const chip = EXAMPLES.find((c) => c.key === 'ja-text');
    if (chip === undefined) throw new Error('chip');
    app.chooseExample(chip);
    expect(app.text).toBe('日本語のテキスト');
    expect(app.textLang).toBe('ja');
    expect(app.currentResult).toBeNull(); // nothing loaded yet
    await app.selectTokenizer('openai-cl100k_base');
    await flush();
    expect(app.currentResult?.stats.tokens).toBe(fixtureCase('openai-cl100k_base', 'ja-text').ids.length);
    app.setText('not an example ✓');
    app.encodeNow();
    await flush();
    expect(app.currentResult).toBeNull();
    expect(app.error).toBeNull();
  });

  it('shows only the toggles a tokenizer declares in its options', () => {
    const withBos = optionsFor(tokenizerEntry('meta-llama3'), { ...DEFAULT_OPTIONS, addBos: true });
    expect(withBos.addBos).toBe(true);
    const withoutBos = optionsFor(tokenizerEntry('openai-o200k_base'), {
      ...DEFAULT_OPTIONS,
      addBos: true,
      normalize: 'NFKC',
    });
    expect(withoutBos).toMatchObject({ addBos: false, normalize: 'none' });
  });

  it('moves stages and merge steps like the 05 §8 keys', () => {
    const app = make();
    expect(app.stepCount).toBe(8);
    app.setStage(3);
    app.moveStage(1);
    expect(app.stage).toBe(4);
    app.moveStep(1); // into stop 5 at step 0
    expect([app.stage, app.step]).toEqual([5, 0]);
    app.moveStep(10); // past the end → stop 6
    expect(app.stage).toBe(6);
    app.moveStep(-1); // back into stop 5 at the last step
    expect([app.stage, app.step]).toEqual([5, 8]);
    app.moveStep(-10); // before the start → stop 4
    expect(app.stage).toBe(4);
    app.moveStage(-1);
    app.moveStage(-1);
    app.moveStage(-1);
    app.moveStage(-1);
    expect(app.stage).toBe(1);
  });

  it('steps ×10 symmetrically at both ends: stop 6 is one past the last step, stops 1–4 one before the first', () => {
    const app = make();
    expect(app.stepCount).toBe(8);
    app.setStage(6);
    app.moveStep(-10); // 9 − 10 = −1: before the start → stop 4 (not stop 5 at step 0)
    expect([app.stage, app.step]).toEqual([4, 0]);
    app.moveStep(10); // −1 + 10 = 9 > 8: past the end → stop 6 (not stop 5 at the last step)
    expect([app.stage, app.step]).toEqual([6, 8]);
    app.moveStep(-1);
    expect([app.stage, app.step]).toEqual([5, 8]);
    app.setStage(6);
    app.moveStep(-9); // 9 − 9 = 0
    expect([app.stage, app.step]).toEqual([5, 0]);
    app.setStage(4);
    app.moveStep(9); // −1 + 9 = 8: the last step
    expect([app.stage, app.step]).toEqual([5, 8]);
    app.setStage(2);
    app.moveStep(-10); // backward from stops 1–3 stays put
    expect([app.stage, app.step]).toEqual([2, 0]);
    app.moveStep(10);
    expect(app.stage).toBe(6);
  });

  it('announces the stop with its count (05 §8)', () => {
    const app = make();
    app.setStage(3);
    app.announceStage();
    expect(app.status).toBe('UTF-8 bytes: 12 bytes');
    app.setStage(2);
    app.announceStage();
    expect(app.status).toBe('Code points: 4 code points');
    app.setStage(4);
    app.announceStage();
    expect(app.status).toBe('Chunks: 4 tokens');
  });

  it('cycles the byte view hex → dec (→ both only when wide)', () => {
    const app = make();
    app.setByteView('hex');
    app.cycleByteView(false);
    expect(app.byteView).toBe('dec');
    app.cycleByteView(false);
    expect(app.byteView).toBe('hex');
    app.cycleByteView(true);
    app.cycleByteView(true);
    expect(app.byteView).toBe('both');
  });

  it('re-announces identical status text', () => {
    const app = make();
    app.announce('copied');
    const first = app.status;
    app.announce('copied');
    expect(app.status).not.toBe(first);
    expect(app.status.trim()).toBe('copied');
  });
});

describe('storage keys', () => {
  it('match the keys boot.ts reads before first paint (boot.ts cannot import storage.ts)', () => {
    const boot = Object.values(
      import.meta.glob<string>('./boot.ts', { query: '?raw', import: 'default', eager: true }),
    )[0];
    for (const key of [STORAGE_KEYS.locale, STORAGE_KEYS.theme, STORAGE_KEYS.cellSize])
      expect(boot).toContain(`'${key}'`);
  });
});

describe('cachedTokenizers', () => {
  it('derives "downloaded" from cached /tok/<id>/*.bin URLs only', () => {
    const urls = [
      'https://example.test/tok/openai-o200k_base/3f9a1c0b7e2d.bin',
      'https://example.test/__tsbs-index',
      'https://example.test/tok/xai-grok2/notabin.json',
    ];
    expect([...cachedTokenizers(urls, ['openai-o200k_base', 'xai-grok2'])]).toEqual(['openai-o200k_base']);
  });
});

describe('progressPercent (03 §C.6 weights)', () => {
  const p = (phase: Progress['phase'], loaded: number, total: number | null): Progress => ({
    tokenizer: 'openai-o200k_base',
    phase,
    loaded,
    total,
  });
  it('maps download 0–75, verify 75–78, decompress 78–84, build 84–100', () => {
    expect(progressPercent(p('download', 50, 100))).toBe(38);
    expect(progressPercent(p('download', 0, null))).toBe(0);
    expect(progressPercent(p('cache', 1, 1))).toBe(75);
    expect(progressPercent(p('verify', 1, 1))).toBe(78);
    expect(progressPercent(p('decompress', 1, 2))).toBe(81);
    expect(progressPercent(p('build', 1, 1))).toBe(100);
  });
});
