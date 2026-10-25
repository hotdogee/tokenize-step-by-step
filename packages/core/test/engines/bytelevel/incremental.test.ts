/**
 * Cooperative yielding (04 §1.3, AD-21) and the 06 §3 engine ceilings:
 * - `encode() ≡ encodeIncremental()` on every fixture case of the six tokenizers, also with a 0 ms budget (a yield every
 *   256 agenda pops and every 16 chunks), under `specialTokens: 'match'` and with `trace: false`;
 * - a 20k-CJK `encodeIncremental` yields ≥ 5 times with the default 4 ms slice, `bytesDone` never decreases;
 * - a cancel (the Worker stops pulling and calls `return()` at the next yield) is observed within one 4 ms slice;
 * - `TSBS_PERF=1`: 10k single-chunk CJK ≤ 15 ms, 20k ≤ 40 ms (median of warm runs, Node).
 */
import process from 'node:process';
import { firstDifference } from '@tsbs/conformance';
import { describe, expect, it } from 'vitest';
import type { EncodeOptions, TokenizationResult } from '../../../src/index.ts';
import type { ByteLevelTokenizer, EncodeProgress } from '../../../src/engines/bytelevel/engine.ts';
import { PERF_BUDGETS, time } from '../../helpers/perf.ts';
import { BYTELEVEL_IDS, cjkText, fixtureOf, SKIP_REASON, tokenizerFor } from './assets.ts';

/** Field-by-field equality, timings excluded (`@tsbs/conformance`'s typed-array-aware comparison). */
function same(a: TokenizationResult, b: TokenizationResult): void {
  expect(firstDifference(a, b)).toBeNull();
}

/** Drains `encodeIncremental`; returns the result and every yielded progress. */
function drain(
  tokenizer: ByteLevelTokenizer,
  text: string,
  options: Partial<EncodeOptions>,
  budgetMs?: number,
): { result: TokenizationResult; yields: EncodeProgress[] } {
  const gen = tokenizer.encodeIncremental(text, options, budgetMs);
  const yields: EncodeProgress[] = [];
  for (;;) {
    const next = gen.next();
    if (next.done === true) return { result: next.value, yields };
    yields.push(next.value);
  }
}

describe.skipIf(SKIP_REASON !== null)('encode ≡ encodeIncremental', () => {
  it.each(BYTELEVEL_IDS)('%s: every case, 0 ms and 4 ms budgets, as-text / match / untraced', (id) => {
    const fixture = fixtureOf(id);
    const tokenizer = tokenizerFor(id, { cacheBytes: 0 });
    const variants: ReadonlyArray<Partial<EncodeOptions>> = [{}, { specialTokens: 'match' }, { trace: false }];
    for (const c of fixture.cases) {
      for (const options of variants) {
        const expected = tokenizer.encode(c.text, options);
        same(drain(tokenizer, c.text, options, 0).result, expected);
        same(drain(tokenizer, c.text, options).result, expected);
      }
    }
    for (const c of fixture.normalizedNFKC ?? []) {
      const original = fixture.cases.find((x) => x.name === c.name)?.text ?? '';
      same(
        drain(tokenizer, original, { normalize: 'NFKC' }, 0).result,
        tokenizer.encode(original, { normalize: 'NFKC' }),
      );
    }
  });

  it('a 0 ms budget slices a long single-chunk text without changing it', () => {
    const o200k = tokenizerFor('openai-o200k_base');
    const text = cjkText(3000);
    const { result, yields } = drain(o200k, text, {}, 0);
    expect(yields.length).toBeGreaterThan(5);
    same(result, o200k.encode(text));
  });
});

describe.skipIf(SKIP_REASON !== null)('20k-CJK slicing and cancellation (4 ms budget)', () => {
  const o200k = tokenizerFor('openai-o200k_base');
  const text = cjkText(20_000);
  o200k.encode(text); // warm up (JIT)

  it('a single chunk of 60,000 bytes', () => {
    expect(o200k.pretokenize(text)).toEqual([[0, 60_000]]);
  });

  it('yields ≥ 5 times with monotone progress and returns the encode() result', () => {
    const { result, yields } = drain(o200k, text, {});
    expect(yields.length).toBeGreaterThanOrEqual(5);
    for (let i = 1; i < yields.length; i++) {
      expect(yields[i]?.bytesDone).toBeGreaterThanOrEqual(yields[i - 1]?.bytesDone ?? 0);
    }
    expect(yields.every((y) => y.bytesTotal === 60_000 && y.bytesDone <= 60_000)).toBe(true);
    same(result, o200k.encode(text));
    console.info(`[incremental] 20k CJK: ${String(yields.length)} yields with a 4 ms budget`);
  });

  it('observes a cancel within one slice: the next pull after the cancel returns within the budget', () => {
    const budgetMs = 4;
    const gen = o200k.encodeIncremental(text, {}, budgetMs);
    expect(gen.next().done).toBe(false); // first slice (analysis, pre-tokenization, heap seeding, first merges)
    let cancelled = false;
    const slices: number[] = [];
    for (let pulls = 0; ; pulls++) {
      if (pulls === 2) cancelled = true; // the Worker's `cancel` arrives between two slices
      if (cancelled) {
        const t0 = performance.now();
        expect(gen.return(undefined as never).done).toBe(true);
        slices.push(performance.now() - t0);
        break;
      }
      const t0 = performance.now();
      const next = gen.next();
      slices.push(performance.now() - t0);
      expect(next.done).toBe(false);
    }
    // every slice ends within one budget plus one 256-pop sampling batch; generous slack for shared CI runners
    const worst = Math.max(...slices);
    console.info(`[incremental] slice durations (ms): ${slices.map((s) => s.toFixed(2)).join(', ')}`);
    expect(worst).toBeLessThan(budgetMs + (PERF_BUDGETS ? 2 : 20));
    expect(gen.next().done).toBe(true);
  });
});

describe.runIf(PERF_BUDGETS && SKIP_REASON === null)('TSBS_PERF=1 engine ceilings (06 §3)', () => {
  it.each(BYTELEVEL_IDS)('%s: 10k single-chunk CJK ≤ 15 ms, 20k ≤ 40 ms', (id) => {
    const tokenizer = tokenizerFor(id);
    const ten = cjkText(10_000);
    const twenty = cjkText(20_000);
    expect(tokenizer.pretokenize(ten)).toHaveLength(1);
    for (let i = 0; i < 10; i++) tokenizer.encode(i % 2 === 0 ? ten : twenty); // let the JIT settle (time() warms once)
    const t10 = time(() => tokenizer.encode(ten), 21);
    const t20 = time(() => tokenizer.encode(twenty), 21);
    console.info(
      `[perf] ${id} (node ${process.version}): 10k CJK median ${t10.median.toFixed(2)} ms (cold ${t10.cold.toFixed(2)}), ` +
        `20k CJK median ${t20.median.toFixed(2)} ms (cold ${t20.cold.toFixed(2)})`,
    );
    expect(t10.median).toBeLessThanOrEqual(15);
    expect(t20.median).toBeLessThanOrEqual(40);
  });
});
