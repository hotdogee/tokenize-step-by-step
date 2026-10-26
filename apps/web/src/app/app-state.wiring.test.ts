/**
 * The AppState controller's integration rules (WP13; 05 §1.1, §6, §12; AD-21, AD-27): sequence dropping, debounce
 * coalescing, the pending encode across a load, `cancelled` naming, focus persistence by byte offset, the precomputed →
 * live crossfade, the board's final / stale / text states, the long-input tiers and the URL state.
 */
import type { TokenizationResult } from '@tsbs/core';
import { CancelledError } from '@tsbs/core/model/cancelled';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { AppState, ENCODE_DEBOUNCE_MS } from './app-state.svelte.ts';
import { defaultResult } from './bootstrap.ts';
import { errorView } from './errors.ts';
import { FakeClient, flush, syntheticResult } from './fake-client.test-helper.ts';
import { ANALYSED_MAX, ON_DEMAND_MAX_STEPS, RELEASE_ABOVE_BYTES, resultBytes } from './long-input.ts';
import { NoPrecomputedResultError } from './no-precomputed.ts';
import type { PrecomputedSource } from './precomputed.ts';
import { DEFAULT_TOKENIZER, EXAMPLES, tokenizerEntry } from './registry.ts';
import { STORAGE_KEYS } from './storage.ts';

/**
 * Node's `gc()` (exposed at runtime with `--expose-gc`; `vm` hands out the function), so a `WeakRef` shows whether a
 * released result is still reachable from the app. Returns a collector that lets pending callbacks run first.
 */
function forcedGc(): () => Promise<void> {
  const { process } = globalThis as unknown as { process: { getBuiltinModule(id: string): unknown } };
  const v8 = process.getBuiltinModule('node:v8') as { setFlagsFromString(flags: string): void };
  const vm = process.getBuiltinModule('node:vm') as { runInNewContext(code: string): unknown };
  v8.setFlagsFromString('--expose-gc');
  const gc = vm.runInNewContext('gc') as () => void;
  return async () => {
    for (let i = 0; i < 3; i++) {
      await flush();
      gc();
    }
  };
}

/** An app whose o200k engine is loaded (resident) and whose first live encode is answered. */
async function loadedApp(client = new FakeClient(), source: PrecomputedSource | null = null): Promise<AppState> {
  const app = new AppState(client, defaultResult(), source);
  const start = app.start();
  await flush();
  client.loads.at(-1)?.finish();
  await start;
  await flush();
  client.encodes.at(-1)?.answer();
  await flush();
  return app;
}

describe('requests: seq, debounce, load, cancelled', () => {
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it('coalesces keystrokes inside the 40 ms debounce into one encode of the latest text', async () => {
    const client = new FakeClient();
    const app = await (async () => {
      vi.useRealTimers();
      const loaded = await loadedApp(client);
      vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
      return loaded;
    })();
    const before = client.encodes.length;
    app.setText('台');
    app.setText('台灣');
    vi.advanceTimersByTime(ENCODE_DEBOUNCE_MS - 1);
    app.setText('台灣台');
    expect(client.encodes.length).toBe(before);
    vi.advanceTimersByTime(ENCODE_DEBOUNCE_MS);
    expect(client.encodes.length).toBe(before + 1);
    expect(client.encodes.at(-1)?.text).toBe('台灣台');
  });

  it('drops an answer older than the latest request (latest text wins)', async () => {
    vi.useRealTimers();
    const client = new FakeClient();
    const app = await loadedApp(client);
    app.setText('first', true);
    const first = client.encodes.at(-1);
    app.setText('second', true);
    const second = client.encodes.at(-1);
    second?.answer();
    await flush();
    expect(app.currentResult?.input.text).toBe('second');
    // The superseded request was cancelled by the client; even a late answer is dropped.
    first?.resolve(syntheticResult('first', 'openai-o200k_base'));
    await flush();
    expect(app.result?.input.text).toBe('second');
    expect(app.error).toBeNull();
  });

  it('names a superseded or aborted encode `cancelled` and never shows it as an error', async () => {
    vi.useRealTimers();
    const client = new FakeClient();
    const app = await loadedApp(client);
    app.setText('abc', true);
    client.encodes.at(-1)?.reject(new CancelledError());
    await flush();
    expect(new CancelledError().name).toBe('cancelled');
    expect(app.error).toBeNull();
    app.setText('abcd', true);
    client.encodes
      .at(-1)
      ?.reject(Object.assign(new Error('regex did not tile'), { code: 'pretokenize', retryable: false }));
    await flush();
    expect(app.error).toMatchObject({ code: 'pretokenize', retryable: false, tokenizer: 'openai-o200k_base' });
  });

  it('keeps an encode asked for during a load pending and sends exactly one, for the latest text, after `loaded`', async () => {
    vi.useRealTimers();
    const client = new FakeClient();
    const app = new AppState(client, defaultResult());
    const start = app.start();
    await flush();
    expect(client.loads).toHaveLength(1);
    app.setText('typed while loading', true);
    app.setText('typed while loading, again', true);
    expect(client.encodes).toHaveLength(0); // nothing is sent before the engine is resident
    client.loads[0]?.finish();
    await start;
    await flush();
    expect(client.encodes).toHaveLength(1);
    expect(client.encodes[0]?.text).toBe('typed while loading, again');
    client.encodes[0]?.answer();
    await flush();
    expect(app.currentResult?.input.text).toBe('typed while loading, again');
    expect(app.resultSource).toBe('live');
  });
});

describe('the board: final, stale, text (PA-11, AD-19, 05 §12)', () => {
  it('renders once per keystroke on a loaded tokenizer: the last result stays (stale) until the new one arrives', async () => {
    const client = new FakeClient();
    const app = await loadedApp(client);
    const shown = app.board.result;
    expect(app.board.kind).toBe('final');
    app.setText('台灣台南!', true);
    expect(app.board).toMatchObject({ kind: 'stale' });
    expect(app.board.result).toBe(shown);
    client.encodes.at(-1)?.answer();
    await flush();
    expect(app.board.kind).toBe('final');
    expect(app.board.result.input.text).toBe('台灣台南!');
  });

  it('keeps the counts through keystrokes on the loaded tokenizer: never null, muted, not stale, until the result', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    try {
      const client = new FakeClient();
      const app = await (async () => {
        vi.useRealTimers();
        const loaded = await loadedApp(client);
        vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
        return loaded;
      })();
      const shown = app.result;
      expect(app.countsSuperseded).toBe(false);
      let text = app.text;
      for (const key of ['!', '台', 'a', ' ']) {
        text += key;
        app.setText(text);
        // Every keystroke inside the debounce and while the encode is in flight: the last result's counts stay.
        expect(app.tokenCounts).toBe(shown?.stats);
        expect(app.countsSuperseded).toBe(true);
        expect(app.resultStale).toBe(false);
        vi.advanceTimersByTime(ENCODE_DEBOUNCE_MS / 2);
        expect(app.tokenCounts).toBe(shown?.stats);
      }
      vi.advanceTimersByTime(ENCODE_DEBOUNCE_MS);
      expect(client.encodes.at(-1)?.text).toBe(text);
      expect(app.tokenCounts).toBe(shown?.stats);
      vi.useRealTimers(); // `flush` waits on a real timer
      client.encodes.at(-1)?.answer();
      await flush();
      expect(app.tokenCounts).toBe(app.result?.stats);
      expect(app.result?.input.text).toBe(text);
      expect(app.countsSuperseded).toBe(false);
      expect(app.resultStale).toBe(false);
    } finally {
      vi.useRealTimers();
    }
  });

  it('waits for the tokenizer (no counts) on another tokenizer, other options, or a text the mock cannot answer', async () => {
    const client = new FakeClient();
    const app = await loadedApp(client);
    app.setOption('specialTokens', app.options.specialTokens === 'match' ? 'as-text' : 'match');
    expect(app.tokenCounts).toBeNull(); // the last result answers other token options
    client.encodes.at(-1)?.answer();
    await flush();
    expect(app.tokenCounts).not.toBeNull();
    app.setText('not an example', true);
    client.encodes.at(-1)?.reject(new NoPrecomputedResultError('no precomputed result'));
    await flush();
    expect(app.tokenCounts).toBeNull(); // ?mock=1: no answer is on its way
    expect(app.board.kind).toBe('text');
    expect(app.error).toBeNull();
  });

  it('shows the text-only board while no tokenizer is loaded for the text, and while an IME composition is open', async () => {
    const client = new FakeClient();
    const app = new AppState(client, defaultResult());
    app.setText('typed before load');
    expect(app.board.kind).toBe('text');
    expect(app.board.result.tokens.count).toBe(0);
    const loaded = await loadedApp(client);
    loaded.composing = true;
    loaded.setText('こん');
    expect(loaded.board.kind).toBe('text');
    expect(loaded.board.result.input.text).toBe('こん');
  });

  it('keeps the last result’s counts, marked stale, while an IME composition is open (05 §6)', async () => {
    const client = new FakeClient();
    const app = await loadedApp(client);
    const shown = app.result;
    const before = client.encodes.length;
    app.composing = true;
    app.setText('台灣台南こ');
    expect(client.encodes.length).toBe(before); // the provisional text is not encoded
    expect(app.tokenCounts).toBe(shown?.stats);
    expect(app.resultStale).toBe(true);
    // The commit is encoded; its answer is current, not stale.
    app.composing = false;
    app.setText('台灣台南こ', true);
    client.encodes.at(-1)?.answer();
    await flush();
    expect(app.tokenCounts?.tokens).toBe(5);
    expect(app.resultStale).toBe(false);
  });

  it('keeps the last result through a tokenizer switch until the new engine answers (strict one-resident)', async () => {
    const client = new FakeClient();
    const app = await loadedApp(client);
    const before = app.board.result;
    const switching = app.selectTokenizer('openai-cl100k_base');
    await flush();
    expect(client.unloads).toBe(1);
    expect(app.board).toMatchObject({ kind: 'stale' });
    expect(app.board.result).toBe(before);
    client.loads.at(-1)?.finish();
    await switching;
    await flush();
    client.encodes.at(-1)?.answer();
    await flush();
    expect(app.board.kind).toBe('final');
    expect(app.board.result.tokenizer).toBe('openai-cl100k_base');
  });
});

describe('focus persistence (AD-17)', () => {
  it('keeps the focus and pin byte offsets across re-tokenization and a switch, clamped to a shorter text', async () => {
    const client = new FakeClient();
    const app = await loadedApp(client);
    app.focus = { tier: 'token', byte: 9 };
    app.pinned = { byte: 6, tier: 'byte' };
    app.setText('台灣台南台南', true);
    client.encodes.at(-1)?.answer();
    await flush();
    expect(app.focus).toEqual({ tier: 'token', byte: 9 });
    const switching = app.selectTokenizer('google-gemma4');
    await flush();
    client.loads.at(-1)?.finish();
    await switching;
    await flush();
    client.encodes.at(-1)?.answer();
    await flush();
    expect(app.focus).toEqual({ tier: 'token', byte: 9 });
    app.setText('台灣', true); // 6 bytes
    client.encodes.at(-1)?.answer();
    await flush();
    expect(app.focus).toEqual({ tier: 'token', byte: 5 });
    expect(app.pinned).toEqual({ byte: 5, tier: 'byte' });
  });
});

describe('precomputed → live (AD-16, 05 §12)', () => {
  it('answers an example chip from the precomputed examples while loading, then crossfades to the live result once', async () => {
    const chip = EXAMPLES.find((c) => c.key === 'ja-text');
    if (chip === undefined) throw new Error('chip');
    const source: PrecomputedSource = {
      find: (ref, text) => Promise.resolve(text === chip.text ? syntheticResult(text, ref.id) : null),
    };
    const client = new FakeClient();
    const app = new AppState(client, defaultResult(), source);
    const swaps: number[] = [];
    app.setResultTransition((update) => {
      swaps.push(1);
      update();
      return Promise.resolve();
    });
    const start = app.start();
    await flush();
    app.chooseExample(chip);
    await flush();
    expect(app.resultSource).toBe('precomputed');
    expect(app.currentResult?.input.text).toBe(chip.text);
    expect(swaps).toHaveLength(0);
    client.loads[0]?.finish();
    await start;
    await flush();
    client.encodes.at(-1)?.answer();
    await flush();
    expect(app.resultSource).toBe('live');
    expect(swaps).toHaveLength(1);
    // Later keystrokes do not crossfade.
    app.setText('日本語', true);
    client.encodes.at(-1)?.answer();
    await flush();
    expect(swaps).toHaveLength(1);
  });

  it('releases the previous result and skips the crossfade for a result above 8 MB', async () => {
    const client = new FakeClient();
    const app = await loadedApp(client);
    let swaps = 0;
    app.setResultTransition((update) => {
      swaps++;
      update();
      return Promise.resolve();
    });
    const big = syntheticResult('台'.repeat(150_000), 'openai-cl100k_base');
    expect(resultBytes(big)).toBeGreaterThan(RELEASE_ABOVE_BYTES);
    const switching = app.selectTokenizer('openai-cl100k_base');
    await flush();
    client.loads.at(-1)?.finish();
    await switching;
    await flush();
    client.encodes.at(-1)?.resolve(big);
    await flush();
    expect(swaps).toBe(0);
    expect(app.result).toBe(big);
  });

  it('leaves no reference to a released result: before a big run and once the text leaves the on-demand tiers', async () => {
    const collect = forcedGc();
    const client = new FakeClient();
    const app = await loadedApp(client);
    /** Answers the latest encode with a fresh result of its text; only a weak reference to it is kept. */
    const answerWeakly = (): WeakRef<TokenizationResult> => {
      const call = client.encodes.at(-1);
      if (call === undefined) throw new Error('no encode');
      const result = syntheticResult(call.text, 'openai-o200k_base', call.options);
      call.resolve(result);
      return new WeakRef(result);
    };
    /** The fake client keeps every call (and its settled promise): drop all but the one in flight. */
    const forgetSettled = (): void => {
      client.encodes.splice(0, client.encodes.length - 1);
    };

    // A whole-text run on screen as a window (its slice cache refers to the whole result).
    app.setText('e'.repeat(30_000), true);
    const first = app.runOnDemand();
    const firstRef = answerWeakly();
    await first;
    await app.slicerReady();
    expect(app.board.window).not.toBeNull();
    // A run whose result may exceed 8 MB releases the previous one before the Worker answers; the counts stay.
    app.setText('台'.repeat(150_000), true);
    const second = app.runOnDemand();
    expect(app.result).toBeNull();
    expect(app.tokenCounts?.tokens).toBe(30_000);
    expect(app.resultStale).toBe(true);
    forgetSettled();
    await collect();
    expect(firstRef.deref(), 'the previous run is unreachable while the next one is in flight').toBeUndefined();

    const secondRef = answerWeakly();
    await second;
    expect(app.board.window).not.toBeNull();
    // Back to a short text: the whole-text run goes, and the short live result never keeps it alive.
    app.setText('短文', true);
    client.encodes.at(-1)?.answer();
    await flush();
    expect(app.board.kind).toBe('final');
    expect(app.tokenCounts?.tokens).toBe(2);
    forgetSettled();
    await collect();
    expect(secondRef.deref(), 'the whole-text run is unreachable after a short text').toBeUndefined();
  });
});

describe('long input tiers (AD-27)', () => {
  it('pauses live tokenization above 20,000 code points and runs the whole text on demand with maxSteps 50,000', async () => {
    const client = new FakeClient();
    const app = await loadedApp(client);
    const before = client.encodes.length;
    const text = 'a'.repeat(20_001);
    app.setText(text, true);
    expect(app.longInput).toBe('on-demand');
    expect(client.encodes.length).toBe(before);
    expect(app.board.kind).toBe('text');
    const run = app.runOnDemand();
    expect(app.running).toBe(true);
    const call = client.encodes.at(-1);
    expect(call?.text).toBe(text);
    expect(call?.options.trace).toEqual({ maxSteps: ON_DEMAND_MAX_STEPS });
    call?.answer();
    await run;
    await app.slicerReady();
    expect(app.running).toBe(false);
    expect(app.board.kind).toBe('final');
    expect(app.board.window).not.toBeNull();
    expect(app.board.result.utf8.length).toBeLessThanOrEqual(2000);
    // A caret move inside the same window keeps the same slice (no board re-render); a far one moves the window.
    const slice = app.board.result;
    app.setCaret(app.caret + 1);
    expect(app.board.result).toBe(slice);
    app.setCaret(10_000);
    expect(app.board.window?.start).toBeGreaterThan(8000);
    expect(app.board.result).not.toBe(slice);
    expect(app.tokenCounts?.tokens).toBe(20_001);
    expect(app.resultStale).toBe(false);
    // An edit makes the tokens stale; the counts keep the last run's values.
    app.setText(`${text}b`);
    expect(app.resultStale).toBe(true);
    expect(app.tokenCounts?.tokens).toBe(20_001);
    expect(app.board.kind).toBe('text');
  });

  it('says the tokens wait for "Tokenize now" until a run on this tokenizer and options; an edit during a run is stale', async () => {
    const client = new FakeClient();
    const app = await loadedApp(client);
    const text = 'f'.repeat(25_000);
    app.setText(text, true);
    expect(app.awaitingRun).toBe(true);
    const run = app.runOnDemand();
    expect(app.awaitingRun).toBe(false); // in flight: the counts wait for the tokenizer
    app.setText(`${text}g`); // typed while the run is in flight
    client.encodes.at(-1)?.answer();
    await run;
    expect(app.awaitingRun).toBe(false);
    expect(app.tokenCounts?.tokens).toBe(25_000);
    expect(app.resultStale).toBe(true);
    void app.selectTokenizer('openai-cl100k_base');
    expect(app.tokenCounts).toBeNull();
    expect(app.awaitingRun).toBe(true);
  });

  it('keeps the tokens stale through a tokenizer switch and back while the text differs from the run’s', async () => {
    const client = new FakeClient();
    const app = await loadedApp(client);
    const text = 'k'.repeat(27_000);
    app.setText(text, true);
    const run = app.runOnDemand();
    client.encodes.at(-1)?.answer();
    await run;
    expect(app.resultStale).toBe(false);
    app.setText(`${text}l`);
    expect(app.resultStale).toBe(true);
    const away = app.selectTokenizer('openai-cl100k_base');
    await flush();
    client.loads.at(-1)?.finish();
    await away;
    expect(app.tokenCounts).toBeNull(); // no run on cl100k
    expect(app.awaitingRun).toBe(true);
    const back = app.selectTokenizer('openai-o200k_base');
    await flush();
    client.loads.at(-1)?.finish();
    await back;
    expect(app.tokenCounts?.tokens).toBe(27_000); // the o200k run's tokens are back…
    expect(app.resultStale).toBe(true); // …and still not the text's
    app.setText(text); // the run's text again
    expect(app.resultStale).toBe(false);
  });

  it('shows the run again, not stale, after a token option is toggled and back on the same text', async () => {
    const client = new FakeClient();
    const app = await loadedApp(client);
    app.setText('m'.repeat(26_000), true);
    const run = app.runOnDemand();
    client.encodes.at(-1)?.answer();
    await run;
    const before = client.encodes.length;
    app.setOption('specialTokens', 'match');
    expect(app.tokenCounts).toBeNull(); // the run answers other options: the tokens wait for the button
    expect(app.awaitingRun).toBe(true);
    app.setOption('specialTokens', 'as-text');
    expect(app.tokenCounts?.tokens).toBe(26_000);
    expect(app.resultStale).toBe(false);
    expect(client.encodes.length).toBe(before); // an on-demand tier encodes nothing on a toggle
  });

  it('runs without a timeline above 100,000 code points and analyses only the first 200,000 beyond that', async () => {
    const client = new FakeClient();
    const app = await loadedApp(client);
    app.setText('b'.repeat(100_001), true);
    void app.runOnDemand();
    expect(client.encodes.at(-1)?.options.trace).toBe(false);
    const capped = `${'c'.repeat(ANALYSED_MAX)}d`;
    app.setText(capped, true);
    expect(app.longInput).toBe('capped');
    expect(app.text).toBe(capped); // never truncated in the textarea
    void app.runOnDemand();
    expect(client.encodes.at(-1)?.text).toHaveLength(ANALYSED_MAX);
  });

  it('runs the on-demand request after the load when the tokenizer is not resident yet', async () => {
    const client = new FakeClient();
    const app = new AppState(client, defaultResult());
    app.setText('e'.repeat(30_000));
    void app.runOnDemand();
    await flush();
    expect(client.encodes).toHaveLength(0);
    client.loads[0]?.finish();
    await flush();
    await flush();
    expect(client.encodes.at(-1)?.text).toHaveLength(30_000);
  });

  it('drops a run asked for during a load once the text is short again: the load encodes the short text', async () => {
    const client = new FakeClient();
    const app = new AppState(client, defaultResult());
    app.setText('e'.repeat(30_000));
    const run = app.runOnDemand();
    await flush();
    expect(client.loads).toHaveLength(1);
    expect(app.running).toBe(true);
    app.setText('abc', true);
    expect(app.running).toBe(false);
    client.loads[0]?.finish();
    await run;
    await flush();
    expect(client.encodes.map((call) => call.text)).toEqual(['abc']);
    expect(app.running).toBe(false);
    client.encodes[0]?.answer();
    await flush();
    expect(app.currentResult?.input.text).toBe('abc');
    expect(app.tokenCounts?.tokens).toBe(3);
    // A long text again waits for "Tokenize now" (not a stuck "tokenizing"), and the button runs it.
    app.setText('f'.repeat(30_000), true);
    expect(app.running).toBe(false);
    expect(app.awaitingRun).toBe(true);
    void app.runOnDemand();
    expect(client.encodes.at(-1)?.text).toHaveLength(30_000);
  });

  it('drops the answer of a run in flight once the text is short again', async () => {
    const client = new FakeClient();
    const app = await loadedApp(client);
    const long = 'g'.repeat(30_000);
    app.setText(long, true);
    const run = app.runOnDemand();
    const call = client.encodes.at(-1);
    app.setText('短'); // debounced: the run answers before the short text's encode is sent
    expect(app.running).toBe(false);
    call?.answer();
    await run;
    expect(app.result?.input.text).not.toBe(long);
    expect(app.tokenCounts).toBeNull(); // the short text's tokens wait for its own encode
    expect(app.running).toBe(false);
  });

  it('announces each long-input tier once in the status region (the banner is lazy-mounted)', async () => {
    const app = await loadedApp();
    app.setText('a'.repeat(20_001));
    expect(app.status).toBe('Long input — tokenize on demand');
    app.status = '';
    app.setText('a'.repeat(20_002));
    expect(app.status).toBe(''); // same tier: nothing new to say
    app.setText('a'.repeat(ANALYSED_MAX + 1));
    expect(app.status).toBe('Only the first 200,000 code points are analysed');
    app.setText('short');
    app.setText('a'.repeat(ANALYSED_MAX + 2));
    expect(app.status).toBe('Long input — tokenize on demand Only the first 200,000 code points are analysed');
  });
});

describe('error recovery (05 §12)', () => {
  const failure = (code: string): Error => Object.assign(new Error(code), { code });
  const name = (id: Parameters<typeof tokenizerEntry>[0]): string => tokenizerEntry(id).displayName.en;

  it('retries a failed on-demand run with the run itself, reloading the tokenizer first when it is gone', async () => {
    const client = new FakeClient();
    const app = await loadedApp(client);
    const long = 'h'.repeat(30_000);
    app.setText(long, true);
    const run = app.runOnDemand();
    client.encodes.at(-1)?.reject(failure('internal'));
    await run;
    expect(app.error).toMatchObject({ code: 'internal', phase: 'run' });
    expect(app.running).toBe(false);
    const retry = app.recover();
    expect(client.encodes.at(-1)?.text).toBe(long);
    client.encodes.at(-1)?.answer();
    await retry;
    expect(app.tokenCounts?.tokens).toBe(30_000);

    // The engine went away (a Worker respawn): Retry reloads it, then runs again.
    const again = app.runOnDemand();
    client.setResident(null);
    client.encodes.at(-1)?.reject(failure('not-loaded'));
    await again;
    expect(app.error).toMatchObject({ code: 'not-loaded', phase: 'run' });
    const sent = client.encodes.length;
    const reload = app.recover();
    await flush();
    expect(client.loads).toHaveLength(2);
    expect(client.encodes).toHaveLength(sent);
    client.loads[1]?.finish();
    await reload;
    expect(client.encodes).toHaveLength(sent + 1);
    expect(client.encodes.at(-1)?.text).toBe(long);
    expect(app.running).toBe(true);
  });

  it('offers no "back" for an out-of-memory tokenization, and its recovery switches nothing', async () => {
    const client = new FakeClient();
    const app = await loadedApp(client);
    app.setText('i'.repeat(30_000), true);
    const run = app.runOnDemand();
    client.encodes.at(-1)?.reject(failure('oom'));
    await run;
    const error = app.error;
    expect(error).toMatchObject({ code: 'oom', phase: 'run', previous: null });
    if (error === null) throw new Error('no error');
    expect(errorView(error, name, DEFAULT_TOKENIZER)).toMatchObject({ key: 'error.oomText', action: null });
    await app.recover();
    expect(client.unloads).toBe(0);
    expect(client.loads).toHaveLength(1);
    expect(app.tokenizer).toBe(DEFAULT_TOKENIZER);
  });

  it('runs a run asked for before a failed load once Retry loads the tokenizer', async () => {
    const client = new FakeClient();
    const app = new AppState(client, defaultResult());
    app.setText('j'.repeat(30_000));
    const run = app.runOnDemand();
    await flush();
    client.loads[0]?.reject(Object.assign(new Error('offline'), { code: 'fetch', retryable: true }));
    await run;
    expect(app.error).toMatchObject({ code: 'fetch', retryable: true });
    expect(app.running).toBe(false);
    const retry = app.recover();
    await flush();
    client.loads[1]?.finish();
    await retry;
    expect(client.encodes.at(-1)?.text).toHaveLength(30_000);
  });

  it('loads again when "Tokenize now" is pressed after a failed load was dismissed', async () => {
    const client = new FakeClient();
    const app = new AppState(client, defaultResult());
    const start = app.start();
    await flush();
    client.loads[0]?.reject(failure('internal'));
    await start;
    app.dismissError();
    app.setText('k'.repeat(30_000));
    const run = app.runOnDemand();
    expect(app.running).toBe(true);
    expect(client.loads).toHaveLength(2);
    client.loads[1]?.finish();
    await run;
    expect(client.encodes.at(-1)?.text).toHaveLength(30_000);
  });

  it('says once per session that the offline cache is unavailable when the Worker has no Cache API (quota)', async () => {
    sessionStorage.removeItem(STORAGE_KEYS.cacheNotice);
    const app = await loadedApp(new FakeClient({ cacheApi: false }));
    await flush();
    const error = app.error;
    expect(error).toMatchObject({ code: 'quota', tokenizer: 'openai-o200k_base' });
    if (error === null) throw new Error('no error');
    expect(errorView(error, name, DEFAULT_TOKENIZER)).toMatchObject({ action: null, informational: true });
    const next = await loadedApp(new FakeClient({ cacheApi: false }));
    await flush();
    expect(next.error).toBeNull();
    sessionStorage.removeItem(STORAGE_KEYS.cacheNotice);
    expect((await loadedApp()).error).toBeNull(); // a working cache says nothing
  });
});

describe('URL state (05 §1.1)', () => {
  it('applies a deep link and re-applies its merge step when the live result arrives', async () => {
    const client = new FakeClient();
    const app = new AppState(client, defaultResult(), null, {
      tokenizer: 'openai-cl100k_base',
      text: '熱鬧',
      stage: 5,
      step: 3,
      byteView: 'dec',
      textLang: 'zh-Hant',
    });
    expect(app.tokenizer).toBe('openai-cl100k_base');
    expect(app.text).toBe('熱鬧');
    expect(app.result).toBeNull(); // the inlined default example answers only the default text on o200k
    expect([app.stage, app.step, app.byteView, app.textLang]).toEqual([5, 3, 'dec', 'zh-Hant']);
    app.step = 0; // e.g. the rail clamping to a precomputed result without a timeline
    const start = app.start();
    await flush();
    client.loads[0]?.finish();
    await start;
    await flush();
    const answer = syntheticResult('熱鬧', 'openai-cl100k_base');
    client.encodes.at(-1)?.resolve({
      ...answer,
      timeline: {
        stepCount: 4,
        leadingZeroWidthPart: false,
        boundaryBorn: new Int32Array(answer.utf8.length + 1),
        boundaryDied: new Int32Array(answer.utf8.length + 1).fill(-1),
        stepKind: new Uint8Array(4),
        stepLeft: new Uint32Array(4),
        stepMid: new Uint32Array(4),
        stepEnd: new Uint32Array(4),
        stepRank: new Float32Array(4),
        stepResultId: new Int32Array(4),
        stepChunk: new Uint32Array(4),
        truncated: false,
      },
    });
    await flush();
    expect(app.step).toBe(3);
  });

  it('takes a chip’s text language for a chip text and auto for free text', () => {
    const chip = EXAMPLES.find((c) => c.key === 'ja-shibuya-ramen');
    expect(new AppState(new FakeClient(), null, null, { text: chip?.text ?? '' }).textLang).toBe('ja');
    expect(new AppState(new FakeClient(), null, null, { text: 'free text' }).textLang).toBe('auto');
  });
});
