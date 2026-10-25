/**
 * The NFKC segment source map (03 §B.4): exact on all 152 `normalizedNFKC` cases of anthropic-claude-legacy, with the cut
 * rule from the exported Unicode tables (ccc = 0 and NFKC_QC = Yes).
 */
import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { nfkcSegmentStart, nfkcWithSourceMap, type NfkcSourceMap } from '../src/index.ts';
import { tiktokenFixture, unicodeTables } from './helpers/fixtures.ts';
import { RUNS } from './helpers/runs.ts';

const cut = nfkcSegmentStart(unicodeTables().normalization);

/** The run map is well-formed and each run's output is exactly its input slice normalized. */
function expectExactMap(input: string, map: NfkcSourceMap): void {
  const inCps = Array.from(input);
  const outCps = Array.from(map.text);
  expect(map.sourceRunStart).toHaveLength(outCps.length);
  expect(map.sourceRunEnd).toHaveLength(outCps.length);
  let i = 0;
  let lastEnd = 0;
  while (i < outCps.length) {
    const start = map.sourceRunStart[i] ?? -1;
    const end = map.sourceRunEnd[i] ?? -1;
    expect(start).toBeGreaterThanOrEqual(lastEnd);
    expect(end).toBeGreaterThan(start);
    let j = i;
    while (j < outCps.length && map.sourceRunStart[j] === start) {
      expect(map.sourceRunEnd[j]).toBe(end);
      j++;
    }
    expect(outCps.slice(i, j).join('')).toBe(inCps.slice(start, end).join('').normalize('NFKC'));
    lastEnd = end;
    i = j;
  }
  expect(lastEnd).toBeLessThanOrEqual(inCps.length);
}

describe('NFKC segment source map', () => {
  const fixture = tiktokenFixture('anthropic-claude-legacy');
  const inputs = new Map(fixture.cases.map((c) => [c.name, c.text]));
  const normalized = fixture.normalizedNFKC ?? [];

  it('covers the 152 normalizedNFKC cases', () => {
    expect(normalized).toHaveLength(152);
  });

  it.each(normalized.map((c) => [c.name, c.text] as const))(
    '%s: segments concatenate to the fixture text',
    (name, text) => {
      const input = inputs.get(name) ?? '';
      const map = nfkcWithSourceMap(input, cut);
      expect(map.exact).toBe(true);
      expect(map.text).toBe(text);
      expect(map.changed).toBe(true);
      expectExactMap(input, map);
    },
  );

  it('maps many-to-one and one-to-many runs', () => {
    const dakuten = nfkcWithSourceMap('ﾀﾞ', cut);
    expect(dakuten.text).toBe('ダ');
    expect(Array.from(dakuten.sourceRunStart)).toEqual([0]);
    expect(Array.from(dakuten.sourceRunEnd)).toEqual([2]);
    // ㍻ has NFKC_QC = No, so no segment starts before it: it shares the run of the preceding 'a'.
    const heisei = nfkcWithSourceMap('a㍻b', cut);
    expect(heisei.text).toBe('a平成b');
    expect(Array.from(heisei.sourceRunStart)).toEqual([0, 0, 0, 2]);
    expect(Array.from(heisei.sourceRunEnd)).toEqual([2, 2, 2, 3]);
    const alone = nfkcWithSourceMap('㍻', cut);
    expect(Array.from(alone.sourceRunStart)).toEqual([0, 0]);
    expect(Array.from(alone.sourceRunEnd)).toEqual([1, 1]);
  });

  it('is exact on random strings and degrades to one segment without a cut rule', () => {
    const pieces = fc.constantFrom(
      'ﾀ',
      'ﾞ',
      'ｆ',
      '１',
      '㍻',
      'e',
      '\u0301',
      'ガ',
      '\u3099',
      'ﬁ',
      '①',
      ' ',
      'Å',
      'ｶ',
      '\u00a0',
    );
    fc.assert(
      fc.property(fc.array(pieces, { maxLength: 16 }), (parts) => {
        const input = parts.join('');
        const map = nfkcWithSourceMap(input, cut);
        expect(map.text).toBe(input.normalize('NFKC'));
        expect(map.exact).toBe(true);
        expectExactMap(input, map);
        const coarse = nfkcWithSourceMap(input, null);
        expect(coarse.segments).toBe(input.length > 0 ? 1 : 0);
        expectExactMap(input, coarse);
      }),
      { numRuns: RUNS },
    );
  });
});
