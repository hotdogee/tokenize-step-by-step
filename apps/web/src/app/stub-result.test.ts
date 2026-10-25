import type { TiktokenFixture } from '@tsbs/core';
import { ALIVE, NEVER, TokenFlag } from '@tsbs/core/model/result';
import { describe, expect, it } from 'vitest';
import { SHIPPING_FIXTURES } from './fixtures.test-helper.ts';
import { buildTiktokenResult, DEFAULT_CASE, defaultResult } from './stub-result.ts';

const o200k = SHIPPING_FIXTURES.get('openai-o200k_base') as TiktokenFixture;
const cl100k = SHIPPING_FIXTURES.get('openai-cl100k_base') as TiktokenFixture;
const caseOf = (fixture: TiktokenFixture, name: string) => {
  const found = fixture.cases.find((c) => c.name === name);
  if (found === undefined) throw new Error(name);
  return found;
};

/** Live boundaries at step k (03 §B.2 timeline semantics). */
function liveBoundaries(born: Int32Array, died: Int32Array, k: number): number[] {
  const out: number[] = [];
  for (let b = 0; b < born.length; b++) {
    const bornAt = born[b] ?? NEVER;
    const diedAt = died[b] ?? ALIVE;
    if (bornAt !== NEVER && bornAt <= k && (diedAt === ALIVE || diedAt > k)) out.push(b);
  }
  return out;
}

describe('stub default result (TODO(WP-integration): replaced by fromFixtureCase)', () => {
  it('inlines fixtures/openai-o200k_base.json › zh-tw-tainan verbatim', () => {
    const fixtureCase = caseOf(o200k, 'zh-tw-tainan');
    expect(DEFAULT_CASE.text).toBe(fixtureCase.text);
    expect(DEFAULT_CASE.ids).toEqual(fixtureCase.ids);
    expect(DEFAULT_CASE.chunks).toEqual(fixtureCase.chunks);
    expect(DEFAULT_CASE.merges).toEqual(fixtureCase.merges);
    expect(DEFAULT_CASE.tokens).toEqual(
      fixtureCase.tokens.map(({ id, start, end, partial }) => ({ id, start, end, partial })),
    );
  });

  it('fills the FROZEN tables for 台灣台南 on o200k (4 cp, 12 B, 4 tokens, 8 merges)', () => {
    const result = defaultResult(7);
    expect(result.seq).toBe(7);
    expect(result.stats).toMatchObject({ codePoints: 4, bytes: 12, tokens: 4, partialTokens: 0, mergeSteps: 8 });
    expect([...result.tokens.id]).toEqual([3735, 133072, 3735, 14609]);
    expect([...result.chars.byteStart]).toEqual([0, 3, 6, 9, 12]);
    expect(result.graphemes.count).toBe(4);
    expect([...result.byteToToken]).toEqual([0, 0, 0, 1, 1, 1, 2, 2, 2, 3, 3, 3]);
  });

  it('replays the timeline: step 0 is all bytes, stepCount is the final tokens', () => {
    const result = defaultResult();
    const timeline = result.timeline;
    if (timeline === null) throw new Error('timeline');
    expect(liveBoundaries(timeline.boundaryBorn, timeline.boundaryDied, 0)).toHaveLength(13);
    expect(liveBoundaries(timeline.boundaryBorn, timeline.boundaryDied, timeline.stepCount)).toEqual([0, 3, 6, 9, 12]);
    expect([...timeline.stepResultId]).toEqual([948, 948, 2166, 3735, 3735, 13864, 14609, 133072]);
    expect([...result.tokens.stepFormed]).toEqual([4, 8, 5, 7]);
  });

  it('marks the cl100k partial token of 灣 (E7 81 + A3) like fromFixtureCase will', () => {
    const fixtureCase = caseOf(cl100k, 'zh-tw-tainan');
    const result = buildTiktokenResult('openai-cl100k_base', fixtureCase);
    expect(result.stats.partialTokens).toBe(2);
    expect(result.stats.splitChars).toBe(1);
    const flags = [...result.tokens.flags];
    expect(flags.filter((f) => (f & TokenFlag.EndsMidChar) !== 0)).toHaveLength(1);
    expect(flags.filter((f) => (f & TokenFlag.StartsMidChar) !== 0)).toHaveLength(1);
    const timeline = result.timeline;
    if (timeline === null) throw new Error('timeline');
    const finalBounds = liveBoundaries(timeline.boundaryBorn, timeline.boundaryDied, timeline.stepCount);
    expect(finalBounds).toEqual([...result.tokens.byteStart]);
  });
});
