/**
 * The case-folding table behind the `(?i:…)` expansion (04 §2.2 rule 3) re-derived from first principles: enumerate
 * every Unicode scalar value and ask the JavaScript engine (`u`-mode simple case folding, the same relation as the id
 * oracles' `(?i:)`) which ones match an ASCII letter case-insensitively. The answer must be exactly ſ → s and K → k.
 */
import { describe, expect, it } from 'vitest';
import { caseFoldClosure, NON_ASCII_FOLDS_TO_ASCII } from '../../src/unicode/fold.ts';

/** Every scalar value except the surrogates, as one string. */
function allScalarValues(): string {
  const parts: string[] = [];
  for (let cp = 0; cp <= 0x10ffff; cp += 0x1000) {
    const chunk: number[] = [];
    for (let c = cp; c < cp + 0x1000 && c <= 0x10ffff; c++) if (c < 0xd800 || c > 0xdfff) chunk.push(c);
    parts.push(String.fromCodePoint(...chunk));
  }
  return parts.join('');
}

describe('case-fold closure (folding table)', () => {
  it('re-derives the non-ASCII folds to ASCII letters by enumeration: exactly U+017F → s and U+212A → k', () => {
    const letters = Array.from('abcdefghijklmnopqrstuvwxyz');
    const derived = new Map<number, number>();
    for (const [ch] of allScalarValues().matchAll(/[a-z]/giu)) {
      const cp = ch.codePointAt(0)!;
      if (cp <= 0x7f) continue;
      const target = letters.find((x) => new RegExp(`^${x}$`, 'iu').test(ch))!;
      derived.set(cp, target.charCodeAt(0));
    }
    expect(derived).toEqual(NON_ASCII_FOLDS_TO_ASCII);
    expect([...derived.keys()]).toEqual([0x017f, 0x212a]);
  });

  it('closes s over ſ (the only non-ASCII code point (?i:s) matches)', () => {
    expect(caseFoldClosure('s')).toEqual(['s', 'S', 'ſ']);
    expect(caseFoldClosure('S')).toEqual(['S', 's', 'ſ']);
    for (const ch of caseFoldClosure('s')) expect(/^s$/iu.test(ch)).toBe(true);
  });

  it('gives the closures the contraction alternatives need', () => {
    expect(['t', 'r', 'e', 'v', 'm', 'l', 'd'].map((ch) => caseFoldClosure(ch).join(''))).toEqual([
      'tT',
      'rR',
      'eE',
      'vV',
      'mM',
      'lL',
      'dD',
    ]);
    expect(caseFoldClosure('k')).toEqual(['k', 'K', 'K']);
  });

  it('keeps caseless characters as they are and refuses cased non-ASCII ones', () => {
    expect(caseFoldClosure("'")).toEqual(["'"]);
    expect(caseFoldClosure('1')).toEqual(['1']);
    expect(caseFoldClosure('台')).toEqual(['台']);
    expect(() => caseFoldClosure('ſ')).toThrow(RangeError);
    expect(() => caseFoldClosure('é')).toThrow(RangeError);
    expect(() => caseFoldClosure('ab')).toThrow(RangeError);
  });
});
