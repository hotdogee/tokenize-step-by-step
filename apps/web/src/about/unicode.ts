/**
 * The browser's Unicode level, informationally (AD-4, 04 §8: "pre-tokenizer Unicode 16.0; your browser reports ≈
 * Unicode N"). Probes code points first assigned in each version — U+2FFC (15.1), U+1CC00 (16.0), U+1E6C0 (17.0) —
 * with the engine's own `\p{Assigned}`; the tokenizer itself never uses native property escapes.
 */

/** The pinned pre-tokenizer Unicode version (the oracles' class tables). */
export const PRETOKENIZER_UNICODE = '16.0';

const PROBES: ReadonlyArray<readonly [version: string, char: string]> = [
  ['15.1', '⿼'],
  ['16.0', '\u{1CC00}'],
  ['17.0', '\u{1E6C0}'],
];

/** The newest probed version whose code point the regex engine knows as assigned, or null below 15.1. */
export function detectUnicodeVersion(): string | null {
  let assigned: RegExp;
  try {
    assigned = new RegExp('^\\p{Assigned}$', 'u');
  } catch {
    return null;
  }
  let detected: string | null = null;
  for (const [version, char] of PROBES) {
    if (!assigned.test(char)) break;
    detected = version;
  }
  return detected;
}
