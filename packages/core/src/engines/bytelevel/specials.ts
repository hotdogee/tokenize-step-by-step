/**
 * Special-string matcher (04 §2.1 step 2, §2.4) for `specialTokens: 'match'`: one alternation of the escaped `SPCL` texts in
 * SOURCE order (AD-12), scanned left to right. JavaScript alternation is leftmost-first like Rust `regex`/`fancy_regex`,
 * so at a position where two specials match (one a prefix of the other) the one listed first in the upstream file wins —
 * what tiktoken's `encode(text, allowed_special='all')` does. Each match becomes a `SpecialString` chunk holding one
 * `Special` token; the ordinary text between matches is pre-tokenized on its own (tiktoken applies the pattern to each
 * slice, so `$` and lookaheads see the slice end).
 *
 * The regex is compiled on first use (Llama 4 / Muse has 2,048 specials and most encodes never match them).
 */

/** One special in `SPCL` order. */
export interface SpecialEntry {
  readonly id: number;
  readonly text: string;
}

/** A special match as UTF-16 offsets into the searched text; `id` is the special's token id. */
export interface SpecialMatch {
  readonly start: number;
  readonly end: number;
  readonly id: number;
}

/** In `u` mode only syntax characters may be escaped (`\-` would be a SyntaxError). */
const SYNTAX = /[\\^$.*+?()[\]{}|/]/g;

export class SpecialsMatcher {
  private readonly specials: readonly SpecialEntry[];
  private regex: RegExp | null = null;
  private readonly idOfText = new Map<string, number>();

  constructor(specials: readonly SpecialEntry[]) {
    this.specials = specials.filter((s) => s.text.length > 0);
    for (const s of this.specials) if (!this.idOfText.has(s.text)) this.idOfText.set(s.text, s.id);
  }

  /** Non-overlapping matches in `text`, left to right (leftmost-first among specials starting at the same offset). */
  find(text: string): SpecialMatch[] {
    if (this.specials.length === 0) return [];
    this.regex ??= new RegExp(this.specials.map((s) => s.text.replace(SYNTAX, '\\$&')).join('|'), 'gu');
    const out: SpecialMatch[] = [];
    for (const m of text.matchAll(this.regex)) {
      const id = this.idOfText.get(m[0]);
      if (id !== undefined) out.push({ start: m.index, end: m.index + m[0].length, id });
    }
    return out;
  }
}
