/**
 * Engine A behaviour beyond `runFixture`: the research anchors as literal tests (04 §7), special strings, BOS, direct
 * hits, NFKC with its source map, trace modes, the `Tokenizer` surface and the factory's validation.
 */
import { describe, expect, it } from 'vitest';
import { createByteLevelTokenizer } from '../../../src/engines/bytelevel/index.ts';
import {
  ALIVE,
  ChunkKind,
  checkInvariants,
  NEVER,
  replay,
  TokenFlag,
  TokenKind,
  type TokenizationResult,
} from '../../../src/index.ts';
import { NO_RULE } from '../../../src/unicode/expand.ts';
import { builtTsbv, fixtureOf, registryEntry, SKIP_REASON, tokenizerFor, type ByteLevelId } from './assets.ts';

const ids = (r: TokenizationResult): number[] => Array.from(r.tokens.id);
const steps = (r: TokenizationResult): Array<[number, number, number, number, number]> =>
  Array.from({ length: r.timeline?.stepCount ?? 0 }, (_, i) => {
    const t = r.timeline;
    return [
      t?.stepLeft[i] ?? -1,
      t?.stepMid[i] ?? -1,
      t?.stepEnd[i] ?? -1,
      t?.stepResultId[i] ?? -1,
      t?.stepRank[i] ?? -1,
    ];
  });
const caseText = (id: ByteLevelId, name: string): string => {
  const c = fixtureOf(id).cases.find((x) => x.name === name);
  if (c === undefined) throw new Error(`${id} has no case ${name}`);
  return c.text;
};

describe.skipIf(SKIP_REASON !== null)('research anchors (04 §7)', () => {
  it('o200k 台灣台南 → [3735, 133072, 3735, 14609], one chunk, eight steps', () => {
    const r = tokenizerFor('openai-o200k_base').encode('台灣台南');
    expect(ids(r)).toEqual([3735, 133072, 3735, 14609]);
    expect(r.chunks.count).toBe(1);
    expect(r.chunks.directHit[0]).toBe(0);
    expect(r.timeline?.stepCount).toBe(8);
    expect(r.stats.splitChars).toBe(0);
  });

  it('Grok-2 zh-tw-tainan: first step merges bytes 0|1 into id 1128 (= PCES index 1000 + idOffset 128)', () => {
    const r = tokenizerFor('xai-grok2').encode('台灣台南');
    expect(ids(r)).toEqual([15721, 7489, 291, 15721, 12048]);
    expect(steps(r)[0]).toEqual([0, 1, 2, 1128, 1128]);
    expect(builtTsbv('xai-grok2').vocab.indexOf(new TextEncoder().encode('台'), 0, 2)).toBe(1000);
  });

  it('Grok-2 token 4242 = ー + two bytes of メ: partial, crosses a char boundary, splits メ', () => {
    const r = tokenizerFor('xai-grok2').encode('東京都渋谷区のラーメン屋さん');
    const t = ids(r).indexOf(4242);
    expect(t).toBeGreaterThan(0);
    const flags = r.tokens.flags[t] ?? 0;
    expect(flags & TokenFlag.Partial).toBeTruthy();
    expect(flags & TokenFlag.EndsMidChar).toBeTruthy();
    expect(flags & TokenFlag.StartsMidChar).toBeFalsy();
    expect((r.tokens.charLast[t] ?? 0) - (r.tokens.charFirst[t] ?? 0)).toBe(1);
    expect(r.stats.splitChars).toBeGreaterThan(0);
  });

  it('Claude 20094 (ー + two bytes of ク) and ranks offset by 5 in the timeline', () => {
    const claude = tokenizerFor('anthropic-claude-legacy');
    const r = claude.encode('日本語のトークン化');
    expect(ids(r)).toContain(20094);
    const tainan = claude.encode('台灣台南');
    expect(ids(tainan)).toEqual([28984, 36261, 101, 28984, 21422]);
    expect(steps(tainan)[0]).toEqual([0, 1, 2, 2443, 2443]);
    expect(builtTsbv('anthropic-claude-legacy').vocab.indexOf(new TextEncoder().encode('台'), 0, 2)).toBe(2443 - 5);
  });

  it('cl100k splits 灣 at the last of seven steps into 66285', () => {
    const r = tokenizerFor('openai-cl100k_base').encode('台灣台南');
    expect(ids(r)).toEqual([55038, 66285, 96, 55038, 59563]);
    expect(r.timeline?.stepCount).toBe(7);
    expect(steps(r)[6]?.[3]).toBe(66285);
    expect(r.stats.splitChars).toBe(1);
  });
});

describe.skipIf(SKIP_REASON !== null)('special strings (04 §2.4)', () => {
  it('o200k <|endoftext|>: text by default, one SpecialString chunk with a Special token under match', () => {
    const o200k = tokenizerFor('openai-o200k_base');
    expect(ids(o200k.encode('<|endoftext|>'))).toEqual([27, 91, 419, 1440, 919, 91, 29]);
    const r = o200k.encode('<|endoftext|>', { specialTokens: 'match' });
    expect(ids(r)).toEqual([199999]);
    expect(r.chunks.kind[0]).toBe(ChunkKind.SpecialString);
    expect(r.chunks.rule[0]).toBe(NO_RULE);
    expect(r.tokens.kind[0]).toBe(TokenKind.Special);
    expect(r.tokens.flags[0]).toBe(TokenFlag.Special);
    expect(r.stats.specialTokens).toBe(1);
    expect(checkInvariants(r)).toEqual([]);
  });

  it('segments around a special are pre-tokenized on their own (Llama 3 "x <|begin_of_text|> y")', () => {
    const r = tokenizerFor('meta-llama3').encode('x <|begin_of_text|> y', { specialTokens: 'match' });
    expect(ids(r)).toEqual([87, 220, 128000, 379]);
    expect(Array.from(r.chunks.kind)).toEqual([
      ChunkKind.Regex,
      ChunkKind.Regex,
      ChunkKind.SpecialString,
      ChunkKind.Regex,
    ]);
    // boundaries bordering and inside the special chunk are permanent (03 §B.2)
    const t = r.timeline;
    expect(t).not.toBeNull();
    for (let b = 2; b <= 19; b++) {
      expect(t?.boundaryBorn[b]).toBe(0);
      expect(t?.boundaryDied[b]).toBe(ALIVE);
    }
  });

  it('adjacent specials and specials at the text edges leave no empty chunks', () => {
    const r = tokenizerFor('openai-cl100k_base').encode('<|endoftext|><|endoftext|>a<|fim_prefix|>', {
      specialTokens: 'match',
    });
    expect(ids(r)).toEqual([100257, 100257, 64, 100258]);
    expect(r.chunks.count).toBe(4);
    expect(checkInvariants(r)).toEqual([]);
  });
});

describe.skipIf(SKIP_REASON !== null)('addBos (Llama 3 / Llama 4)', () => {
  it.each([
    ['meta-llama3', 128000],
    ['meta-llama4-muse', 200000],
  ] as const)('%s prepends a zero-width Bos token %i that no char counts', (id, bos) => {
    const tokenizer = tokenizerFor(id);
    const plain = tokenizer.encode('台灣台南');
    const r = tokenizer.encode('台灣台南', { addBos: true });
    expect(ids(r)).toEqual([bos, ...ids(plain)]);
    expect(r.tokens.kind[0]).toBe(TokenKind.Bos);
    expect(r.tokens.flags[0]).toBe(TokenFlag.ZeroWidth | TokenFlag.Special);
    expect(r.tokens.chunk[0]).toBe(-1);
    expect(r.tokens.charFirst[0]).toBe(0);
    expect(r.stats.splitChars).toBe(plain.stats.splitChars);
    expect(Array.from(r.chars.tokenFirst)).toEqual(Array.from(plain.chars.tokenFirst, (t) => t + 1));
    expect(checkInvariants(r)).toEqual([]);
  });

  it('is ignored by tokenizers without a BOS id, and BOS on empty text is the only token', () => {
    expect(ids(tokenizerFor('openai-o200k_base').encode('a', { addBos: true }))).toEqual([64]);
    const empty = tokenizerFor('meta-llama3').encode('', { addBos: true });
    expect(ids(empty)).toEqual([128000]);
    expect(empty.chunks.count).toBe(0);
    expect(checkInvariants(empty)).toEqual([]);
  });
});

describe.skipIf(SKIP_REASON !== null)('direct hits (fixture directHit)', () => {
  it('single bytes and whole-chunk vocabulary entries are direct hits with no steps; inner boundaries are born NEVER', () => {
    const r = tokenizerFor('openai-o200k_base').encode('a hello');
    expect(r.chunks.count).toBe(2);
    expect(Array.from(r.chunks.directHit)).toEqual([1, 1]);
    expect(r.timeline?.stepCount).toBe(0);
    expect(r.tokens.flags[1] ?? 0).toBe(TokenFlag.DirectHit);
    for (let b = 2; b < 7; b++) expect(r.timeline?.boundaryBorn[b]).toBe(NEVER);
    expect(replay(r.timeline!, 0)).toEqual(replay(r.timeline!, r.timeline!.stepCount));
  });

  it('a 2-byte chunk that is not a piece and cannot merge is not a direct hit and has no steps (o200k nel)', () => {
    const r = tokenizerFor('openai-o200k_base').encode(caseText('openai-o200k_base', 'nel'));
    expect(ids(r)).toEqual([64, 126, 227, 65]);
    expect(Array.from(r.chunks.directHit)).toEqual([1, 0]);
    expect(r.timeline?.stepCount).toBe(0);
  });
});

describe.skipIf(SKIP_REASON !== null)('legacy Claude NFKC (03 §B.4)', () => {
  const claude = tokenizerFor('anthropic-claude-legacy');

  it('encodes the NFKC text and maps every output code point to its input run', () => {
    // segments are cut before code points with ccc = 0 and NFKC_QC = Yes (ﾀ, ﾞ and ㍻ are not): aﾀﾞ (3 → 2) | b㍻ (2 → 3)
    const r = claude.encode('aﾀﾞb㍻', { normalize: 'NFKC' });
    expect(r.input.text).toBe('aﾀﾞb㍻');
    expect(r.text).toBe('aダb平成');
    expect(r.normalization).toEqual({ form: 'NFKC', changed: true });
    expect(Array.from(r.chars.sourceRunStart ?? [])).toEqual([0, 0, 3, 3, 3]);
    expect(Array.from(r.chars.sourceRunEnd ?? [])).toEqual([3, 3, 5, 5, 5]);
    expect(r.input.codePoints).toBe(5);
    expect(checkInvariants(r)).toEqual([]);
  });

  it('unchanged text still reports the NFKC form; the default mode leaves the text alone', () => {
    const same = claude.encode('abc', { normalize: 'NFKC' });
    expect(same.normalization).toEqual({ form: 'NFKC', changed: false });
    const raw = claude.encode('ﾀﾞ');
    expect(raw.normalization).toBeNull();
    expect(raw.text).toBe('ﾀﾞ');
    expect(raw.chars.sourceRunStart).toBeNull();
  });

  it('is declared only where the registry offers the toggle', () => {
    expect(claude.info.supports.nfkc).toBe(true);
    expect(tokenizerFor('openai-o200k_base').info.supports.nfkc).toBe(false);
  });
});

describe.skipIf(SKIP_REASON !== null)('trace modes', () => {
  const o200k = tokenizerFor('openai-o200k_base', { cacheBytes: 0 });
  const text = caseText('openai-o200k_base', 'en-paragraph') + caseText('openai-o200k_base', 'zh-tw-paragraph');

  it('trace: false keeps the ids and counts every merge in stats.mergeSteps', () => {
    const full = o200k.encode(text);
    const untraced = o200k.encode(text, { trace: false });
    expect(untraced.timeline).toBeNull();
    expect(ids(untraced)).toEqual(ids(full));
    expect(untraced.stats.mergeSteps).toBe(full.timeline?.stepCount);
    expect(Array.from(untraced.chunks.rule).every((rule) => rule === NO_RULE)).toBe(true);
    expect(Array.from(full.chunks.rule).every((rule) => rule !== NO_RULE)).toBe(true);
    expect(Array.from(untraced.tokens.stepFormed).every((s) => s === -1)).toBe(true);
  });

  it('trace: { maxSteps } truncates the steps but replay(stepCount) still equals the final tokens', () => {
    const full = o200k.encode(text);
    const cut = o200k.encode(text, { trace: { maxSteps: 25 } });
    expect(cut.timeline?.truncated).toBe(true);
    expect(cut.timeline?.stepCount).toBe(25);
    expect(cut.stats.mergeSteps).toBe(full.timeline?.stepCount);
    expect(ids(cut)).toEqual(ids(full));
    expect(checkInvariants(cut)).toEqual([]);
  });

  it('the chunk cache replays identical timelines (cached ≡ uncached, traced and truncated)', () => {
    const cached = tokenizerFor('openai-o200k_base');
    for (const trace of [true, { maxSteps: 40 }, false] as const) {
      cached.encode(text, { trace });
      const again = cached.encode(text, { trace });
      const fresh = o200k.encode(text, { trace });
      expect({ ...again, timings: null }).toEqual({ ...fresh, timings: null });
    }
    expect(cached.cacheBytes).toBeGreaterThan(0);
  });
});

describe.skipIf(SKIP_REASON !== null)('the Tokenizer surface', () => {
  it('info is built from META, the entry and SPCL', () => {
    const grok2 = tokenizerFor('xai-grok2');
    expect(grok2.info).toMatchObject({
      id: 'xai-grok2',
      family: 'bytelevel-bpe',
      vocabSize: 131072,
      rankCount: 130944,
      bosId: null,
      unicodeVersion: '16.0.0',
      sourceSha256: builtTsbv('xai-grok2').meta.upstream.sha256,
      supports: { nfkc: false, bos: false, specialsToggle: true },
    });
    expect(grok2.info.specials).toHaveLength(128);
    expect(grok2.info.specials.find((s) => s.text === '<|eos|>')?.id).toBe(2);
    expect(tokenizerFor('meta-llama3').info.supports.bos).toBe(true);
  });

  it('tokenBytes / idOf / pieceString', () => {
    const grok2 = tokenizerFor('xai-grok2');
    const bytes = grok2.tokenBytes(4242);
    expect(Array.from(bytes ?? [])).toEqual([0xe3, 0x83, 0xbc, 0xe3, 0x83]);
    expect(grok2.idOf(Uint8Array.of(0xe3, 0x83, 0xbc, 0xe3, 0x83))).toBe(4242);
    expect(grok2.tokenBytes(2)).toEqual(new TextEncoder().encode('<|eos|>'));
    expect(grok2.idOf(new TextEncoder().encode('<|eos|>'))).toBe(2);
    expect(grok2.tokenBytes(131072)).toBeNull();
    expect(grok2.tokenBytes(-1)).toBeNull();
    expect(grok2.idOf(new Uint8Array(0))).toBeNull();
    expect(grok2.idOf(new TextEncoder().encode('東京都渋谷区のラーメン屋さん'))).toBeNull();
    expect(grok2.pieceString(4242)).toBeNull();
    // tokenBytes returns a copy: mutating it never touches the vocabulary
    bytes?.fill(0);
    expect(Array.from(grok2.tokenBytes(4242) ?? [])).toEqual([0xe3, 0x83, 0xbc, 0xe3, 0x83]);
  });

  it('pretokenize returns the fixture chunk spans', () => {
    const o200k = tokenizerFor('openai-o200k_base');
    for (const c of fixtureOf('openai-o200k_base').cases.slice(0, 80)) {
      expect(
        o200k.pretokenize(c.text).map(([s, e]) => [s, e]),
        c.name,
      ).toEqual(c.chunks.map(([s, e]) => [s, e]));
    }
  });

  it('dispose clears the cache and refuses further encodes', () => {
    const o200k = tokenizerFor('openai-o200k_base');
    o200k.encode('hello there, general kenobi');
    expect(o200k.cacheBytes).toBeGreaterThan(0);
    o200k.dispose();
    expect(o200k.cacheBytes).toBe(0);
    expect(() => o200k.encode('x')).toThrow(/disposed/);
  });

  it('rejects options outside EncodeOptions and negative budgets', () => {
    const o200k = tokenizerFor('openai-o200k_base');
    expect(() => o200k.encode('x', { specialTokens: 'all' as 'match' })).toThrow(TypeError);
    expect(() => o200k.encodeIncremental('x', {}, -1)).toThrow(RangeError);
  });
});

describe.skipIf(SKIP_REASON !== null)('createByteLevelTokenizer validation', () => {
  const tsbv = (): ReturnType<typeof builtTsbv> => builtTsbv('openai-cl100k_base');
  const entry = registryEntry('openai-cl100k_base');

  it('is exported by @tsbs/core (the converter probes it, AD-32) and builds a working tokenizer', async () => {
    const core = await import('../../../src/index.ts');
    expect(core.createByteLevelTokenizer).toBe(createByteLevelTokenizer);
    expect(ids(createByteLevelTokenizer(tsbv(), entry).encode('hello'))).toEqual([15339]);
  });

  it.each([
    ['another tokenizer’s asset', () => createByteLevelTokenizer(builtTsbv('openai-o200k_base'), entry)],
    ['an spm entry', () => createByteLevelTokenizer(tsbv(), { ...entry, family: 'spm-bpe' })],
    [
      'an unknown pattern',
      () => createByteLevelTokenizer(tsbv(), { ...entry, engine: { ...entry.engine, pattern: 'gpt2' } }),
    ],
    ['a bad idOffset', () => createByteLevelTokenizer(tsbv(), { ...entry, engine: { ...entry.engine, idOffset: -1 } })],
    ['a wrong rankCount', () => createByteLevelTokenizer(tsbv(), { ...entry, rankCount: 5 })],
    ['bad defaults', () => createByteLevelTokenizer(tsbv(), { ...entry, defaults: { specialTokens: 'all' } })],
  ])('throws a TypeError for %s', (_name, make) => {
    expect(make).toThrow(TypeError);
  });
});
