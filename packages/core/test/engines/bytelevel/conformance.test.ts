/**
 * WP05A acceptance: Engine A over the BUILT assets passes `@tsbs/conformance`'s `runFixture` on every case of the six
 * byte-level fixtures — ids, token spans/bytes/flags, `chunks` (incl. the ten discriminating cases and cl100k's
 * fuzz-031/062/086), `merges` (directHit, steps replayed to offsets with fixture rank === stepResultId === stepRank),
 * `stats.splitChars`, the 03 §B.3 invariants, `encode() ≡ encodeIncremental()`, `idsWithSpecials` under
 * `specialTokens: 'match'`, `addBos` for Llama 3 / Llama 4, and the 152 `normalizedNFKC` cases of legacy Claude.
 */
import { formatReport, runFixture } from '@tsbs/conformance';
import { describe, expect, it } from 'vitest';
import { StepKind } from '../../../src/index.ts';
import { BYTELEVEL_IDS, fixtureOf, SKIP_REASON, tokenizerFor } from './assets.ts';

/** The ten whitespace / contraction discriminators WP00 added (04 §2.2), present in every byte-level fixture. */
const DISCRIMINATORS = [
  'ws-bom-mid',
  'nel-after-space',
  'nel-before-letter',
  'fs-control',
  'fs-before-letter',
  'contraction-upper',
  'contraction-long-s',
  'contraction-dont-upper',
  'contraction-upper-run',
  'contraction-long-s-run',
];

describe.skipIf(SKIP_REASON !== null)('runFixture on the built assets', () => {
  it.each(BYTELEVEL_IDS)('%s passes every fixture case', (id) => {
    const fixture = fixtureOf(id);
    const tokenizer = tokenizerFor(id);
    const report = runFixture(fixture, tokenizer);
    tokenizer.dispose();
    expect(report.ok, formatReport(report)).toBe(true);
    expect(report.cases).toBe(fixture.cases.length + (fixture.normalizedNFKC?.length ?? 0));
    console.info(`[conformance] ${formatReport(report)}`);
  });
});

describe.skipIf(SKIP_REASON !== null)('named acceptance cases', () => {
  it.each(BYTELEVEL_IDS)('%s: the discriminating chunk cases (and cl100k fuzz-031/062/086) pass on their own', (id) => {
    const names =
      id === 'openai-cl100k_base' ? [...DISCRIMINATORS, 'fuzz-031', 'fuzz-062', 'fuzz-086'] : DISCRIMINATORS;
    const report = runFixture(fixtureOf(id), tokenizerFor(id), { cases: names });
    expect(report.cases).toBeGreaterThanOrEqual(names.length);
    expect(report.ok, formatReport(report)).toBe(true);
  });

  it.each(BYTELEVEL_IDS)('%s: every idsWithSpecials case matches under specialTokens: match', (id) => {
    const tokenizer = tokenizerFor(id);
    const cases = fixtureOf(id).cases.filter((c) => c.idsWithSpecials !== undefined);
    expect(cases.length).toBeGreaterThan(0);
    for (const c of cases) {
      expect(Array.from(tokenizer.encode(c.text, { specialTokens: 'match' }).tokens.id), c.name).toEqual(
        c.idsWithSpecials,
      );
      expect(Array.from(tokenizer.encode(c.text).tokens.id), c.name).toEqual(c.ids);
    }
  });

  it.each(BYTELEVEL_IDS)('%s: fixture directHit flags and merge ranks (= token ids) agree chunk by chunk', (id) => {
    const tokenizer = tokenizerFor(id);
    let steps = 0;
    for (const c of fixtureOf(id).cases) {
      const r = tokenizer.encode(c.text);
      const t = r.timeline!;
      for (const m of c.merges) {
        expect(r.chunks.directHit[m.chunk] === 1, `${c.name} chunk ${String(m.chunk)}`).toBe(m.directHit);
      }
      const ranks = c.merges.flatMap((m) => m.steps.map(([, rank]) => rank));
      const recorded = Array.from({ length: t.stepCount }, (_, i) => {
        expect(t.stepKind[i]).toBe(StepKind.Merge);
        expect(t.stepRank[i]).toBe(t.stepResultId[i]);
        return t.stepResultId[i];
      });
      expect(recorded, c.name).toEqual(ranks);
      steps += recorded.length;
    }
    expect(steps).toBeGreaterThan(1000);
  });
});
