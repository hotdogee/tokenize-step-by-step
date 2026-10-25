/**
 * `tables.generated.ts` against its source `tools/oracle/unicode_tables.json` (AD-4): every range decodes back exactly,
 * the counts are the design's (677 L / 144 N / 10 White_Space), the file stays ≤ 8 KB brotli, and the normalization
 * tables cut the 152 `normalizedNFKC` texts into segments that normalize independently (03 §B.4).
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { brotliCompressSync, constants } from 'node:zlib';
import { describe, expect, it } from 'vitest';
import type { TiktokenFixture } from '../../src/index.ts';
import { classRanges, UNICODE_CLASSES } from '../../src/unicode/classes.ts';
import { isNfkcSegmentStart, normalizationRanges } from '../../src/unicode/normalization.ts';
import { decodeRanges, inRanges, rangeSize, rangesToClassBody } from '../../src/unicode/ranges.ts';
import { TABLE_VERSIONS, UNICODE_VERSION } from '../../src/unicode/tables.generated.ts';
import { loadFixture, REPO_ROOT } from '../helpers/repo.ts';

interface UnicodeTablesJson {
  unicodeVersion: string;
  versions: Record<string, string>;
  classes: Record<string, Array<[number, number]>>;
  normalization: Record<string, Array<[number, number]>>;
  counts: Record<string, { codePoints: number; ranges: number }>;
}
const json = JSON.parse(readFileSync(join(REPO_ROOT, 'tools/oracle/unicode_tables.json'), 'utf8')) as UnicodeTablesJson;
const TS_PATH = join(REPO_ROOT, 'packages/core/src/unicode/tables.generated.ts');
const pairs = (ranges: Uint32Array) =>
  Array.from({ length: ranges.length / 2 }, (_, i) => [ranges[2 * i], ranges[2 * i + 1]]);

describe('tables.generated.ts ↔ tools/oracle/unicode_tables.json', () => {
  it('records the pinned Unicode version and the oracle library versions', () => {
    expect(UNICODE_VERSION).toBe('16.0.0');
    expect(json.unicodeVersion).toBe(UNICODE_VERSION);
    expect(TABLE_VERSIONS).toEqual(json.versions);
    expect(TABLE_VERSIONS).toMatchObject({ tiktoken: '0.14.0', tokenizers: '0.23.3', regex: '2026.9.29' });
  });

  it.each(UNICODE_CLASSES)('decodes class %s to exactly the JSON ranges', (name) => {
    const ranges = classRanges(name);
    expect(pairs(ranges)).toEqual(json.classes[name]);
    expect(rangeSize(ranges)).toBe(json.counts[name]?.codePoints);
  });

  it.each(['cccNonZero', 'nfkcQcNotYes'] as const)(
    'decodes normalization table %s to exactly the JSON ranges',
    (name) => {
      expect(pairs(normalizationRanges(name))).toEqual(json.normalization[name]);
    },
  );

  it('has the design counts: 677 L, 144 N, 10 White_Space ranges', () => {
    expect(classRanges('L').length / 2).toBe(677);
    expect(classRanges('N').length / 2).toBe(144);
    expect(classRanges('White_Space').length / 2).toBe(10);
  });

  it('stays within 8 KB brotli including the ccc and NFKC_QC tables', () => {
    const source = readFileSync(TS_PATH);
    const size = brotliCompressSync(source, { params: { [constants.BROTLI_PARAM_QUALITY]: 11 } }).length;
    expect(size).toBeLessThanOrEqual(8 * 1024);
  });

  it('defines White_Space as Unicode White_Space, not the JavaScript \\s set (U+0085 in, U+FEFF out)', () => {
    const ws = classRanges('White_Space');
    expect(inRanges(ws, 0x85)).toBe(true);
    expect(inRanges(ws, 0xfeff)).toBe(false);
    for (const cp of [0x1c, 0x1d, 0x1e, 0x1f]) expect(inRanges(ws, cp)).toBe(false);
    for (const cp of [0x09, 0x0a, 0x0d, 0x20, 0xa0, 0x2028, 0x2029, 0x3000]) expect(inRanges(ws, cp)).toBe(true);
  });

  it('pins Unicode 16.0: Garay (16.0) is a letter, CJK Extension J (17.0) is not', () => {
    expect(inRanges(classRanges('L'), 0x10d50)).toBe(true);
    expect(inRanges(classRanges('L'), 0x323b0)).toBe(false);
    expect(inRanges(classRanges('Ll'), 0x0295)).toBe(true); // moved to Lo only in the regex module's Unicode 18
  });

  it('keeps the general categories consistent: L = Lu ∪ Ll ∪ Lt ∪ Lm ∪ Lo', () => {
    const subclasses = (['Lu', 'Ll', 'Lt', 'Lm', 'Lo'] as const).map(classRanges);
    expect(rangeSize(classRanges('L'))).toBe(subclasses.reduce((sum, r) => sum + rangeSize(r), 0));
    const l = classRanges('L');
    for (const ranges of subclasses) {
      for (let i = 0; i < ranges.length; i += 2) {
        expect(inRanges(l, ranges[i]!) && inRanges(l, ranges[i + 1]!)).toBe(true);
      }
    }
  });
});

describe('range helpers', () => {
  it('decodes (gap, span) pairs and rejects an odd count', () => {
    expect(Array.from(decodeRanges([65, 25, 6, 25]))).toEqual([65, 90, 97, 122]);
    expect(() => decodeRanges([1])).toThrow(RangeError);
  });

  it('answers membership at range edges', () => {
    const ranges = decodeRanges([10, 0, 9, 5]); // [10,10] [20,25]
    expect([9, 10, 11, 19, 20, 25, 26].map((cp) => inRanges(ranges, cp))).toEqual([
      false,
      true,
      false,
      false,
      true,
      true,
      false,
    ]);
    expect(inRanges(new Uint32Array(0), 0)).toBe(false);
  });

  it('writes class bodies with \\u{…} escapes only', () => {
    expect(rangesToClassBody(decodeRanges([45, 0, 47, 0, 0x1f600 - 94, 1]))).toBe(
      '\\u{2d}\\u{5d}\\u{1f600}-\\u{1f601}',
    );
    const re = new RegExp(`^[${rangesToClassBody(decodeRanges([45, 0, 47, 0]))}]$`, 'u');
    expect(['-', ']', '^'].map((ch) => re.test(ch))).toEqual([true, true, false]);
  });
});

describe('NFKC segment cut points (03 §B.4)', () => {
  /** Normalizes `text` segment by segment, cutting before every code point with ccc = 0 and NFKC_QC = Yes. */
  const segmentwise = (text: string) => {
    const cps = Array.from(text);
    let out = '';
    let segment = '';
    for (const ch of cps) {
      if (segment !== '' && isNfkcSegmentStart(ch.codePointAt(0)!)) {
        out += segment.normalize('NFKC');
        segment = '';
      }
      segment += ch;
    }
    return out + segment.normalize('NFKC');
  };

  it('normalizes every claude-legacy normalizedNFKC case identically per segment', () => {
    const fixture = loadFixture('anthropic-claude-legacy') as TiktokenFixture;
    const variants = fixture.normalizedNFKC ?? [];
    expect(variants).toHaveLength(152);
    const inputs = new Map(fixture.cases.map((c) => [c.name, c.text]));
    for (const variant of variants) {
      const input = inputs.get(variant.name)!;
      expect(segmentwise(input), variant.name).toBe(variant.text);
      expect(input.normalize('NFKC')).toBe(variant.text);
    }
  });

  it('never cuts before a combining mark, a composition partner or a compatibility character', () => {
    expect(isNfkcSegmentStart(0x61)).toBe(true); // a
    expect(isNfkcSegmentStart(0x0301)).toBe(false); // combining acute (ccc 230)
    expect(isNfkcSegmentStart(0xff9e)).toBe(false); // halfwidth dakuten (NFKC_QC = No)
    expect(isNfkcSegmentStart(0x3099)).toBe(false); // combining dakuten (ccc 8)
    expect(isNfkcSegmentStart(0x1161)).toBe(false); // Hangul V jamo (NFKC_QC = Maybe)
    expect(isNfkcSegmentStart(0x337b)).toBe(false); // ㍻ (NFKC_QC = No)
  });
});
