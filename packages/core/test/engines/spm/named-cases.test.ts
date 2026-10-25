/**
 * The family-specific named cases of 04 §3.3 as literal assertions (readable in isolation; `runFixture` covers them too):
 * Gemma 2 (tab → BYTE 226, USER_DEFINED atomic, `<bos>` as text vs the `'match'` emulation, BOS), Gemma 4 (BYTE ids,
 * HF specials, AD-31 Normal kinds, `<b>` through merges), Grok-1 (zero-width dummy, byte-fallback split, fused dummy
 * spans, digits). Also the configuration facts: registry entry ≡ asset META (04 §3.1).
 */
import { describe, expect, it } from 'vitest';
import { replay } from '../../../src/timeline/replay.ts';
import { NEVER, StepKind, TokenFlag, TokenKind } from '../../../src/index.ts';
import { caseOf } from '../../helpers/fixtures.ts';
import { BUILT, builtTsbv, idsOf, registryEntry, SKIP_REASON, SPM_IDS, spanOf, spmTokenizer } from './helpers.ts';

const text = (id: (typeof SPM_IDS)[number], name: string): string => caseOf(id, name).text;

describe.skipIf(!BUILT)(`spm named cases (04 §3.3)${SKIP_REASON}`, () => {
  it.each(SPM_IDS)('%s: the registry entry agrees with the asset META (04 §3.1)', (id) => {
    const { meta } = builtTsbv(id);
    const entry = registryEntry(id);
    if (entry.engine.kind !== 'spm-bpe') throw new Error('not an spm entry');
    const { engine } = entry;
    expect([meta.priority, meta.fallbackOrder, meta.addDummyPrefix, meta.escapeWhitespace]).toEqual([
      engine.priority,
      engine.fallbackOrder,
      engine.addDummyPrefix,
      engine.escapeWhitespace,
    ]);
    expect([meta.byteFirstId, meta.bosId, meta.eosId, meta.unkId, meta.padId]).toEqual([
      engine.byteFirstId,
      engine.bosId,
      engine.eosId,
      engine.unkId,
      engine.padId,
    ]);
    expect(meta.counts.pieces).toBe(entry.vocabSize);
  });

  it.each(SPM_IDS)('%s: no special contains a space or U+2581 (so matching after escaping equals HF)', (id) => {
    for (const { text: special } of builtTsbv(id).specials) expect(special).not.toMatch(/[ ▁]/u);
  });

  describe('google-gemma2', () => {
    const tok = (): ReturnType<typeof spmTokenizer> => spmTokenizer('google-gemma2');

    it('tab-only falls back to BYTE 226 (<0x09>)', () => {
      const r = tok().encode('\t');
      expect(idsOf(r)).toEqual([226]);
      expect(r.tokens.kind[0]).toBe(TokenKind.Byte);
      expect(r.tokens.flags[0]! & TokenFlag.ByteFallback).toBeTruthy();
      expect(tok().pieceString(226)).toBe('<0x09>');
    });

    it('<start_of_turn> and <end_of_turn> are atomic USER_DEFINED tokens', () => {
      const r = tok().encode(text('google-gemma2', 'special-start-of-turn'));
      expect(idsOf(r)).toEqual([106, 1645]);
      expect(r.tokens.kind[0]).toBe(TokenKind.UserDefined);
      expect(spanOf(r, 0)).toEqual([0, 15]);
      const e = tok().encode('x <end_of_turn> y');
      expect(idsOf(e)).toEqual([235297, 235248, 107, 597]);
      expect(e.tokens.kind[2]).toBe(TokenKind.UserDefined);
    });

    it('<bos> is three text tokens as text and [2] under match (the oracle-lane emulation)', () => {
      const t = tok();
      expect(idsOf(t.encode('<bos>'))).toEqual([235322, 14084, 235313]);
      const m = t.encode('<bos>', { specialTokens: 'match' });
      expect(idsOf(m)).toEqual([2]);
      expect(m.tokens.kind[0]).toBe(TokenKind.Special);
      expect(m.chunks.count).toBe(1);
    });

    it('has no dummy prefix; addBos prepends [2] at [0, 0)', () => {
      const r = tok().encode('Hello', { addBos: true });
      expect(r.tokens.id[0]).toBe(2);
      expect(spanOf(r, 0)).toEqual([0, 0]);
      expect(r.tokens.flags[0]).toBe(TokenFlag.ZeroWidth | TokenFlag.Special);
      expect(r.stats.zeroWidthTokens).toBe(1);
      expect(tok().encode('Hello').stats.zeroWidthTokens).toBe(0);
    });
  });

  describe('google-gemma4', () => {
    const tok = (): ReturnType<typeof spmTokenizer> => spmTokenizer('google-gemma4');

    it('BYTE ids 238–493: 𰻝 → [478, 414, 425, 395], born at step 0 (HF before-merge)', () => {
      const r = tok().encode('𰻝');
      expect(idsOf(r)).toEqual([478, 414, 425, 395]);
      expect(Array.from(r.tokens.kind)).toEqual(Array(4).fill(TokenKind.Byte));
      expect(r.timeline?.stepCount).toBe(0);
      expect(Array.from(replay(r.timeline!, 0))).toEqual([0, 1, 2, 3, 4]);
    });

    it('special-bos / special-think are text by default and HF specials under match', () => {
      const t = tok();
      expect(idsOf(t.encode('<bos>'))).toEqual([236820, 46757, 236813]);
      expect(idsOf(t.encode('<bos>', { specialTokens: 'match' }))).toEqual([2]);
      expect(idsOf(t.encode('<|think|>', { specialTokens: 'match' }))).toEqual([98]);
    });

    it('tab-only, newline-pair, three-spaces and literal-sp-space are Normal (AD-31)', () => {
      const t = tok();
      for (const [name, ids] of [
        ['tab-only', [255968]],
        ['newline-pair', [108]],
        ['three-spaces', [139]],
      ] as const) {
        const r = t.encode(text('google-gemma4', name));
        expect(idsOf(r), name).toEqual(ids);
        expect(r.tokens.kind[0], name).toBe(TokenKind.Normal);
        expect(r.tokens.flags[0]! & TokenFlag.UserDefined, name).toBe(0);
      }
      const lit = t.encode(text('google-gemma4', 'literal-sp-space'));
      expect(idsOf(lit).slice(0, 2)).toEqual([82951, 139]);
      expect(spanOf(lit, 1)).toEqual([7, 12]); // space + literal U+2581 (3 bytes) + space
      expect(Array.from(lit.tokens.kind).every((k) => k === TokenKind.Normal)).toBe(true);
    });

    it('<b> encodes as text through merges (HF tokenizers 0.23.3; Gemma 3 SentencePiece would give [200])', () => {
      expect(idsOf(tok().encode('<b>'))).toEqual([236820, 236763, 236813]);
      expect(idsOf(tok().encode('   x  y'))).toEqual([139, 236781, 138, 236762]);
    });
  });

  describe('xai-grok1', () => {
    const tok = (): ReturnType<typeof spmTokenizer> => spmTokenizer('xai-grok1');

    it('zh-tw-tainan: zero-width dummy ▁ at [0, 0), 灣 shattered into three BYTE tokens, splitChars 1', () => {
      const r = tok().encode('台灣台南');
      expect(idsOf(r)).toEqual([130089, 130876, 300, 198, 232, 130876, 130899]);
      expect(spanOf(r, 0)).toEqual([0, 0]);
      expect(r.tokens.kind[0]).toBe(TokenKind.DummyPrefix);
      expect(r.tokens.chunk[0]).toBe(-1);
      expect(r.stats.splitChars).toBe(1);
      const tl = r.timeline!;
      expect(tl.leadingZeroWidthPart).toBe(true);
      expect(tl.stepCount).toBe(1);
      expect([tl.stepKind[0], tl.stepLeft[0], tl.stepMid[0], tl.stepEnd[0], tl.stepResultId[0]]).toEqual([
        StepKind.ByteFallbackSplit,
        3,
        3,
        6,
        300,
      ]);
      expect([tl.boundaryBorn[4], tl.boundaryBorn[5], tl.boundaryBorn[7]]).toEqual([1, 1, NEVER]);
      expect(Array.from(replay(tl, 0))).toEqual([0, 0, 3, 6, 9, 12]);
      expect(Array.from(replay(tl, 1))).toEqual([0, 0, 3, 4, 5, 6, 9, 12]);
      expect([r.tokens.stepFormed[2], r.tokens.stepFormed[3], r.tokens.stepFormed[1]]).toEqual([1, 1, -1]);
    });

    it('leading-spaces: the dummy fuses with three escaped spaces into ▁▁▁▁ (336) covering [0, 3)', () => {
      const r = tok().encode('   leading');
      expect(idsOf(r)).toEqual([336, 15354]);
      expect(spanOf(r, 0)).toEqual([0, 3]);
      expect(r.stats.zeroWidthTokens).toBe(0);
      expect(tok().pieceString(336)).toBe('▁▁▁▁');
      const tl = r.timeline!;
      expect(tl.boundaryDied[0]).toBeGreaterThan(0); // the virtual boundary after the dummy died in a merge
      expect(Array.from(replay(tl, tl.stepCount))).toEqual([0, 3, 10]);
    });

    it('a single leading space fuses with the dummy: ▁▁ (325) covers [0, 1); a literal U+2581 is 3 bytes', () => {
      const flag = tok().encode(text('xai-grok1', 'emoji-flag-tw-leading-space'));
      expect(flag.tokens.id[0]).toBe(325);
      expect(spanOf(flag, 0)).toEqual([0, 1]);
      const lit = tok().encode(text('xai-grok1', 'literal-sp-space'));
      expect(idsOf(lit).slice(0, 2)).toEqual([18004, 325]);
      expect(spanOf(lit, 0)).toEqual([0, 7]); // ▁literal: the dummy covers 0 bytes
      expect(spanOf(lit, 1)).toEqual([7, 11]); // space (1 byte) + literal ▁ (3 bytes)
    });

    it('every digit is its own USER_DEFINED token', () => {
      const r = tok().encode('1234567');
      expect(idsOf(r)).toEqual([130089, 15, 16, 17, 18, 19, 20, 21]);
      expect(Array.from(r.tokens.kind.subarray(1))).toEqual(Array(7).fill(TokenKind.UserDefined));
    });

    it('special-grok1-bos: [BOS] matched under the emulation, the dummy still only at the start', () => {
      const t = tok();
      const s = text('xai-grok1', 'special-grok1-bos');
      expect(idsOf(t.encode(s))).toEqual([1734, 794, 130131, 2917, 130165, 385]);
      const m = t.encode(s, { specialTokens: 'match' });
      expect(idsOf(m)).toEqual([1734, 130089, 1, 385]);
      expect(Array.from(m.chunks.kind)).toEqual([2, 1, 2]); // SpmText, SpecialString, SpmText
      expect(spanOf(m, 2)).toEqual([2, 7]);
    });

    it('the empty string encodes to no tokens; addBos gives BOS alone', () => {
      expect(tok().encode('').tokens.count).toBe(0);
      expect(idsOf(tok().encode('', { addBos: true }))).toEqual([1]);
    });
  });
});
