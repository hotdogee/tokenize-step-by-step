/**
 * `buildResult` derivations and refusals, the invariant checker's negative cases, and the flag helpers (03 §B.2–B.3).
 */
import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import {
  analyzeText,
  assertInvariants,
  buildResult,
  checkInvariants,
  ChunkKind,
  flagsToWords,
  fromFixtureCase,
  InvariantError,
  TokenFlag,
  tokenKindName,
  TokenKind,
  type ResultInput,
  type TokenizationResult,
} from '../src/index.ts';
import { loadFixture, REFS } from './helpers/fixtures.ts';
import { RUNS } from './helpers/runs.ts';

function base(text: string, starts: number[], kinds?: number[]): ResultInput {
  const analysis = analyzeText(text);
  const n = analysis.utf8.length;
  return {
    tokenizer: 'openai-o200k_base',
    family: 'bytelevel-bpe',
    analysis,
    chunks: { byteStart: n > 0 ? [0, n] : [0], kind: n > 0 ? [ChunkKind.Regex] : [] },
    tokens: {
      id: starts.slice(0, -1).map((_, i) => i),
      byteStart: starts,
      kind: kinds ?? starts.slice(0, -1).map(() => 0),
    },
    timeline: null,
  };
}

describe('buildResult', () => {
  it('derives flags, chunk/char columns and stats', () => {
    const result = buildResult(base('台灣', [0, 3, 5, 6]));
    expect(Array.from(result.tokens.flags)).toEqual([
      0,
      TokenFlag.Partial | TokenFlag.EndsMidChar,
      TokenFlag.Partial | TokenFlag.StartsMidChar,
    ]);
    expect(Array.from(result.chars.tokenFirst)).toEqual([0, 1]);
    expect(Array.from(result.chars.tokenLast)).toEqual([0, 2]);
    expect(result.stats).toMatchObject({
      codePoints: 2,
      bytes: 6,
      tokens: 3,
      partialTokens: 2,
      splitChars: 1,
      mergeSteps: 0,
    });
    expect(result.options).toEqual({ specialTokens: 'as-text', addBos: false, normalize: 'none', trace: true });
    expect(Array.from(result.chunks.rule)).toEqual([255]);
    expect(checkInvariants(result)).toEqual([]);
  });

  it('ignores engine-supplied derived bits and adds the bits a kind implies', () => {
    const input = base('ab', [0, 1, 2], [TokenKind.Byte, TokenKind.UserDefined]);
    const result = buildResult({
      ...input,
      tokens: { ...input.tokens, flags: [TokenFlag.Partial, TokenFlag.DirectHit] },
    });
    expect(Array.from(result.tokens.flags)).toEqual([
      TokenFlag.ByteFallback,
      TokenFlag.UserDefined | TokenFlag.DirectHit,
    ]);
  });

  it('refuses spans that do not tile the bytes', () => {
    expect(() => buildResult(base('ab', [0, 1]))).toThrow(RangeError);
    expect(() => buildResult(base('ab', [0, 2, 1, 2]))).toThrow(RangeError);
    const crossing = base('ab', [0, 2]);
    expect(() => buildResult({ ...crossing, chunks: { byteStart: [0, 1, 2], kind: [0, 0] } })).toThrow(
      /crosses a chunk/,
    );
    expect(() => buildResult({ ...crossing, chunks: { byteStart: [0, 1], kind: [0] } })).toThrow(RangeError);
    const mid = base('台', [0, 3]);
    expect(() => buildResult({ ...mid, chunks: { byteStart: [0, 1, 3], kind: [0, 0] } })).toThrow(
      /inside a code point/,
    );
  });

  it('counts input code points separately when normalization changed the text', () => {
    const analysis = analyzeText('ダ');
    const result = buildResult({
      ...base('ダ', [0, 3]),
      analysis,
      inputText: 'ﾀﾞ',
      options: { normalize: 'NFKC' },
      normalization: { changed: true, sourceRunStart: Int32Array.of(0), sourceRunEnd: Int32Array.of(2) },
    });
    expect(result.input).toEqual({ text: 'ﾀﾞ', codePoints: 2, utf16Units: 2 });
    expect(result.normalization).toEqual({ form: 'NFKC', changed: true });
    expect(checkInvariants(result)).toEqual([]);
  });
});

describe('checkInvariants negative cases', () => {
  const sound = (): TokenizationResult =>
    fromFixtureCase(loadFixture('openai-cl100k_base'), 'zh-tw-tainan', REFS['openai-cl100k_base']);

  it('accepts a sound result and reports each corruption', () => {
    expect(checkInvariants(sound())).toEqual([]);
    const corrupt = (mutate: (r: TokenizationResult) => void): string[] => {
      const r = sound();
      mutate(r);
      return checkInvariants(r);
    };
    expect(corrupt((r) => (r.tokens.flags[1] = 0))).toContainEqual(expect.stringMatching(/Partial flag/));
    expect(corrupt((r) => (r.utf8[0] = 0x41))).toContainEqual('utf8 is not the UTF-8 of text');
    expect(corrupt((r) => (r.byteToToken[0] = 3))).toContainEqual(expect.stringMatching(/byteToToken/));
    expect(corrupt((r) => (r.chars.tokenLast[1] = 1))).toContainEqual(expect.stringMatching(/tokenFirst\/tokenLast/));
    expect(corrupt((r) => r.timeline?.boundaryDied.fill(-1))).toContainEqual(
      expect.stringMatching(/replay\(stepCount\)/),
    );
    expect(corrupt((r) => (r.tokens.chunk[0] = 5))).toContainEqual(expect.stringMatching(/chunk disagrees/));
    expect(corrupt((r) => (r.chunks.tokenStart[1] = 9))).toContainEqual(expect.stringMatching(/tokenStart sentinel/));
    expect(corrupt((r) => (r.graphemes.byteStart[1] = 2))).toContainEqual(expect.stringMatching(/graphemes.byteStart/));
    expect(() => {
      const r = sound();
      r.tokens.flags[0] = TokenFlag.ZeroWidth;
      assertInvariants(r);
    }).toThrow(InvariantError);
  });

  it('holds for arbitrary token cuts at code-point or byte boundaries', () => {
    fc.assert(
      fc.property(
        fc.string({ unit: 'grapheme', maxLength: 10 }),
        fc.array(fc.boolean(), { maxLength: 64 }),
        (text, cuts) => {
          const n = analyzeText(text).utf8.length;
          const starts = [0];
          for (let b = 1; b < n; b++) if (cuts[b % cuts.length] === true) starts.push(b);
          if (n > 0) starts.push(n);
          const result = buildResult(base(text, n > 0 ? starts : [0]));
          expect(checkInvariants(result)).toEqual([]);
        },
      ),
      { numRuns: RUNS },
    );
  });
});

describe('flag helpers', () => {
  it('spells flags and kinds', () => {
    expect(flagsToWords(TokenFlag.Partial | TokenFlag.DirectHit)).toEqual(['partial', 'direct-hit']);
    expect(flagsToWords(0)).toEqual([]);
    expect(tokenKindName(TokenKind.DummyPrefix)).toBe('DummyPrefix');
    expect(tokenKindName(99)).toBe('Unknown');
  });
});
