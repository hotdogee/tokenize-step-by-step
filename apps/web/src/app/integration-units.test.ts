/**
 * The pure integration modules of WP13: URL state round trips (05 §1.1), long-input tier selection (AD-27), the error
 * mapper (05 §12, 04 §5), the precomputed-examples source (AD-16) and the vocabulary load trigger (06 §3).
 */
import type { TokenizerId } from '@tsbs/core';
import { toExamplesWire } from '@tsbs/core/fixture/examples-wire';
import { DEFAULT_OPTIONS } from '@tsbs/core/model/result';
import { describe, expect, it } from 'vitest';
import { errorView, isCancelledError, toUiError, type UiError } from './errors.ts';
import { SHIPPING_FIXTURES } from './fixtures.test-helper.ts';
import { afterFirstPaint, PAINT_WAIT_CAP_MS, type TriggerEnv } from './load-trigger.ts';
import {
  analysedText,
  countCodePoints,
  isOnDemand,
  longInputMode,
  ON_DEMAND_MAX_STEPS,
  traceFor,
  utf8ByteLength,
} from './long-input.ts';
import { PrecomputedExamples } from './precomputed.ts';
import { EXAMPLES, tokenizerEntry, TOKENIZERS } from './registry.ts';
import { MAX_LINK_TEXT, parseUrlState, shareLink, stageParam, urlFor, type UrlSnapshot } from './url-state.ts';
import { ROW_CHOICES } from '../compare/rows.svelte.ts';

const IDS: readonly TokenizerId[] = TOKENIZERS.map((entry) => entry.id);
const SNAPSHOT: UrlSnapshot = {
  tokenizer: 'xai-grok2',
  stage: 5,
  step: 7,
  byteView: 'both',
  locale: 'ja',
  textLang: 'ja',
  advanced: true,
  rows: ['openai-cl100k_base', 'xai-grok1'],
};

describe('URL state (05 §1.1)', () => {
  it('round-trips every field through urlFor → parseUrlState, in the order t, q, r, s, b, lang, tl', () => {
    const url = new URL(urlFor('https://tsbs.example/', SNAPSHOT, '台灣台南'));
    expect([...url.searchParams.keys()]).toEqual(['t', 'q', 'r', 's', 'b', 'lang', 'tl']);
    expect(parseUrlState(url.search, IDS, ROW_CHOICES)).toEqual({
      tokenizer: 'xai-grok2',
      text: '台灣台南',
      rows: ['openai-cl100k_base', 'xai-grok1'],
      stage: 5,
      step: 7,
      byteView: 'both',
      locale: 'ja',
      textLang: 'ja',
      advanced: true,
    });
    for (const stage of [1, 2, 3, 4, 6] as const) {
      const parsed = parseUrlState(new URL(urlFor('https://x.test/', { ...SNAPSHOT, stage })).search, IDS);
      expect(parsed.stage).toBe(stage);
      expect(parsed.step).toBeUndefined();
    }
    expect(stageParam(5, 0)).toBe('5.0');
    expect(stageParam(6, 12)).toBe('6');
  });

  it('keeps parameters it does not own and drops q unless the text is given', () => {
    const url = new URL(urlFor('https://x.test/?mock=1&q=old&t=nope', SNAPSHOT));
    expect(url.searchParams.get('mock')).toBe('1');
    expect(url.searchParams.has('q')).toBe(false);
    expect(url.searchParams.get('t')).toBe('xai-grok2');
  });

  it('writes t and s only while Advanced is open, and r only for non-default rows (PA-19)', () => {
    const closed = new URL(urlFor('https://x.test/?t=old&s=3', { ...SNAPSHOT, advanced: false, rows: [] }));
    expect([...closed.searchParams.keys()]).toEqual(['b', 'lang', 'tl']);
    expect(parseUrlState(closed.search, IDS, ROW_CHOICES).advanced).toBe(false);
    expect(parseUrlState('?s=6', IDS).advanced).toBe(true);
    expect(parseUrlState('?t=meta-llama3', IDS).advanced).toBe(true);
  });

  it('ignores invalid values (defaults stay)', () => {
    expect(parseUrlState('?t=gpt-9&s=7.2&b=octal&lang=fr&tl=ko&r=nope', IDS, ROW_CHOICES)).toEqual({
      advanced: false,
    });
    expect(parseUrlState('?s=5', IDS)).toEqual({ stage: 5, advanced: true });
    expect(parseUrlState('?s=4.9', IDS)).toEqual({ stage: 4, advanced: true });
    expect(parseUrlState('?s=5.x&q=', IDS)).toEqual({ advanced: false });
    expect(parseUrlState('?t=openai-cl100k_base', ['openai-o200k_base'])).toEqual({ advanced: false });
    expect(parseUrlState('?r=openai-o200k_base,xai-grok1,xai-grok1', IDS, ROW_CHOICES).rows).toEqual(['xai-grok1']);
  });

  it('puts the text into the shared link only up to 2,000 code points', () => {
    const short = shareLink('https://x.test/', SNAPSHOT, '𰻝'.repeat(MAX_LINK_TEXT));
    expect(short.withText).toBe(true);
    expect(new URL(short.url).searchParams.get('q')).toBe('𰻝'.repeat(MAX_LINK_TEXT));
    const long = shareLink('https://x.test/', SNAPSHOT, 'a'.repeat(MAX_LINK_TEXT + 1));
    expect(long.withText).toBe(false);
    expect(new URL(long.url).searchParams.has('q')).toBe(false);
    expect(shareLink('https://x.test/', SNAPSHOT, '').withText).toBe(false);
  });
});

describe('long-input tiers (AD-27)', () => {
  it('selects the tier and the trace policy at the exact thresholds', () => {
    expect([2000, 2001, 20_000, 20_001, 200_000, 200_001].map(longInputMode)).toEqual([
      'live',
      'virtualized',
      'virtualized',
      'on-demand',
      'on-demand',
      'capped',
    ]);
    expect([20_000, 20_001, 100_000, 100_001].map(traceFor)).toEqual([
      true,
      { maxSteps: ON_DEMAND_MAX_STEPS },
      { maxSteps: ON_DEMAND_MAX_STEPS },
      false,
    ]);
    expect(isOnDemand('capped') && isOnDemand('on-demand') && !isOnDemand('virtualized')).toBe(true);
  });

  it('counts code points and UTF-8 bytes as TextEncoder does (pairs, lone surrogates)', () => {
    const text = `a台𰻝👩‍👩‍👧\ud800x`;
    expect(countCodePoints(text)).toBe(10); // a 台 𰻝 👩 ZWJ 👩 ZWJ 👧, the lone surrogate, x
    expect(utf8ByteLength(text)).toBe(new TextEncoder().encode(text).length);
  });

  it('analyses the first 200,000 code points without splitting a surrogate pair', () => {
    expect(analysedText('abc', 2)).toBe('ab');
    expect(analysedText('𰻝𰻝𰻝', 2)).toBe('𰻝𰻝');
    expect(analysedText('short')).toBe('short');
  });
});

describe('errors (05 §12, 04 §5)', () => {
  const name = (id: TokenizerId): string => tokenizerEntry(id).displayName.en;
  const error = (code: UiError['code'], extra: Partial<UiError> = {}): UiError => ({
    code,
    message: 'm',
    retryable: false,
    tokenizer: 'google-gemma4',
    previous: 'openai-o200k_base',
    ...extra,
  });

  it('maps every code to its message and action', () => {
    expect(errorView(error('fetch'), name, 'openai-o200k_base')).toMatchObject({
      key: 'error.fetch',
      action: 'reload',
    });
    expect(errorView(error('fetch', { retryable: true }), name, 'openai-o200k_base')).toMatchObject({
      key: 'error.network',
      action: 'retry',
    });
    expect(errorView(error('integrity'), name, 'openai-o200k_base')).toMatchObject({
      key: 'error.integrity',
      action: 'retry',
    });
    expect(errorView(error('decompress'), name, 'openai-o200k_base').key).toBe('error.integrity');
    expect(errorView(error('format'), name, 'openai-o200k_base')).toMatchObject({
      key: 'error.fetch',
      action: 'reload',
    });
    expect(errorView(error('oom'), name, 'openai-o200k_base')).toEqual({
      key: 'error.oom',
      params: { name: 'Gemma 4 (Gemini 2.0 → 3.5)', fallback: name('openai-o200k_base') },
      action: 'back',
      informational: false,
    });
    expect(errorView(error('oom', { previous: null }), name, 'openai-cl100k_base').params['fallback']).toBe(
      name('openai-cl100k_base'),
    );
    // An out-of-memory tokenization on a loaded tokenizer: nothing to go back to, a shorter text helps.
    for (const phase of ['encode', 'run'] as const)
      expect(errorView(error('oom', { phase, previous: null }), name, 'openai-o200k_base')).toEqual({
        key: 'error.oomText',
        params: {},
        action: null,
        informational: false,
      });
    expect(errorView(error('oom', { phase: 'load' }), name, 'openai-o200k_base').action).toBe('back');
    expect(errorView(error('quota'), name, 'openai-o200k_base')).toMatchObject({ action: null, informational: true });
    for (const code of ['pretokenize', 'alignment'] as const)
      expect(errorView(error(code), name, 'openai-o200k_base')).toMatchObject({ key: 'error.engine', action: null });
    for (const code of ['not-loaded', 'internal'] as const)
      expect(errorView(error(code), name, 'openai-o200k_base')).toMatchObject({
        key: 'error.internal',
        action: 'retry',
      });
  });

  it('builds UiErrors from client rejections and recognises cancellation by its single name', () => {
    expect(toUiError({ code: 'oom', message: 'x', retryable: false }, 'google-gemma4', 'openai-o200k_base')).toEqual({
      code: 'oom',
      message: 'x',
      retryable: false,
      tokenizer: 'google-gemma4',
      previous: 'openai-o200k_base',
      phase: 'load',
    });
    expect(toUiError({ code: 'oom' }, 'xai-grok1', null, 'run')).toMatchObject({ code: 'oom', phase: 'run' });
    expect(toUiError(new Error('boom'), 'xai-grok1', 'xai-grok1')).toMatchObject({ code: 'internal', previous: null });
    expect(toUiError({ code: 'integrity' }, 'xai-grok1', null).retryable).toBe(true);
    expect(isCancelledError(Object.assign(new Error('x'), { name: 'cancelled' }))).toBe(true);
    expect(isCancelledError(new Error('boom'))).toBe(false);
  });
});

describe('PrecomputedExamples (AD-16)', () => {
  const files = { 'openai-cl100k_base': '/examples/cl100k.json' } as const;
  const wire = (): string => {
    const fixture = SHIPPING_FIXTURES.get('openai-cl100k_base');
    if (fixture === undefined) throw new Error('fixture');
    return JSON.stringify(
      toExamplesWire(
        fixture,
        'openai-cl100k_base',
        EXAMPLES.map((chip) => chip.fixtureCase),
      ),
    );
  };

  it('fetches a tokenizer’s examples once and answers every chip; free text and unexpressible options answer null', async () => {
    const fetched: string[] = [];
    const source = new PrecomputedExamples(files, [], (url) => {
      fetched.push(url);
      return Promise.resolve(new Response(wire()));
    });
    const entry = tokenizerEntry('openai-cl100k_base');
    const tainan = await source.find(entry, '台灣台南', DEFAULT_OPTIONS);
    expect(tainan?.stats.partialTokens).toBe(2);
    expect((await source.find(entry, '臺灣', DEFAULT_OPTIONS))?.tokenizer).toBe('openai-cl100k_base');
    expect(fetched).toEqual(['/examples/cl100k.json']);
    expect(await source.find(entry, 'free text', DEFAULT_OPTIONS)).toBeNull();
    expect(await source.find(entry, '台灣台南', { ...DEFAULT_OPTIONS, specialTokens: 'match' })).toBeNull();
    expect(await source.find(tokenizerEntry('xai-grok1'), '台灣台南', DEFAULT_OPTIONS)).toBeNull(); // no file
  });

  it('retries a failed fetch on the next lookup', async () => {
    let calls = 0;
    const source = new PrecomputedExamples(files, [], () => {
      calls++;
      return calls === 1 ? Promise.reject(new Error('offline')) : Promise.resolve(new Response(wire()));
    });
    const entry = tokenizerEntry('openai-cl100k_base');
    expect(await source.find(entry, '台灣台南', DEFAULT_OPTIONS)).toBeNull();
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(await source.find(entry, '台灣台南', DEFAULT_OPTIONS)).not.toBeNull();
    expect(calls).toBe(2);
  });
});

describe('load trigger (06 §3)', () => {
  /** A scripted environment: records the order of the steps. */
  function env(options: { loading?: boolean; lcp?: boolean }): { env: TriggerEnv; log: string[]; fire: () => void } {
    const log: string[] = [];
    const hooks: {
      dcl: (() => void) | null;
      observer: ((list: { getEntries(): readonly unknown[] }) => void) | null;
    } = { dcl: null, observer: null };
    const frames: Array<() => void> = [];
    const scripted: TriggerEnv = {
      document: {
        readyState: options.loading === true ? 'loading' : 'interactive',
        addEventListener: ((_type: string, listener: () => void) => {
          hooks.dcl = listener;
        }) as Document['addEventListener'],
        fonts: {
          get ready(): Promise<unknown> {
            log.push('fonts');
            return Promise.resolve();
          },
        },
      },
      requestAnimationFrame: (callback) => {
        frames.push(() => {
          log.push('frame');
          callback();
        });
        return frames.length;
      },
      PerformanceObserver: Object.assign(
        class {
          constructor(callback: (list: { getEntries(): readonly unknown[] }) => void) {
            hooks.observer = callback;
          }
          observe(): void {
            log.push('observe');
          }
          disconnect(): void {
            log.push('disconnect');
          }
        },
        { supportedEntryTypes: options.lcp === false ? [] : ['largest-contentful-paint', 'paint'] },
      ),
      setTimeout: (callback, ms) => {
        if (ms === PAINT_WAIT_CAP_MS) log.push('cap-armed');
        return 0;
      },
    };
    const fire = (): void => {
      if (hooks.dcl !== null) {
        log.push('dcl');
        const run = hooks.dcl;
        hooks.dcl = null;
        run();
      }
      if (hooks.observer !== null) {
        log.push('lcp');
        const run = hooks.observer;
        hooks.observer = null;
        run({ getEntries: () => [{}] });
      }
      while (frames.length > 0) frames.shift()?.();
    };
    return { env: scripted, log, fire };
  }

  it('waits for DOMContentLoaded, fonts, the first LCP entry and two frames, in that order', async () => {
    const { env: scripted, log, fire } = env({ loading: true });
    const state = { done: false };
    void afterFirstPaint(scripted).then(() => {
      state.done = true;
    });
    for (let i = 0; i < 6 && !state.done; i++) {
      await new Promise((resolve) => setTimeout(resolve, 0));
      fire();
    }
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(state.done).toBe(true);
    expect(log.filter((step) => step !== 'cap-armed' && step !== 'disconnect')).toEqual([
      'dcl',
      'fonts',
      'observe',
      'lcp',
      'frame',
      'frame',
    ]);
  });

  it('skips the paint step where the engine reports no paint timing, and resolves at once without a document', async () => {
    const { env: scripted, log, fire } = env({ lcp: false });
    const waiting = afterFirstPaint(scripted);
    await new Promise((resolve) => setTimeout(resolve, 0));
    fire();
    await new Promise((resolve) => setTimeout(resolve, 0));
    fire();
    await waiting;
    expect(log).not.toContain('observe');
    expect(log.filter((step) => step === 'frame')).toHaveLength(2);
    await expect(afterFirstPaint(null)).resolves.toBeUndefined();
  });
});
