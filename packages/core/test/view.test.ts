/**
 * `TokenizationView` accessors (03 §B.2): charAt, tokenAt, tokensAtByte, charsOfToken, partsAt (cached cursor; ids;
 * justMerged; SpecialString folding) and stepSentence.
 */
import { describe, expect, it } from 'vitest';
import {
  analyzeText,
  buildResult,
  ChunkKind,
  fixturePieceOf,
  fromFixtureCase,
  TimelineRecorder,
  TokenFlag,
  TokenizationView,
  TokenKind,
} from '../src/index.ts';
import { loadFixture, REFS, spmFixture } from './helpers/fixtures.ts';

const cl100k = () => fromFixtureCase(loadFixture('openai-cl100k_base'), 'zh-tw-tainan', REFS['openai-cl100k_base']);

describe('charAt', () => {
  it('describes a split char (灣 on cl100k)', () => {
    const view = new TokenizationView(cl100k(), { lang: 'zh-Hant-TW' });
    expect(view.charAt(1)).toEqual({
      index: 1,
      cp: 0x7063,
      hex: 'U+7063',
      byteStart: 3,
      byteEnd: 6,
      utf16Start: 1,
      utf16End: 2,
      grapheme: 1,
      chunk: 0,
      tokenFirst: 1,
      tokenLast: 2,
      split: true,
      standIn: null,
      combining: false,
      lang: 'zh-Hant-TW',
      sourceRun: null,
    });
    expect(view.charAt(0).split).toBe(false);
    expect(() => view.charAt(4)).toThrow(RangeError);
  });

  it('reports stand-ins, combining marks and unpaired surrogates', () => {
    const marks = new TokenizationView(
      fromFixtureCase(loadFixture('openai-o200k_base'), 'katakana-decomposed', REFS['openai-o200k_base']),
    );
    const combining = Array.from({ length: marks.result.chars.count }, (_, i) => marks.charAt(i)).filter(
      (c) => c.combining,
    );
    expect(combining.map((c) => c.hex)).toContain('U+3099');
    const ws = new TokenizationView(
      fromFixtureCase(loadFixture('openai-o200k_base'), 'tab-between', REFS['openai-o200k_base']),
    );
    expect(Array.from({ length: ws.result.chars.count }, (_, i) => ws.charAt(i).standIn)).toContain('tab');
    const analysis = analyzeText('a\ud800');
    const lone = new TokenizationView(
      buildResult({
        tokenizer: 'openai-o200k_base',
        family: 'bytelevel-bpe',
        analysis,
        chunks: { byteStart: [0, 4], kind: [ChunkKind.Regex] },
        tokens: { id: [1, 2], byteStart: [0, 1, 4], kind: [0, 0] },
        timeline: null,
      }),
    );
    expect(lone.charAt(1).cp).toBe(0xfffd);
    expect(lone.isUnpairedSurrogate(1)).toBe(true);
    expect(lone.isUnpairedSurrogate(0)).toBe(false);
  });
});

describe('tokenAt, tokensAtByte, charsOfToken', () => {
  it('describes partial tokens with bytes, hex, dec and the completes relation', () => {
    const view = new TokenizationView(cl100k());
    const t = view.tokenAt(1);
    expect(t).toMatchObject({
      index: 1,
      id: 66285,
      byteStart: 3,
      byteEnd: 5,
      hex: ['E7', '81'],
      dec: [0xe7, 0x81],
      text: null,
      piece: null,
      kind: TokenKind.Normal,
      completes: 'starts',
      missingBytes: 1,
      charFirst: 1,
      charLast: 1,
      chunk: 0,
      stepFormed: 7,
      zeroWidth: false,
      partial: true,
    });
    expect(Array.from(t.bytes)).toEqual([0xe7, 0x81]);
    expect(t.flagsAsWords).toEqual(['partial', 'ends-mid-char']);
    expect(view.tokenAt(0)).toMatchObject({ text: '台', completes: 'full', missingBytes: 0 });
    expect(view.tokensAtByte(4)).toEqual([1]);
    expect(view.tokensAtByte(12)).toEqual([]);
    expect(view.charsOfToken(1)).toEqual([1]);
  });

  it('marks the middle byte of a shattered char as inside (Grok-1 灣)', () => {
    const fixture = spmFixture('xai-grok1');
    const view = new TokenizationView(fromFixtureCase(fixture, 'zh-tw-tainan', REFS['xai-grok1']), {
      pieceOf: fixturePieceOf(fixture),
    });
    expect(view.tokenAt(3)).toMatchObject({
      completes: 'inside',
      missingBytes: 2,
      piece: '<0x81>',
      kind: TokenKind.Byte,
    });
    expect(view.tokenAt(0)).toMatchObject({
      zeroWidth: true,
      completes: 'full',
      piece: '▁',
      kind: TokenKind.DummyPrefix,
    });
    expect(view.tokenAt(0).flagsAsWords).toEqual(['zero-width']);
    expect(view.tokensAtByte(0)).toEqual([0, 1]);
    expect(view.charsOfToken(0)).toEqual([]);
  });
});

describe('partsAt', () => {
  it('names parts by final token, by recorded merge, or by the idOf resolver', () => {
    const lookups: number[][] = [];
    const view = new TokenizationView(cl100k(), {
      idOf: (bytes) => {
        lookups.push(Array.from(bytes));
        return bytes.length === 1 ? 1000 + (bytes[0] ?? 0) : null;
      },
    });
    const p0 = view.partsAt(0);
    expect(p0.partStart).toHaveLength(13);
    expect(p0.partId[5]).toBe(96); // A3 is a final token
    expect(p0.partId[0]).toBe(1000 + 0xe5); // resolver
    const p1 = view.partsAt(1);
    expect(Array.from(p1.partStart.subarray(0, 3))).toEqual([0, 2, 3]);
    expect(p1.partId[0]).toBe(5877); // formed by step 1
    expect(p1.justMerged).toBe(0);
    const p7 = view.partsAt(7);
    expect(Array.from(p7.partId)).toEqual([55038, 66285, 96, 55038, 59563]);
    expect(p7.justMerged).toBe(1);
    expect(Array.from(view.partsAt(0).partId)).toEqual(Array.from(p0.partId));
    expect(lookups.length).toBeGreaterThan(0);
    expect(() => view.partsAt(8)).toThrow(RangeError);
  });

  it('shows a matched special string as one part', () => {
    const text = 'a<|x|>b';
    const analysis = analyzeText(text);
    const recorder = new TimelineRecorder(analysis.utf8.length);
    const timeline = recorder.finish();
    const result = buildResult({
      tokenizer: 'openai-o200k_base',
      family: 'bytelevel-bpe',
      options: { specialTokens: 'match' },
      analysis,
      chunks: { byteStart: [0, 1, 6, 7], kind: [ChunkKind.Regex, ChunkKind.SpecialString, ChunkKind.Regex] },
      tokens: {
        id: [64, 199999, 65],
        byteStart: [0, 1, 6, 7],
        kind: [TokenKind.Normal, TokenKind.Special, TokenKind.Normal],
      },
      timeline,
    });
    expect(result.tokens.flags[1]).toBe(TokenFlag.Special);
    expect(result.stats.specialTokens).toBe(1);
    const parts = new TokenizationView(result).partsAt(0);
    expect(Array.from(parts.partStart)).toEqual([0, 1, 6, 7]);
    expect(Array.from(parts.partId)).toEqual([64, 199999, 65]);
    expect(Array.from(parts.partChunk)).toEqual([0, 1, 2]);
  });

  it('without a timeline shows the final tokens at step 0 only', () => {
    const view = new TokenizationView(
      fromFixtureCase(spmFixture('google-gemma4'), 'zh-tw-tainan', REFS['google-gemma4']),
    );
    expect(view.stepCount).toBe(0);
    expect(Array.from(view.partsAt(0).partId)).toEqual([44953, 237838, 238162]);
    expect(() => view.partsAt(1)).toThrow(RangeError);
    expect(() => view.stepSentence(1)).toThrow(RangeError);
  });
});

describe('stepSentence', () => {
  it('classifies whole, part and crossing merges', () => {
    const view = new TokenizationView(cl100k());
    expect(view.stepSentence(1)).toMatchObject({ partOf: 'part', charsText: '台', leftHex: ['E5'], rightHex: ['8F'] });
    expect(view.stepSentence(4)).toMatchObject({ partOf: 'whole', charsText: '台', resultId: 55038 });
    const grok2 = new TokenizationView(
      fromFixtureCase(loadFixture('xai-grok2'), 'ja-shibuya-ramen', REFS['xai-grok2']),
    );
    const crossing = Array.from({ length: grok2.stepCount }, (_, i) => grok2.stepSentence(i + 1)).find(
      (s) => s.resultId === 4242,
    );
    expect(crossing?.partOf).toBe('crosses');
    expect(crossing?.charsText).toBe('ーメ');
  });
});
