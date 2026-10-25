/**
 * Simple case-fold closures for expanding `(?i:…)` groups without inline modifiers (PD-5, 04 §2.2 rule 3).
 *
 * The id oracles (Rust `regex` in tiktoken, the Python `regex` module that produced the fixture chunks) match `(?i:x)`
 * against every code point with the same *simple* case folding as `x` — exactly what JavaScript does under the `u`
 * flag (ECMA-262 Canonicalize). The closure of an ASCII letter is therefore its two ASCII cases plus every non-ASCII
 * code point whose simple case folding (Unicode `CaseFolding.txt`, status C or S) is that letter.
 */

/**
 * The folding table: every `CaseFolding.txt` entry with status C or S whose source is not ASCII and whose target is an
 * ASCII letter. U+017F LATIN SMALL LETTER LONG S folds to `s`, U+212A KELVIN SIGN to `k`; Unicode's case-folding
 * stability policy keeps this set fixed. `packages/core/test/unicode/fold.test.ts` re-derives it by enumerating every
 * scalar value against the JavaScript engine.
 */
export const NON_ASCII_FOLDS_TO_ASCII: ReadonlyMap<number, number> = new Map([
  [0x017f, 0x73],
  [0x212a, 0x6b],
]);

const isAsciiLetter = (cp: number) => (cp >= 0x41 && cp <= 0x5a) || (cp >= 0x61 && cp <= 0x7a);

/**
 * Every character `(?i:ch)` matches, `ch` first, then its other ASCII case, then the non-ASCII code points that fold to
 * it (in code-point order). Caseless characters (`'`, digits, punctuation) give `[ch]`. Throws for any other cased
 * character, whose closure this table cannot answer (no pattern needs one).
 */
export function caseFoldClosure(ch: string): string[] {
  const cp = ch.codePointAt(0);
  if (cp === undefined || String.fromCodePoint(cp) !== ch)
    throw new RangeError('caseFoldClosure: expected one code point');
  if (!isAsciiLetter(cp)) {
    if (ch.toLowerCase() === ch && ch.toUpperCase() === ch) return [ch];
    throw new RangeError(`caseFoldClosure: no closure for cased non-ASCII U+${cp.toString(16).toUpperCase()}`);
  }
  const lower = cp | 0x20;
  const out = [ch, String.fromCharCode(cp ^ 0x20)];
  for (const [source, target] of NON_ASCII_FOLDS_TO_ASCII) if (target === lower) out.push(String.fromCodePoint(source));
  return out;
}
