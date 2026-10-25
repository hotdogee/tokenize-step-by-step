/**
 * Both byte-fallback orders are implemented literally (AD-6, 04 §3.3): HF's before-merge (Gemma 4) and SentencePiece's
 * after-merge (Grok-1, Gemma 2). Every spm tokenizer, run with its own and with the other order, must produce identical
 * ids on every fixture case in both special-token modes, so a regression in either order is caught on all three assets.
 */
import { describe, expect, it } from 'vitest';
import { checkInvariants, StepKind } from '../../../src/index.ts';
import { spmFixture } from '../../helpers/fixtures.ts';
import { BUILT, idsOf, otherOrderTokenizer, SKIP_REASON, SPM_IDS, spmTokenizer } from './helpers.ts';

describe.skipIf(!BUILT)(`spm byte-fallback orders agree${SKIP_REASON}`, () => {
  it.each(SPM_IDS)('%s: before-merge ≡ after-merge ids on every case', (id) => {
    const own = spmTokenizer(id);
    const other = otherOrderTokenizer(id);
    let splitSteps = 0;
    for (const c of spmFixture(id).cases) {
      for (const specialTokens of ['as-text', 'match'] as const) {
        const a = own.encode(c.text, { specialTokens });
        const b = other.encode(c.text, { specialTokens });
        expect(idsOf(b), `${c.name} (${specialTokens})`).toEqual(idsOf(a));
        expect(checkInvariants(b), c.name).toEqual([]);
        for (const r of [a, b]) {
          const tl = r.timeline!;
          for (let i = 0; i < tl.stepCount; i++) if (tl.stepKind[i] === StepKind.ByteFallbackSplit) splitSteps++;
        }
      }
    }
    // Exactly one of the two orders records splits, and the corpus has byte-fallback characters for every asset.
    expect(splitSteps).toBeGreaterThan(0);
  });
});
