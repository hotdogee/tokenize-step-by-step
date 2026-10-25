/**
 * WP05B conformance (04 §7): `@tsbs/conformance`'s `runFixture` on every case of google-gemma4, google-gemma2 and
 * xai-grok1 against the built `.bin` — ids, spans, bytes, partial / zero-width, piece and type (gemma4 on the
 * BYTE / CONTROL / UNK axis, USER_DEFINED → Normal, AD-31), splitChars, the B.3 invariants, `specialTokens: 'match'`
 * against `idsWithSpecials` (incl. the emulated ones of gemma2 / grok1), `addBos`, and `encode() ≡ encodeIncremental()`.
 * A second pass slices the agenda as finely as it can (`budgetMs = 0`: a yield every 256 pops) and still matches.
 */
import { firstDifference, formatReport, runFixture } from '@tsbs/conformance';
import { describe, expect, it } from 'vitest';
import { spmFixture } from '../../helpers/fixtures.ts';
import { BUILT, drain, SKIP_REASON, SPM_IDS, spmTokenizer } from './helpers.ts';

describe.skipIf(!BUILT)(`spm conformance on the built assets${SKIP_REASON}`, () => {
  it.each(SPM_IDS)('%s passes runFixture on every case', (id) => {
    const tokenizer = spmTokenizer(id);
    const fixture = spmFixture(id);
    const report = runFixture(fixture, tokenizer);
    expect(report.ok, formatReport(report)).toBe(true);
    expect(report.cases).toBe(fixture.cases.length);
    tokenizer.dispose();
  });

  it.each(SPM_IDS)('%s: encode ≡ encodeIncremental with the finest slicing, both special modes', (id) => {
    const tokenizer = spmTokenizer(id);
    let sliced = 0;
    for (const c of spmFixture(id).cases) {
      for (const specialTokens of ['as-text', 'match'] as const) {
        const whole = tokenizer.encode(c.text, { specialTokens });
        const { result, yields } = drain(tokenizer, c.text, { specialTokens }, 0);
        expect(firstDifference(whole, result), `${c.name} (${specialTokens})`).toBeNull();
        if (yields > 2) sliced++; // more than the two phase yields: the agenda itself was sliced
      }
    }
    expect(sliced).toBeGreaterThan(0);
    tokenizer.dispose();
  });
});
