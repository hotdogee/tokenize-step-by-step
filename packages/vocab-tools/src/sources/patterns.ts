/**
 * Upstream pre-tokenizer pattern sources the parsers compare verbatim (03 §C.5). These are the Rust/Python regex
 * sources as published, not the JavaScript expansions (those are WP02's `core/engines/bytelevel/patterns.ts`).
 */

/** tiktoken 0.14.0 `o200k_base()` `pat_str` (tiktoken_ext/openai_public.py at 4e71bbe0); also Muse Glimmer's `Split`. */
export const O200K_PAT_STR = [
  "[^\\r\\n\\p{L}\\p{N}]?[\\p{Lu}\\p{Lt}\\p{Lm}\\p{Lo}\\p{M}]*[\\p{Ll}\\p{Lm}\\p{Lo}\\p{M}]+(?i:'s|'t|'re|'ve|'m|'ll|'d)?",
  "[^\\r\\n\\p{L}\\p{N}]?[\\p{Lu}\\p{Lt}\\p{Lm}\\p{Lo}\\p{M}]+[\\p{Ll}\\p{Lm}\\p{Lo}\\p{M}]*(?i:'s|'t|'re|'ve|'m|'ll|'d)?",
  '\\p{N}{1,3}',
  ' ?[^\\s\\p{L}\\p{N}]+[\\r\\n/]*',
  '\\s*[\\r\\n]+',
  '\\s+(?!\\S)',
  '\\s+',
].join('|');

/** `pat_str` of the legacy Claude `claude.json` (the `claude-legacy` template source, 04 §2.2). */
export const CLAUDE_LEGACY_PAT_STR =
  "'s|'t|'re|'ve|'m|'ll|'d| ?\\p{L}+| ?\\p{N}+| ?[^\\s\\p{L}\\p{N}]+|\\s+(?!\\S)|\\s+";
