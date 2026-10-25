/**
 * Engine B on small synthetic assets (built with the test-only TSBV1 writer), so every branch is visible in isolation:
 * the score provider (admissible types, −score, UNUSED → NO_MERGE, the maxPieceBytes bound), the merge-rank provider
 * (exact split CSR lookup) with a non-special added token pre-matched as USER_DEFINED (the path Gemma 4 does not use),
 * SentencePiece vs HF fallback order (split steps vs step-0 byte symbols, and the one shape where they differ), the
 * dummy prefix (bare, fused, pre-matched), specials under 'match', trace options, the Tokenizer helpers, dispose, and
 * the configuration checks.
 */
import { describe, expect, it } from 'vitest';
import { NO_MERGE } from '../../../src/agenda/types.ts';
import {
  createSpmEngine,
  createSpmTokenizer,
  MergeRankPriority,
  resolveSpmConfig,
  ScorePriority,
  type SpmEntryLike,
} from '../../../src/engines/spm/index.ts';
import { syntheticMeta, utf8, writeTsbv1 } from '../../../src/format/__tests__/tsbv1-writer.ts';
import { PieceType, readTsbv1 } from '../../../src/format/tsbv1.ts';
import type { Tsbv1 } from '../../../src/format/types.ts';
import { replay } from '../../../src/timeline/replay.ts';
import {
  ALIVE,
  checkInvariants,
  ChunkKind,
  NEVER,
  StepKind,
  TokenKind,
  type TokenizationResult,
  type TokenizerId,
} from '../../../src/index.ts';

const { Normal, UserDefined, Byte, Control, Unk } = PieceType;
const BYTE_WORDS = Array.from(
  { length: 256 },
  (_, b) => [`<0x${b.toString(16).toUpperCase().padStart(2, '0')}>`, Byte, 0] as const,
);

type Word = readonly [string, number, number];

/** Grok-1-like: score priority, after-merge, dummy prefix; BYTE pieces at 3..258. */
const SCORE_WORDS: readonly Word[] = [
  ['<unk>', Unk, 0],
  ['<s>', Control, 0],
  ['</s>', Control, 0],
  ...BYTE_WORDS,
  ['▁', Normal, -1], // 259
  ['a', Normal, -2], // 260
  ['b', Normal, -3], // 261
  ['ab', Normal, -4], // 262
  ['▁a', Normal, -5], // 263
  ['▁ab', Normal, -6], // 264
  ['灣a', Normal, -7], // 265: 灣 alone is not a piece
  ['<sep>', UserDefined, 0], // 266
  ['1', UserDefined, 0], // 267
  ['▁▁', Normal, -8], // 268
];

/** Gemma-4-like: merge-rank priority, before-merge, no dummy; BYTE pieces at 4..259; `<x>` a non-special added token. */
const RANK_WORDS: readonly Word[] = [
  ['<pad>', Control, 0],
  ['<eos>', Control, 0],
  ['<bos>', Control, 0],
  ['<unk>', Unk, 0],
  ...BYTE_WORDS,
  ['▁', Normal, 0], // 260
  ['a', Normal, 0], // 261
  ['b', Normal, 0], // 262
  ['ab', Normal, 0], // 263
  ['▁a', Normal, 0], // 264
  ['▁ab', Normal, 0], // 265
  ['<x>', UserDefined, 0], // 266
  ['▁▁', Normal, 0], // 267
  ['▁▁▁', Normal, 0], // 268
];
/** Rank order; ▁▁▁ only as ▁▁|▁ (UTF-16 split 2). */
const RANK_MERGES = [
  { result: 263, splitUtf16: 1 }, // a|b
  { result: 267, splitUtf16: 1 }, // ▁|▁
  { result: 264, splitUtf16: 1 }, // ▁|a
  { result: 265, splitUtf16: 1 }, // ▁|ab
  { result: 268, splitUtf16: 2 }, // ▁▁|▁
];

function scoreAsset(): Tsbv1 {
  const pieces = SCORE_WORDS.map(([w]) => utf8(w));
  const specials = [0, 1, 2].map((id) => ({ id, bytes: pieces[id]! }));
  return readTsbv1(
    writeTsbv1({
      family: 'spm-bpe',
      meta: syntheticMeta('spm-bpe', pieces, specials.length, {
        tokenizerId: 'xai-grok1',
        priority: 'score',
        fallbackOrder: 'after-merge',
        addDummyPrefix: true,
        escapeWhitespace: true,
        byteFirstId: 3,
        bosId: 1,
      }),
      pieces,
      types: SCORE_WORDS.map(([, t]) => t),
      scores: { kind: 'int', values: SCORE_WORDS.map(([, , s]) => s) },
      specials,
    }),
  );
}

function rankAsset(): Tsbv1 {
  const pieces = RANK_WORDS.map(([w]) => utf8(w));
  const specials = [0, 1, 2, 3].map((id) => ({ id, bytes: pieces[id]! }));
  return readTsbv1(
    writeTsbv1({
      family: 'spm-bpe',
      meta: syntheticMeta('spm-bpe', pieces, specials.length, {
        counts: { pieces: pieces.length, specials: specials.length, merges: RANK_MERGES.length },
        priority: 'merge-rank',
        fallbackOrder: 'before-merge',
        addDummyPrefix: false,
        byteFirstId: 4,
      }),
      pieces,
      types: RANK_WORDS.map(([, t]) => t),
      merges: RANK_MERGES,
      specials,
    }),
  );
}

function entry(
  id: TokenizerId,
  count: number,
  engine: Partial<Extract<SpmEntryLike['engine'], { kind: 'spm-bpe' }>>,
): SpmEntryLike {
  return {
    id,
    family: 'spm-bpe',
    vocabSize: count,
    rankCount: count,
    engine: {
      kind: 'spm-bpe',
      priority: 'score',
      fallbackOrder: 'after-merge',
      addDummyPrefix: true,
      escapeWhitespace: true,
      byteFirstId: 3,
      unkId: 0,
      bosId: 1,
      eosId: 2,
      padId: 0,
      ...engine,
    },
  };
}

const SCORE_ENTRY = entry('xai-grok1', SCORE_WORDS.length, {});
const RANK_ENTRY = entry('google-gemma4', RANK_WORDS.length, {
  priority: 'merge-rank',
  fallbackOrder: 'before-merge',
  addDummyPrefix: false,
  byteFirstId: 4,
  unkId: 3,
  bosId: 2,
  eosId: 1,
});

const ids = (r: TokenizationResult): number[] => Array.from(r.tokens.id);
const spans = (r: TokenizationResult): number[] => Array.from(r.tokens.byteStart);
const sound = (r: TokenizationResult): TokenizationResult => {
  expect(checkInvariants(r)).toEqual([]);
  return r;
};

describe('ScorePriority (SentencePiece order)', () => {
  const tsbv = scoreAsset();
  const tok = createSpmTokenizer(tsbv, SCORE_ENTRY);

  it('merges the best score first and fuses the zero-width dummy prefix: "ab" → ▁ab', () => {
    const r = sound(tok.encode('ab'));
    expect(ids(r)).toEqual([264]);
    expect(spans(r)).toEqual([0, 2]);
    const tl = r.timeline!;
    expect(tl.leadingZeroWidthPart).toBe(true);
    expect(Array.from(tl.stepLeft)).toEqual([0, 0]);
    expect(Array.from(tl.stepMid)).toEqual([1, 0]); // a|b, then the dummy ▁|ab (virtual boundary 0)
    expect(Array.from(tl.stepRank)).toEqual([4, 6]); // −score
    expect(Array.from(tl.stepResultId)).toEqual([262, 264]);
    expect([tl.boundaryDied[0], tl.boundaryDied[1]]).toEqual([2, 1]);
    expect(Array.from(replay(tl, 0))).toEqual([0, 0, 1, 2]);
    expect(Array.from(replay(tl, 2))).toEqual([0, 2]);
    expect(r.stats.mergeSteps).toBe(2);
  });

  it('keeps a bare dummy prefix as a zero-width DummyPrefix token; USER_DEFINED symbols are frozen', () => {
    const r = sound(tok.encode('a 1'));
    expect(ids(r)).toEqual([263, 259, 267]);
    expect(Array.from(r.tokens.kind)).toEqual([TokenKind.Normal, TokenKind.Normal, TokenKind.UserDefined]);
    const bare = sound(tok.encode('<sep>'));
    expect(ids(bare)).toEqual([259, 266]);
    expect(bare.tokens.kind[0]).toBe(TokenKind.DummyPrefix);
    expect(spans(bare)).toEqual([0, 0, 5]);
    expect(bare.timeline!.boundaryBorn.subarray(1, 5)).toEqual(new Int32Array(4).fill(NEVER));
  });

  it('records the after-merge byte fallback as a split step that gives birth to the inner boundaries', () => {
    const r = sound(tok.encode('灣'));
    expect(ids(r)).toEqual([259, 3 + 0xe7, 3 + 0x81, 3 + 0xa3]);
    const tl = r.timeline!;
    expect([tl.stepCount, tl.stepKind[0], tl.stepLeft[0], tl.stepMid[0], tl.stepEnd[0]]).toEqual([
      1,
      StepKind.ByteFallbackSplit,
      0,
      0,
      3,
    ]);
    expect(Array.from(tl.boundaryBorn.subarray(1, 3))).toEqual([1, 1]);
    expect(Array.from(r.tokens.stepFormed)).toEqual([-1, 1, 1, 1]);
  });

  it('HF order splits before merging (born at step 0), which is the one shape where the orders differ', () => {
    const hf = createSpmEngine(tsbv, { ...resolveSpmConfig(tsbv, SCORE_ENTRY), fallbackOrder: 'before-merge' });
    const r = sound(hf.encode('灣'));
    expect(ids(r)).toEqual([259, 3 + 0xe7, 3 + 0x81, 3 + 0xa3]);
    expect(r.timeline!.stepCount).toBe(0);
    expect(Array.from(r.timeline!.boundaryBorn.subarray(1, 3))).toEqual([0, 0]);
    // '灣a' is a piece but '灣' is not: SentencePiece merges the symbols, HF has already shattered 灣.
    expect(ids(tok.encode('灣a'))).toEqual([259, 265]);
    expect(ids(hf.encode('灣a'))).toEqual([259, 3 + 0xe7, 3 + 0x81, 3 + 0xa3, 260]);
  });

  it('matches CONTROL / UNK strings only under match, as SpecialString chunks; byte-falls them back as text', () => {
    const text = sound(tok.encode('a<s>b'));
    expect(ids(text)).toEqual([263, 3 + 0x3c, 3 + 0x73, 3 + 0x3e, 261]);
    expect(text.chunks.count).toBe(1);
    const m = sound(tok.encode('a<s>b', { specialTokens: 'match' }));
    expect(ids(m)).toEqual([263, 1, 261]);
    expect(Array.from(m.tokens.kind)).toEqual([TokenKind.Normal, TokenKind.Special, TokenKind.Normal]);
    expect(Array.from(m.chunks.kind)).toEqual([ChunkKind.SpmText, ChunkKind.SpecialString, ChunkKind.SpmText]);
    expect(Array.from(m.chunks.byteStart)).toEqual([0, 1, 4, 5]);
    expect(m.stats.specialTokens).toBe(1);
  });

  it('honours trace: false and trace.maxSteps (born/died still describe the final tokens)', () => {
    const off = sound(tok.encode('ab', { trace: false }));
    expect(off.timeline).toBeNull();
    expect(off.stats.mergeSteps).toBe(2);
    const capped = sound(tok.encode('ab', { trace: { maxSteps: 1 } }));
    const tl = capped.timeline!;
    expect([tl.stepCount, tl.truncated, tl.boundaryDied[0]]).toEqual([1, true, 1]);
    expect(Array.from(replay(tl, 1))).toEqual([0, 2]);
    expect(capped.stats.mergeSteps).toBe(2);
  });

  it('refuses UNUSED / CONTROL / BYTE results and slices longer than maxPieceBytes', () => {
    const norm = utf8('ab');
    const types = new Uint8Array(tsbv.types!);
    const prio = (t: Uint8Array, max = 5): ScorePriority =>
      new ScorePriority({ vocab: tsbv.vocab, types: t, maxPieceBytes: max, scores: tsbv.scores! }, norm);
    expect(prio(types).priority(0, 1, 2)).toBe(4);
    expect(prio(types).mergedId(0, 1, 2)).toBe(262);
    expect(prio(types, 1).priority(0, 1, 2)).toBe(NO_MERGE);
    for (const type of [PieceType.Unused, PieceType.Control, PieceType.Byte, PieceType.Unk]) {
      const patched = types.slice();
      patched[262] = type;
      expect(prio(patched).priority(0, 1, 2)).toBe(NO_MERGE);
    }
    const notAPiece = new ScorePriority(
      { vocab: tsbv.vocab, types, maxPieceBytes: 5, scores: tsbv.scores! },
      utf8('ba'),
    );
    expect(notAPiece.priority(0, 1, 2)).toBe(NO_MERGE);
  });

  it('implements tokenBytes / pieceString / idOf / pretokenize and info', () => {
    expect(new TextDecoder().decode(tok.tokenBytes(264)!)).toBe(' ab');
    expect(Array.from(tok.tokenBytes(3 + 0x41)!)).toEqual([0x41]);
    expect(new TextDecoder().decode(tok.tokenBytes(1)!)).toBe('<s>');
    expect(tok.tokenBytes(-1)).toBeNull();
    expect(tok.tokenBytes(SCORE_WORDS.length)).toBeNull();
    expect(tok.pieceString(264)).toBe('▁ab');
    expect(tok.pieceString(3)).toBe('<0x00>');
    expect(tok.pieceString(1.5)).toBeNull();
    expect(tok.idOf(utf8(' ab'))).toBe(264);
    expect(tok.idOf(Uint8Array.of(0xe7))).toBe(3 + 0xe7);
    expect(tok.idOf(utf8('<0x41>'))).toBeNull();
    expect(tok.idOf(utf8('zz'))).toBeNull();
    expect(tok.pretokenize('ab 1')).toEqual([
      [0, 0],
      [0, 1],
      [1, 2],
      [2, 3],
      [3, 4],
    ]);
    expect(tok.info).toMatchObject({
      id: 'xai-grok1',
      family: 'spm-bpe',
      bosId: 1,
      unicodeVersion: '16.0.0',
      supports: { nfkc: false, bos: true, specialsToggle: true },
    });
    expect(tok.info.specials.map((s) => s.text)).toEqual(['<unk>', '<s>', '</s>']);
  });

  it('never applies NFKC (an spm tokenizer has no normalization option)', () => {
    const r = sound(tok.encode('ａ', { normalize: 'NFKC' }));
    expect(r.options.normalize).toBe('none');
    expect(r.text).toBe('ａ');
  });

  it('throws after dispose', () => {
    const t = createSpmTokenizer(tsbv, SCORE_ENTRY);
    t.dispose();
    expect(() => t.encode('a')).toThrow(/disposed/);
  });
});

describe('MergeRankPriority (HF order)', () => {
  const tsbv = rankAsset();
  const tok = createSpmTokenizer(tsbv, RANK_ENTRY);

  it('merges by HF rank, recording the rank: " ab" → ▁ab', () => {
    const r = sound(tok.encode(' ab'));
    expect(ids(r)).toEqual([265]);
    expect(Array.from(r.timeline!.stepRank)).toEqual([0, 3]);
    expect(r.timeline!.leadingZeroWidthPart).toBe(false);
  });

  it('needs the exact split: ▁▁▁ forms only as ▁▁|▁, leftmost tie first', () => {
    const r = sound(tok.encode('   '));
    expect(ids(r)).toEqual([268]);
    expect(Array.from(r.timeline!.stepMid)).toEqual([1, 2]);
    const norm = utf8('▁▁▁');
    const prio = new MergeRankPriority(
      { vocab: tsbv.vocab, types: tsbv.types!, maxPieceBytes: tsbv.meta.maxPieceBytes, merges: tsbv.merges! },
      norm,
    );
    expect(prio.priority(0, 3, 9)).toBe(NO_MERGE); // ▁|▁▁ is not in the merge list
    expect(prio.priority(0, 6, 9)).toBe(4);
    expect(prio.mergedId(0, 6, 9)).toBe(268);
  });

  it('pre-matches a non-special added token (TYPS USER_DEFINED) as a frozen UserDefined symbol', () => {
    const r = sound(tok.encode('<x>ab'));
    expect(ids(r)).toEqual([266, 263]);
    expect(Array.from(r.tokens.kind)).toEqual([TokenKind.UserDefined, TokenKind.Normal]);
  });

  it('falls back to bytes before merging, with no steps; specials only under match', () => {
    const r = sound(tok.encode('台'));
    expect(ids(r)).toEqual([4 + 0xe5, 4 + 0x8f, 4 + 0xb0]);
    expect(r.timeline!.stepCount).toBe(0);
    expect(ids(tok.encode('<bos>a', { specialTokens: 'match' }))).toEqual([2, 261]);
    expect(ids(tok.encode('<bos>', { addBos: true, specialTokens: 'match' }))).toEqual([2, 2]);
  });
});

describe('resolveSpmConfig', () => {
  const tsbv = scoreAsset();
  const bad = (patch: Partial<SpmEntryLike>): SpmEntryLike => ({ ...SCORE_ENTRY, ...patch });

  it('rejects entries that disagree with the asset', () => {
    expect(() => resolveSpmConfig(tsbv, bad({ id: 'google-gemma2' }))).toThrow(/the asset is xai-grok1/);
    expect(() => resolveSpmConfig(tsbv, bad({ family: 'bytelevel-bpe' }))).toThrow(/spm-bpe/);
    expect(() => resolveSpmConfig(tsbv, bad({ engine: { kind: 'bytelevel-bpe' } }))).toThrow(/spm-bpe/);
    expect(() => resolveSpmConfig(tsbv, bad({ vocabSize: 7 }))).toThrow(/vocabSize/);
    expect(() => resolveSpmConfig(tsbv, entry('xai-grok1', SCORE_WORDS.length, { byteFirstId: 4 }))).toThrow(
      /byteFirstId/,
    );
    expect(() => resolveSpmConfig(tsbv, entry('xai-grok1', SCORE_WORDS.length, { addDummyPrefix: false }))).toThrow(
      /addDummyPrefix/,
    );
  });

  it('keeps the entry defaults and accepts a matching entry', () => {
    const config = resolveSpmConfig(tsbv, { ...SCORE_ENTRY, defaults: { addBos: true } });
    expect(config).toMatchObject({ priority: 'score', fallbackOrder: 'after-merge', byteFirstId: 3 });
    const r = createSpmEngine(tsbv, config).encode('a');
    expect(ids(r)).toEqual([1, 263]);
    expect(r.timeline!.boundaryBorn[0]).toBe(0);
    expect(r.timeline!.boundaryDied[1]).toBe(ALIVE);
  });
});
