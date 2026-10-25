import type { Progress } from '@tsbs/core';
import { DEFAULT_OPTIONS } from '@tsbs/core/model/result';
import { describe, expect, it } from 'vitest';
import { cachedTokenizers } from '../shell/cache-probe.ts';
import { progressPercent } from '../shell/progress.ts';
import { AppState, optionsFor } from './app-state.svelte.ts';
import { EXAMPLES, tokenizerEntry } from './registry-stub.ts';
import { StubTokenizerClient, StubUnavailableError } from './stub-client.ts';
import { STORAGE_KEYS } from './storage.ts';
import { defaultResult } from './stub-result.ts';

const flush = (): Promise<void> => new Promise((resolve) => setTimeout(resolve, 0));

describe('StubTokenizerClient (TODO(WP-integration))', () => {
  it('loads with phased, monotone progress and reports the resident tokenizer', async () => {
    const client = new StubTokenizerClient({ tickMs: 0 });
    const residents: Array<string | null> = [];
    client.onResident((id) => residents.push(id));
    const progress: Progress[] = [];
    const loaded = await client.load('openai-o200k_base', (p) => progress.push(p));
    expect(progress.map((p) => p.phase)).toEqual([
      'download',
      'download',
      'download',
      'download',
      'verify',
      'decompress',
      'build',
    ]);
    const percents = progress.map(progressPercent);
    expect([...percents].sort((a, b) => a - b)).toEqual(percents);
    expect(percents.at(-1)).toBe(100);
    expect(loaded.info.id).toBe('openai-o200k_base');
    expect(loaded.info.unicodeVersion).toBe('16.0.0');
    expect(client.resident).toBe('openai-o200k_base');
    await client.unload();
    expect(residents).toEqual(['openai-o200k_base', null]);
  });

  it('serves exactly the precomputed default and rejects anything else', async () => {
    const client = new StubTokenizerClient({ tickMs: 0 });
    await client.load('openai-o200k_base');
    const result = await client.encode('台灣台南', DEFAULT_OPTIONS);
    expect([...result.tokens.id]).toEqual([3735, 133072, 3735, 14609]);
    await expect(client.encode('臺灣', DEFAULT_OPTIONS)).rejects.toBeInstanceOf(StubUnavailableError);
    const assets = await client.assets;
    expect(assets['openai-o200k_base'].bytesCompressed).toBe(1025 * 1024);
  });
});

describe('AppState (05 §1.1)', () => {
  const make = (): AppState => new AppState(new StubTokenizerClient({ tickMs: 0 }), defaultResult());

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

  it('keeps tokens pending for text it has no result for', () => {
    const app = make();
    const chip = EXAMPLES.find((c) => c.key === 'ja-text');
    if (chip === undefined) throw new Error('chip');
    app.chooseExample(chip);
    expect(app.text).toBe('日本語のテキスト');
    expect(app.textLang).toBe('ja');
    expect(app.currentResult).toBeNull();
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
