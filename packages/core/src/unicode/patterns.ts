/**
 * Pre-tokenizer pattern templates of the byte-level tokenizers, verbatim from docs/design/04-engines.md §2.2 (the table
 * escapes `|` as `\|` for Markdown; here it is a plain `|`).
 *
 * Placeholders: `{L} {Lu} {Ll} {Lt} {Lm} {Lo} {M} {N}` (general categories) and `{WS}` (`White_Space`, what `\s` means
 * upstream) always stand inside a `[…]` class and become the pinned Unicode 16.0 ranges (or native `\p{…}` in the
 * parity mode); `{CONTR}` is the case-folded contraction group derived from {@link CONTRACTION_SOURCE} (`expand.ts`).
 * `{CONTR}` is substituted as ONE atom, `(?:'(?:…))`: o200k quantifies it with `?`, and a textual substitution of
 * `'(?:…)` would make the apostrophe mandatory.
 */

/** Template key; the engine registry maps tokenizers to keys (04 §2.2 "Used by"). */
export type PatternKey = 'o200k' | 'cl100k' | 'llama3' | 'grok2-v1' | 'claude-legacy';

/** Every key, in the order of the design table. */
export const PATTERN_KEYS: readonly PatternKey[] = ['o200k', 'cl100k', 'llama3', 'grok2-v1', 'claude-legacy'];

/** Templates before class substitution (04 §2.2). */
export const PATTERN_TEMPLATES: Readonly<Record<PatternKey, string>> = {
  // o200k_base; llama4-muse (byte-identical upstream, research §3.4)
  o200k: String.raw`[^\r\n{L}{N}]?[{Lu}{Lt}{Lm}{Lo}{M}]*[{Ll}{Lm}{Lo}{M}]+{CONTR}?|[^\r\n{L}{N}]?[{Lu}{Lt}{Lm}{Lo}{M}]+[{Ll}{Lm}{Lo}{M}]*{CONTR}?|[{N}]{1,3}| ?[^{WS}{L}{N}]+[\r\n/]*|[{WS}]*[\r\n]+|[{WS}]+(?![^{WS}])|[{WS}]+`,
  // cl100k_base, current tiktoken pattern (possessive quantifiers upstream, dropped per rule 4)
  cl100k: String.raw`'(?:[sSſdDmMtT]|[lL][lL]|[vV][eE]|[rR][eE])|[^\r\n{L}{N}]?[{L}]+|[{N}]{1,3}| ?[^{WS}{L}{N}]+[\r\n]*|[{WS}]+$|[{WS}]*[\r\n]|[{WS}]+(?![^{WS}])|[{WS}]`,
  // llama3 (= pre-0.8.0 cl100k)
  llama3: String.raw`{CONTR}|[^\r\n{L}{N}]?[{L}]+|[{N}]{1,3}| ?[^{WS}{L}{N}]+[\r\n]*|[{WS}]*[\r\n]+|[{WS}]+(?![^{WS}])|[{WS}]+`,
  // grok2 (SGLang V1): as llama3 with a single digit per chunk
  'grok2-v1': String.raw`{CONTR}|[^\r\n{L}{N}]?[{L}]+|[{N}]| ?[^{WS}{L}{N}]+[\r\n]*|[{WS}]*[\r\n]+|[{WS}]+(?![^{WS}])|[{WS}]+`,
  // claude-legacy (claude.json pat_str, case-sensitive contractions)
  'claude-legacy': String.raw`'s|'t|'re|'ve|'m|'ll|'d| ?[{L}]+| ?[{N}]+| ?[^{WS}{L}{N}]+|[{WS}]+(?![^{WS}])|[{WS}]+`,
};

/** The upstream group `{CONTR}` stands for (tiktoken o200k_base, llama3 `tokenizer.py`, SGLang `V1`). */
export const CONTRACTION_SOURCE = String.raw`(?i:'s|'t|'re|'ve|'m|'ll|'d)`;
