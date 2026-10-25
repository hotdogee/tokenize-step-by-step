/**
 * Text analysis (04 §4): UTF-8 with TextEncoder/TextDecoder semantics, code point / UTF-16 / byte offsets, lone
 * surrogates → U+FFFD, graphemes via Intl.Segmenter and the fallback path, stand-ins.
 */
import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import {
  analyzeText,
  decodeUtf8,
  encodeUtf8,
  isCombiningMark,
  isUnpairedSurrogateAt,
  isValidUtf8,
  isWhiteSpace,
  standInFor,
  standInGlyph,
  type GraphemeSegmenterLike,
} from '../src/index.ts';
import { unicodeTables } from './helpers/fixtures.ts';
import { RUNS } from './helpers/runs.ts';

const encoder = new TextEncoder();
const strict = new TextDecoder('utf-8', { fatal: true, ignoreBOM: true });

/** Strings weighted to CJK, emoji, whitespace, controls and unpaired surrogates. */
const unicodeString = fc
  .array(
    fc.oneof(
      fc.string({ unit: 'grapheme', maxLength: 4 }),
      fc.constantFrom('台', '灣', '👩‍👩‍👧', '🇹🇼', '\u0085', '\ufeff', '\u3000', ' ', '\t', '\n', 'カ\u3099', '葛\u{e0100}'),
      fc.integer({ min: 0xd800, max: 0xdfff }).map((u) => String.fromCharCode(u)),
      fc.string({ unit: 'binary', maxLength: 6 }),
    ),
    { maxLength: 12 },
  )
  .map((parts) => parts.join(''));

describe('UTF-8 helpers', () => {
  it('encodeUtf8 equals TextEncoder, lone surrogates included', () => {
    fc.assert(
      fc.property(unicodeString, (text) => {
        expect(encodeUtf8(text)).toEqual(encoder.encode(text));
      }),
      { numRuns: RUNS },
    );
  });

  it('decodeUtf8 / isValidUtf8 agree with TextDecoder({ fatal: true, ignoreBOM: true }) on arbitrary bytes', () => {
    fc.assert(
      fc.property(fc.uint8Array({ maxLength: 12 }), (bytes) => {
        let expected: string | null;
        try {
          expected = strict.decode(bytes);
        } catch {
          expected = null;
        }
        expect(decodeUtf8(bytes)).toBe(expected);
        expect(isValidUtf8(bytes)).toBe(expected !== null);
      }),
      { numRuns: RUNS * 5 },
    );
  });

  it('rejects overlongs, surrogates and > U+10FFFF, keeps a BOM', () => {
    expect(isValidUtf8(Uint8Array.from([0xc0, 0x80]))).toBe(false);
    expect(isValidUtf8(Uint8Array.from([0xed, 0xa0, 0x80]))).toBe(false);
    expect(isValidUtf8(Uint8Array.from([0xf4, 0x90, 0x80, 0x80]))).toBe(false);
    expect(isValidUtf8(Uint8Array.from([0xe7, 0x81]))).toBe(false);
    expect(decodeUtf8(Uint8Array.from([0xef, 0xbb, 0xbf, 0x41]))).toBe('\ufeffA');
  });
});

describe('analyzeText', () => {
  it('maps code points, UTF-16 units and bytes consistently', () => {
    fc.assert(
      fc.property(unicodeString, (text) => {
        const a = analyzeText(text);
        expect(a.utf8).toEqual(encoder.encode(text));
        const { count, cp, utf16Start, byteStart } = a.chars;
        expect(utf16Start[count]).toBe(text.length);
        expect(byteStart[count]).toBe(a.utf8.length);
        for (let i = 0; i < count; i++) {
          const unitStart = utf16Start[i] ?? 0;
          const slice = text.slice(unitStart, utf16Start[i + 1]);
          const expectedCp = isUnpairedSurrogateAt(text, unitStart) ? 0xfffd : (slice.codePointAt(0) ?? -1);
          expect(cp[i]).toBe(expectedCp);
          expect(a.utf8.subarray(byteStart[i], byteStart[i + 1])).toEqual(encoder.encode(slice));
          expect(a.utf16ToByte[unitStart]).toBe(byteStart[i]);
          for (let b = byteStart[i] ?? 0; b < (byteStart[i + 1] ?? 0); b++) expect(a.byteToChar[b]).toBe(i);
        }
        expect(a.utf16ToByte[text.length]).toBe(a.utf8.length);
        expect(a.graphemes.charStart[a.graphemes.count]).toBe(count);
      }),
      { numRuns: RUNS },
    );
  });

  it('encodes lone surrogates as U+FFFD (3 bytes) and counts them', () => {
    const a = analyzeText('a\ud800b\udc00');
    expect(Array.from(a.chars.cp)).toEqual([0x61, 0xfffd, 0x62, 0xfffd]);
    expect(Array.from(a.utf8)).toEqual([0x61, 0xef, 0xbf, 0xbd, 0x62, 0xef, 0xbf, 0xbd]);
    expect(a.unpairedSurrogates).toBe(2);
    expect(isUnpairedSurrogateAt('a\ud800b', 1)).toBe(true);
    expect(isUnpairedSurrogateAt('😀', 0)).toBe(false);
    expect(isUnpairedSurrogateAt('😀', 1)).toBe(false);
  });

  it('segments graphemes with Intl.Segmenter', () => {
    const family = analyzeText('👩‍👩‍👧x');
    expect(family.graphemes.source).toBe('segmenter');
    expect(family.graphemes.count).toBe(2);
    expect(family.chars.count).toBe(6);
    expect(Array.from(family.graphemes.charStart)).toEqual([0, 5, 6]);
    expect(Array.from(family.graphemes.byteStart)).toEqual([0, 18, 19]);
    expect(Array.from(family.chars.grapheme)).toEqual([0, 0, 0, 0, 0, 1]);
  });

  it('falls back to one cluster per code point without a segmenter (source = fallback)', () => {
    const a = analyzeText('👩‍👩‍👧x', { segmenter: null });
    expect(a.graphemes.source).toBe('fallback');
    expect(a.graphemes.count).toBe(a.chars.count);
    expect(Array.from(a.graphemes.charStart)).toEqual([0, 1, 2, 3, 4, 5, 6]);
    expect(Array.from(a.graphemes.byteStart)).toEqual(Array.from(a.chars.byteStart));
    expect(Array.from(a.chars.grapheme)).toEqual([0, 1, 2, 3, 4, 5]);
    const empty = analyzeText('', { segmenter: null });
    expect(empty.graphemes.count).toBe(0);
    expect(Array.from(empty.graphemes.charStart)).toEqual([0]);
  });

  it('accepts an injected segmenter', () => {
    const pairs: GraphemeSegmenterLike = {
      *segment(text: string) {
        for (let i = 0; i < text.length; i += 2) yield { index: i };
      },
    };
    const a = analyzeText('abcde', { segmenter: pairs });
    expect(a.graphemes.source).toBe('segmenter');
    expect(Array.from(a.graphemes.charStart)).toEqual([0, 2, 4, 5]);
  });
});

describe('stand-ins', () => {
  it('uses exactly the White_Space set of the exported Unicode 16.0 tables', () => {
    const ranges = unicodeTables().classes['White_Space'] ?? [];
    expect(ranges).toHaveLength(10);
    for (let cp = 0; cp <= 0x3000; cp++) {
      const expected = ranges.some(([first, last]) => cp >= first && cp <= last);
      expect(isWhiteSpace(cp)).toBe(expected);
    }
  });

  it('maps the 05 §4 cases', () => {
    expect(standInFor(0x20)).toBe('space');
    expect(standInFor(0x09)).toBe('tab');
    expect(standInFor(0x0a)).toBe('lf');
    expect(standInFor(0x0d)).toBe('cr');
    expect(standInFor(0xa0)).toBe('nbsp');
    expect(standInFor(0x3000)).toBe('whitespace');
    expect(standInFor(0x85)).toBe('control');
    expect(standInFor(0x1c)).toBe('control');
    expect(standInFor(0xfeff)).toBe('bom');
    expect(standInFor(0x200d)).toBe('zwj');
    expect(standInFor(0x200c)).toBe('zwnj');
    expect(standInFor(0x53f0)).toBeNull();
    expect(standInGlyph('control', 0x85)).toBe('⟨U+0085⟩');
    expect(standInGlyph('space', 0x20)).toBe('␠');
  });

  it('detects combining marks and variation selectors', () => {
    expect(isCombiningMark(0x3099)).toBe(true);
    expect(isCombiningMark(0xfe0f)).toBe(true);
    expect(isCombiningMark(0xe0100)).toBe(true);
    expect(isCombiningMark(0x30ab)).toBe(false);
  });
});
