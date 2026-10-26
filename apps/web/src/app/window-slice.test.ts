import type { MergeTimeline, TokenizationResult, TokenizerId } from '@tsbs/core';
import { checkInvariants } from '@tsbs/core/model/invariants';
import { ALIVE, NEVER } from '@tsbs/core/model/result';
import { replay } from '@tsbs/core/timeline/replay';
import { describe, expect, it } from 'vitest';
import { caseResult } from '../board/fixture-results.test-helper.ts';
import {
  byteAtCaret,
  byteAtUtf16,
  isWindowEdge,
  sliceResult,
  snapWindow,
  windowAround,
  WINDOW_STEP,
} from './window-slice.ts';

const TOKENIZERS: readonly TokenizerId[] = [
  'openai-o200k_base',
  'openai-cl100k_base',
  'anthropic-claude-legacy',
  'google-gemma4',
  'google-gemma2',
  'meta-llama4-muse',
  'meta-llama3',
  'xai-grok2',
  'xai-grok1',
];
const PARAGRAPHS = ['zh-tw-paragraph', 'ja-paragraph', 'en-paragraph'] as const;

/** Tokens of `full` inside `[start, end)` (zero-width ones only at 0). */
function idsIn(full: TokenizationResult, start: number, end: number): number[] {
  const ids: number[] = [];
  for (let t = 0; t < full.tokens.count; t++) {
    const s = full.tokens.byteStart[t] ?? 0;
    const e = full.tokens.byteStart[t + 1] ?? 0;
    if (s >= start && e <= end && (s < end || start === end) && !(s === e && s !== start))
      ids.push(full.tokens.id[t] ?? 0);
  }
  return ids;
}

/** The engines' truncation semantics (03 §B.2), applied to a recorded timeline: keep the first `max` steps. */
function truncate(result: TokenizationResult, max: number): TokenizationResult {
  const timeline = result.timeline;
  if (timeline === null || timeline.stepCount <= max) return result;
  const born = timeline.boundaryBorn.map((v) => (v !== NEVER && v > max ? max : v));
  const died = timeline.boundaryDied.map((v) => (v !== ALIVE && v > max ? max : v));
  const truncated: MergeTimeline = {
    ...timeline,
    stepCount: max,
    boundaryBorn: born,
    boundaryDied: died,
    stepKind: timeline.stepKind.slice(0, max),
    stepLeft: timeline.stepLeft.slice(0, max),
    stepMid: timeline.stepMid.slice(0, max),
    stepEnd: timeline.stepEnd.slice(0, max),
    stepRank: timeline.stepRank.slice(0, max),
    stepResultId: timeline.stepResultId.slice(0, max),
    stepChunk: timeline.stepChunk.slice(0, max),
    truncated: true,
  };
  const stepFormed = result.tokens.stepFormed.map((v) => (v > max ? -1 : v));
  return {
    ...result,
    timeline: truncated,
    tokens: { ...result.tokens, stepFormed },
    stats: { ...result.stats, mergeSteps: max },
  };
}

describe('byteAtUtf16', () => {
  it('maps a UTF-16 caret to the byte offset of its code point', () => {
    const r = caseResult('openai-o200k_base', 'mixed-hello-taiwan-tokyo'); // "Hello 台灣! 東京タワー"
    expect(byteAtUtf16(r, 0)).toBe(0);
    expect(byteAtUtf16(r, 6)).toBe(6); // 台
    expect(byteAtUtf16(r, 7)).toBe(9); // 灣
    expect(byteAtUtf16(r, 999)).toBe(r.utf8.length);
    const emoji = caseResult('openai-o200k_base', 'emoji-family-zwj');
    expect(byteAtUtf16(emoji, 1)).toBe(0); // inside the first surrogate pair
    expect(byteAtUtf16(emoji, 2)).toBe(4);
  });
});

describe('byteAtCaret', () => {
  it('maps the caret in the typed text through the NFKC source map (… → ... shifts every later offset)', () => {
    // fuzz-074 starts "Fm3く%ゑ… 🐾l" as typed; NFKC turns the ellipsis into three full stops (every code point is its
    // own segment here).
    const r = caseResult('anthropic-claude-legacy', 'fuzz-074', { normalize: 'NFKC', nfkcSegmentStart: () => true });
    expect(r.text.startsWith('Fm3く%ゑ... 🐾l')).toBe(true);
    expect(byteAtCaret(r, 6)).toBe(10); // before …: its first full stop
    expect(byteAtCaret(r, 7)).toBe(13); // after …: the space after the three full stops
    expect(byteAtCaret(r, 10)).toBe(18); // after 🐾: l
    expect(byteAtUtf16(r, 10)).toBe(14); // the typed offset read in the normalized text falls back onto 🐾
    expect(byteAtCaret(r, 999)).toBe(r.utf8.length);
    // ﾀﾞ → ダ (2 → 1): a caret between the two typed code points lands on the composed one.
    const dakuten = caseResult('anthropic-claude-legacy', 'halfwidth-katakana-dakuten', { normalize: 'NFKC' });
    expect(byteAtCaret(dakuten, 1)).toBe(0);
    expect(byteAtCaret(dakuten, 2)).toBe(3);
    // Not normalized: the typed offsets are the result's.
    const plain = caseResult('openai-o200k_base', 'mixed-hello-taiwan-tokyo');
    for (const caret of [0, 6, 7, 999]) expect(byteAtCaret(plain, caret)).toBe(byteAtUtf16(plain, caret));
  });
});

describe('snapWindow / windowAround', () => {
  it('snaps outward to offsets that are token, code-point and grapheme boundaries', () => {
    const r = caseResult('openai-cl100k_base', 'zh-tw-tainan'); // 灣 = E7 81 | A3 splits mid-character
    expect(isWindowEdge(r, 5)).toBe(false); // the cut inside 灣
    expect(isWindowEdge(r, 4)).toBe(false); // inside 灣 and inside token 66285
    expect(isWindowEdge(r, 6)).toBe(true);
    expect(snapWindow(r, 4, 5)).toEqual({ start: 3, end: 6 });
    const family = caseResult('openai-o200k_base', 'emoji-family-zwj'); // one grapheme of 18 bytes
    expect(snapWindow(family, 4, 8)).toEqual({ start: 0, end: 18 });
  });

  it('is the whole result when it fits, and moves in steps otherwise', () => {
    const r = caseResult('openai-o200k_base', 'zh-tw-paragraph');
    expect(windowAround(r, 10, 1_000_000)).toEqual({ start: 0, end: r.utf8.length });
    const a = windowAround(r, 1000, 2000 > r.utf8.length ? 800 : 2000);
    const b = windowAround(r, 1000 + Math.min(WINDOW_STEP, 200) / 2 - 1, 2000 > r.utf8.length ? 800 : 2000);
    expect(b).toEqual(a);
    expect(a.end - a.start).toBeGreaterThanOrEqual(800);
    expect(isWindowEdge(r, a.start) && isWindowEdge(r, a.end)).toBe(true);
    const end = windowAround(r, r.utf8.length, 400);
    expect(end.end).toBe(r.utf8.length);
  });
});

describe('sliceResult', () => {
  it('returns the result itself for the whole range', () => {
    const r = caseResult('openai-o200k_base', 'zh-tw-tainan');
    expect(sliceResult(r, { start: 0, end: r.utf8.length })).toBe(r);
  });

  for (const tokenizer of TOKENIZERS) {
    it(`keeps the invariants and the whole-text ids in every window — ${tokenizer}`, () => {
      for (const name of PARAGRAPHS) {
        const full = caseResult(tokenizer, name);
        const n = full.utf8.length;
        for (const [at, size] of [
          [0, 120],
          [n / 3, 200],
          [n / 2, 97],
          [n, 150],
        ] as const) {
          const window = windowAround(full, Math.round(at), size);
          const slice = sliceResult(full, window);
          expect(checkInvariants(slice), `${name} @${String(at)}`).toEqual([]);
          expect([...slice.tokens.id], `${name} ids`).toEqual(idsIn(full, window.start, window.end));
          // The ids at both window edges are the whole-text tokens at those offsets.
          const first = full.byteToToken[window.start] ?? -1;
          const last = full.byteToToken[window.end - 1] ?? -1;
          if (window.start > 0) expect(slice.tokens.id[0]).toBe(full.tokens.id[first]);
          expect(slice.tokens.id[slice.tokens.count - 1]).toBe(full.tokens.id[last]);
          expect(slice.text).toBe(new TextDecoder().decode(full.utf8.subarray(window.start, window.end)));
        }
      }
    });
  }

  it('renumbers the merge timeline: every window step replays like its whole-text step', () => {
    const full = caseResult('openai-o200k_base', 'en-paragraph');
    const timeline = full.timeline;
    if (timeline === null) throw new Error('no timeline');
    const window = windowAround(full, 300, 200);
    const slice = sliceResult(full, window);
    const sliced = slice.timeline;
    if (sliced === null) throw new Error('no slice timeline');
    const kept: number[] = [];
    for (let k = 1; k <= timeline.stepCount; k++)
      if ((timeline.stepLeft[k - 1] ?? 0) >= window.start && (timeline.stepEnd[k - 1] ?? 0) <= window.end) kept.push(k);
    expect(sliced.stepCount).toBe(kept.length);
    expect(sliced.stepCount).toBeGreaterThan(5);
    for (const j of [0, 1, Math.floor(kept.length / 2), kept.length]) {
      const fullStep = j === 0 ? (kept[0] ?? 1) - 1 : (kept[j - 1] ?? 0);
      const inWindow = [...replay(timeline, fullStep)]
        .filter((b) => b >= window.start && b <= window.end)
        .map((b) => b - window.start);
      expect([...replay(sliced, j)], `step ${String(j)}`).toEqual(inWindow);
    }
    for (let t = 0; t < slice.tokens.count; t++) {
      const formed = slice.tokens.stepFormed[t] ?? -1;
      if (formed > 0) expect(sliced.stepResultId[formed - 1]).toBe(slice.tokens.id[t]);
    }
  });

  it('keeps truncated timelines sound: replay at the end still equals the window tokens', () => {
    const full = truncate(caseResult('openai-cl100k_base', 'zh-tw-paragraph'), 120);
    expect(checkInvariants(full)).toEqual([]);
    const slice = sliceResult(full, windowAround(full, full.utf8.length / 2, 300));
    expect(slice.timeline?.truncated).toBe(true);
    expect(checkInvariants(slice)).toEqual([]);
  });

  it('keeps zero-width leading tokens only in a window that starts at 0', () => {
    const full = caseResult('xai-grok1', 'zh-tw-paragraph', { addBos: true });
    expect(full.stats.zeroWidthTokens).toBeGreaterThan(0);
    const head = sliceResult(full, windowAround(full, 0, 200));
    expect(head.stats.zeroWidthTokens).toBe(full.stats.zeroWidthTokens);
    expect(checkInvariants(head)).toEqual([]);
    const middle = sliceResult(full, windowAround(full, full.utf8.length / 2, 200));
    expect(middle.stats.zeroWidthTokens).toBe(0);
    expect(middle.timeline).toBeNull(); // spm fixtures carry no steps
    expect(checkInvariants(middle)).toEqual([]);
  });
});
