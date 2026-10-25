/**
 * The live token tier adapter (05 §13): xAI token bytes → spans from cumulative byte lengths and flags by the board's
 * rules (checked against the Grok-2 golden fixture), boundary comparison on a crafted divergent response, the alignment
 * guard (matched/total on a misaligned concatenation), and the per-row fragments/cuts the board draws.
 */
import { describe, expect, it } from 'vitest';
import type { TokenizationResult } from '@tsbs/core';
import { fromFixtureCase } from '@tsbs/core/fixture/from-fixture-case';
import { packRows } from '@tsbs/core/layout/pack-rows';
import { DERIVED_FLAGS } from '@tsbs/core/model/flags';
import { TokenFlag } from '@tsbs/core/model/result';
import { SHIPPING_FIXTURES } from '../app/fixtures.test-helper.ts';
import { tokenizerEntry } from '../app/registry.ts';
import {
  alignLiveTokens,
  boundaryDiff,
  diffFor,
  rowCuts,
  rowFragments,
  tokenDiffers,
  type AlignedTier,
  type LiveToken,
} from './live-tier.ts';

const GROK2 = { id: 'xai-grok2', family: 'bytelevel-bpe' } as const;
const encoder = new TextEncoder();

function grok2(caseName: string): TokenizationResult {
  const fixture = SHIPPING_FIXTURES.get('xai-grok2');
  if (fixture === undefined) throw new Error('no Grok-2 fixture');
  return fromFixtureCase(fixture, caseName, tokenizerEntry('xai-grok2'));
}

/** Live tokens with the bytes of `result`'s tokens (an API answer identical to Grok-2). */
function sameAs(result: TokenizationResult): LiveToken[] {
  const tokens: LiveToken[] = [];
  for (let t = 0; t < result.tokens.count; t++) {
    const bytes = result.utf8.slice(result.tokens.byteStart[t], result.tokens.byteStart[t + 1]);
    tokens.push({ id: result.tokens.id[t] ?? 0, text: null, bytes });
  }
  return tokens;
}

/** Live tokens cutting `text`'s UTF-8 at the given byte offsets. */
function cutAt(text: string, cuts: readonly number[], firstId = 1000): LiveToken[] {
  const utf8 = encoder.encode(text);
  const edges = [0, ...cuts, utf8.length];
  return edges.slice(1).map((end, i) => ({ id: firstId + i, text: null, bytes: utf8.slice(edges[i], end) }));
}

function aligned(text: string, tokens: readonly LiveToken[]): AlignedTier {
  const alignment = alignLiveTokens(text, tokens, GROK2);
  if (!alignment.aligned) throw new Error('expected an aligned tier');
  return alignment;
}

describe('alignLiveTokens: spans and flags', () => {
  it('derives spans from cumulative byte lengths (台灣台南 on Grok-2: 15721 7489 291 15721 12048)', () => {
    const reference = grok2('zh-tw-tainan');
    const tier = aligned('台灣台南', sameAs(reference));
    expect(Array.from(tier.starts)).toEqual([0, 3, 5, 6, 9, 12]);
    expect(tier.total).toBe(12);
  });

  for (const caseName of ['zh-tw-tainan', 'ja-shibuya-ramen', 'emoji-family-zwj', 'en-contraction-code']) {
    it(`computes the board's derived flags for ${caseName} (partial, mid-char edges)`, () => {
      const reference = grok2(caseName);
      const tier = aligned(reference.input.text, sameAs(reference));
      expect(Array.from(tier.flags, (f) => f & DERIVED_FLAGS)).toEqual(
        Array.from(reference.tokens.flags, (f) => f & DERIVED_FLAGS),
      );
    });
  }

  it('marks 4242 (ー + 2 bytes of メ) partial and ending mid-character', () => {
    const reference = grok2('ja-shibuya-ramen');
    const tier = aligned(reference.input.text, sameAs(reference));
    const t = Array.from(reference.tokens.id).indexOf(4242);
    expect((tier.flags[t] ?? 0) & TokenFlag.Partial).toBe(TokenFlag.Partial);
    expect((tier.flags[t] ?? 0) & TokenFlag.EndsMidChar).toBe(TokenFlag.EndsMidChar);
    expect((tier.flags[t] ?? 0) & TokenFlag.StartsMidChar).toBe(0);
  });

  it('keeps an empty-bytes token (e.g. a BOS) aligned as a zero-width token', () => {
    const tokens: LiveToken[] = [{ id: 1, text: '<|bos|>', bytes: new Uint8Array(0) }, ...cutAt('ab', [1])];
    const tier = aligned('ab', tokens);
    expect(Array.from(tier.starts)).toEqual([0, 0, 1, 2]);
    expect((tier.flags[0] ?? 0) & TokenFlag.ZeroWidth).toBe(TokenFlag.ZeroWidth);
  });
});

describe('alignLiveTokens: the alignment guard', () => {
  it('reports matched/total when the concatenation differs from the text', () => {
    const tokens: LiveToken[] = [
      { id: 15721, text: '台', bytes: Uint8Array.of(0xe5, 0x8f, 0xb0) },
      { id: 9, text: '?', bytes: Uint8Array.of(0xe7, 0x81, 0xa4) }, // 灣 is E7 81 A3
      ...cutAt('台南', [3]),
    ];
    expect(alignLiveTokens('台灣台南', tokens, GROK2)).toEqual({ aligned: false, matched: 5, total: 12 });
  });

  it('is unaligned when token_bytes is missing (string_token only)', () => {
    const tokens: LiveToken[] = [{ id: 13902, text: 'Hello', bytes: null }];
    expect(alignLiveTokens('Hello', tokens, GROK2)).toEqual({ aligned: false, matched: 0, total: 5 });
  });

  it('is unaligned when the answer has extra or missing bytes', () => {
    expect(alignLiveTokens('ab', cutAt('abc', [1]), GROK2)).toEqual({ aligned: false, matched: 2, total: 2 });
    expect(alignLiveTokens('abc', cutAt('ab', [1]), GROK2)).toEqual({ aligned: false, matched: 2, total: 3 });
  });
});

describe('boundaryDiff', () => {
  it('finds no difference for an identical answer ("matches Grok-2")', () => {
    const reference = grok2('zh-tw-tainan');
    expect(boundaryDiff(aligned('台灣台南', sameAs(reference)), reference)).toEqual({ differing: [], union: 4 });
  });

  it('hatches exactly the boundaries one side lacks on a crafted divergent answer', () => {
    // Grok-2 boundaries 3 5 6 9; the crafted answer cuts at 3 6 (灣 whole, 台南 as one) and at 1 (inside 台).
    const reference = grok2('zh-tw-tainan');
    const tier = aligned('台灣台南', cutAt('台灣台南', [1, 3, 6]));
    const diff = boundaryDiff(tier, reference);
    expect(diff).toEqual({ differing: [1, 5, 9], union: 5 });
    if (diff === null) return;
    expect([0, 1, 2, 3].map((t) => tokenDiffers(tier, diff, t))).toEqual([true, true, true, true]);
    const two = aligned('台灣台南', cutAt('台灣台南', [3, 6]));
    const diffTwo = boundaryDiff(two, reference);
    expect(diffTwo).toEqual({ differing: [5, 9], union: 4 });
    if (diffTwo === null) return;
    expect([0, 1, 2].map((t) => tokenDiffers(two, diffTwo, t))).toEqual([false, true, true]);
  });

  it('refuses to compare results over different bytes, and memoises per (tier, result)', () => {
    const reference = grok2('zh-tw-tainan');
    expect(boundaryDiff(aligned('ab', cutAt('ab', [1])), reference)).toBeNull();
    const tier = aligned('台灣台南', sameAs(reference));
    expect(diffFor(tier, reference)).toBe(diffFor(tier, reference));
  });
});

describe('rowFragments and rowCuts', () => {
  it('splits live tokens at packed-row edges and places cuts at their byte columns (K = 4: one char per row)', () => {
    const reference = grok2('zh-tw-tainan');
    const rows = packRows(reference, 4);
    expect(rows.map((row) => [row.byteStart, row.byteEnd])).toEqual([
      [0, 3],
      [3, 6],
      [6, 9],
      [9, 12],
    ]);
    const tier = aligned('台灣台南', cutAt('台灣台南', [3, 6]));
    const diff = boundaryDiff(tier, reference);
    if (diff === null) throw new Error('expected a comparison');
    expect(rows.map((row) => rowFragments(row, tier))).toEqual([
      [{ token: 0, col: 0, span: 3, first: true, last: true }],
      [{ token: 1, col: 0, span: 3, first: true, last: true }],
      [{ token: 2, col: 0, span: 3, first: true, last: false }],
      [{ token: 2, col: 0, span: 3, first: false, last: true }],
    ]);
    expect(rows.map((row) => rowCuts(row, diff))).toEqual([
      [],
      [{ boundary: 5, col: 2 }],
      [],
      [{ boundary: 9, col: 0 }],
    ]);
  });

  it('places cuts inside a wider row (K = 8: two chars per row)', () => {
    const reference = grok2('zh-tw-tainan');
    const rows = packRows(reference, 8);
    const tier = aligned('台灣台南', cutAt('台灣台南', [3, 6]));
    const diff = boundaryDiff(tier, reference);
    if (diff === null) throw new Error('expected a comparison');
    expect(rows.map((row) => rowCuts(row, diff))).toEqual([[{ boundary: 5, col: 5 }], [{ boundary: 9, col: 3 }]]);
    const second = rows[1];
    if (second === undefined) throw new Error('expected two rows');
    expect(rowFragments(second, tier)).toEqual([{ token: 2, col: 0, span: 6, first: true, last: true }]);
  });

  it('gives a zero-width live token no column', () => {
    const tokens: LiveToken[] = [{ id: 1, text: null, bytes: new Uint8Array(0) }, ...cutAt('ab', [1])];
    const tier = aligned('ab', tokens);
    const reference = grok2('zh-tw-tainan');
    const [row] = packRows(reference, 8);
    if (row === undefined) throw new Error('no row');
    expect(
      rowFragments(
        {
          ...row,
          byteStart: 0,
          byteEnd: 2,
          bytes: [
            { col: 0, byte: 0 },
            { col: 1, byte: 1 },
          ],
        },
        tier,
      ),
    ).toEqual([
      { token: 1, col: 0, span: 1, first: true, last: true },
      { token: 2, col: 1, span: 1, first: true, last: true },
    ]);
  });
});
