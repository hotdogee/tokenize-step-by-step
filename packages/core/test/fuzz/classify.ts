/**
 * Classification of an `oracle-divergence` (PA-9: the Python oracle and a second opinion disagree; never our failure).
 * Every divergence gets a class with a sentence of explanation, decided on the minimal repro when the shrinker found one;
 * `unclassified` means "triage by hand" and fails the run (07 §2 WP12: every divergence is classified). Classes:
 *
 * - `gemma3-literal-special` / `hf-vs-spm-tie-break` — Gemma 4: HF tokenizers on the JSON vs sentencepiece on the
 *   Gemma 3 model, explained by a Gemma 3 USER_DEFINED literal in the text (fuzz_oracle.py's `crossNote`, the fixture
 *   lane's `_gemma_disagreement`) or not — the latter is the ordering class of 07 §5 risk 2 (04 §8 surfaces it);
 * - `special-string` — the text contains one of the tokenizer's special-token strings and the second opinion cannot
 *   treat it as text the way the fixture policy does;
 * - `js-whitespace-class` — a JavaScript-regex second opinion and a code point where JavaScript's `\s` differs from
 *   `\p{White_Space}` (U+0085, U+FEFF; the port rule of 04 §2.2);
 * - `unicode-version` — a code point whose class differs between Unicode 16.0 (the id oracles, our tables) and the
 *   second opinion's Unicode (Node's native `\p{…}`, or the Python `regex` module per `unicode_tables.json` `regexModule`);
 * - `case-fold` — a contraction with `ſ` / U+212A, folded differently by the second opinion's `(?i:)`;
 * - `opinion-error` — the second opinion threw on the text (a limitation of that library; the oracle answered).
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import process from 'node:process';
import { classRanges, type UnicodeClass, UNICODE_CLASSES } from '../../src/unicode/classes.ts';
import { inRanges } from '../../src/unicode/ranges.ts';
import { REPO_ROOT } from '../helpers/repo.ts';

export const DIVERGENCE_CLASSES = [
  'gemma3-literal-special',
  'hf-vs-spm-tie-break',
  'special-string',
  'js-whitespace-class',
  'unicode-version',
  'case-fold',
  'opinion-error',
  'unclassified',
] as const;
export type DivergenceClass = (typeof DIVERGENCE_CLASSES)[number];

/** Which Unicode / regex engine the second opinion's pre-tokenizer runs on. */
export type OpinionEngine =
  | 'node-regex' // gpt-tokenizer, @huggingface/tokenizers: JavaScript RegExp (Node's ICU Unicode, JS `\s`)
  | 'python-regex' // oracles.bpe_reference: the Python `regex` module (Unicode 18, regexModule in unicode_tables.json)
  | 'unicode-16' // HF tokenizers (Oniguruma) or SentencePiece references: same Unicode as the oracle
  | 'gemma3-spm'; // Gemma 4 cross-check: sentencepiece on the Gemma 3 model

/** What the classifier knows about one divergence. */
export interface DivergenceInput {
  /** The text it is decided on (the minimal repro when there is one). */
  readonly text: string;
  readonly engine: OpinionEngine;
  /** The tokenizer's special-token strings (engine `info.specials`). */
  readonly specials: readonly string[];
  /** fuzz_oracle.py's `crossNote` for the Gemma 3 cross-check, when it explained the difference. */
  readonly crossNote?: string | null;
}

export interface Classification {
  readonly class: DivergenceClass;
  readonly explanation: string;
}

const hex = (cp: number): string => `U+${cp.toString(16).toUpperCase().padStart(4, '0')}`;

/** Membership in `[first, last]` pairs (the JSON form of `unicode_tables.json`). */
function inPairs(ranges: ReadonlyArray<readonly [number, number]>, cp: number): boolean {
  let lo = 0;
  let hi = ranges.length - 1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    const range = ranges[mid];
    if (range === undefined) return false;
    if (cp < range[0]) hi = mid - 1;
    else if (cp > range[1]) lo = mid + 1;
    else return true;
  }
  return false;
}

/** Native `\p{…}` probes for the pinned classes (`White_Space` as the property, not JavaScript's `\s`). */
const NATIVE: Readonly<Record<UnicodeClass, RegExp>> = {
  L: /^\p{L}$/u,
  Lu: /^\p{Lu}$/u,
  Ll: /^\p{Ll}$/u,
  Lt: /^\p{Lt}$/u,
  Lm: /^\p{Lm}$/u,
  Lo: /^\p{Lo}$/u,
  M: /^\p{M}$/u,
  N: /^\p{N}$/u,
  White_Space: /^\p{White_Space}$/u,
};
const JS_SPACE = /^\s$/u;

/** The first code point of `text` whose Node-native class differs from the pinned Unicode 16.0 tables, or null. */
export function nativeUnicodeDifference(text: string): string | null {
  for (const ch of text) {
    const cp = ch.codePointAt(0) ?? 0;
    for (const name of UNICODE_CLASSES) {
      if (NATIVE[name].test(ch) !== inRanges(classRanges(name), cp))
        return `${hex(cp)} is ${NATIVE[name].test(ch) ? '' : 'not '}\\p{${name}} in Node (Unicode ${process.versions['unicode'] ?? '?'}) but ${inRanges(classRanges(name), cp) ? '' : 'not '}in the pinned Unicode 16.0 tables`;
    }
  }
  return null;
}

/** The first code point where JavaScript's `\s` differs from `\p{White_Space}` (pinned), or null. */
export function jsWhitespaceDifference(text: string): string | null {
  const white = classRanges('White_Space');
  for (const ch of text) {
    const cp = ch.codePointAt(0) ?? 0;
    if (JS_SPACE.test(ch) !== inRanges(white, cp))
      return `${hex(cp)} is ${JS_SPACE.test(ch) ? '' : 'not '}matched by JavaScript's \\s but ${inRanges(white, cp) ? 'is' : 'is not'} White_Space (04 §2.2)`;
  }
  return null;
}

interface RegexModuleTables {
  readonly regexModule: {
    readonly unicodeVersion: string;
    readonly assignedLater: ReadonlyArray<readonly [number, number]>;
    readonly categoryChanges: ReadonlyArray<{
      readonly codePoint: number;
      readonly oracle: string;
      readonly regex: string;
    }>;
  };
}

let regexModule: { version: string; later: ReadonlyArray<readonly [number, number]>; changed: Set<number> } | undefined;

/** `tools/oracle/unicode_tables.json` › `regexModule`: where the Python `regex` module differs from Unicode 16.0. */
function regexModuleTables(): NonNullable<typeof regexModule> {
  if (regexModule === undefined) {
    const doc = JSON.parse(
      readFileSync(join(REPO_ROOT, 'tools', 'oracle', 'unicode_tables.json'), 'utf8'),
    ) as RegexModuleTables;
    regexModule = {
      version: doc.regexModule.unicodeVersion,
      later: doc.regexModule.assignedLater,
      changed: new Set(doc.regexModule.categoryChanges.map((change) => change.codePoint)),
    };
  }
  return regexModule;
}

/** The first code point the Python `regex` module classifies differently from Unicode 16.0, or null. */
export function pythonRegexDifference(text: string): string | null {
  const tables = regexModuleTables();
  for (const ch of text) {
    const cp = ch.codePointAt(0) ?? 0;
    if (inPairs(tables.later, cp) || tables.changed.has(cp))
      return `${hex(cp)} is assigned or re-categorised by the Python regex module (Unicode ${tables.version}) after Unicode 16.0`;
  }
  return null;
}

/** Decides the class of one divergence (see the module comment for the order). */
export function classifyDivergence(input: DivergenceInput): Classification {
  const { text, engine } = input;
  if (engine === 'gemma3-spm') {
    return input.crossNote !== undefined && input.crossNote !== null
      ? { class: 'gemma3-literal-special', explanation: input.crossNote }
      : {
          class: 'hf-vs-spm-tie-break',
          explanation:
            'HF tokenizers (Gemma 4 tokenizer.json, merge ranks) and sentencepiece (Gemma 3 model, piece scores) order equal-priority merges differently; no Gemma 3 USER_DEFINED literal is involved (07 §5 risk 2; 04 §8).',
        };
  }
  const special = input.specials.find((s) => s !== '' && text.includes(s));
  if (special !== undefined)
    return {
      class: 'special-string',
      explanation: `the text contains the special-token string ${JSON.stringify(special)}`,
    };
  if (engine === 'node-regex') {
    const space = jsWhitespaceDifference(text);
    if (space !== null) return { class: 'js-whitespace-class', explanation: space };
    const unicode = nativeUnicodeDifference(text);
    if (unicode !== null) return { class: 'unicode-version', explanation: unicode };
  }
  if (engine === 'python-regex') {
    const unicode = pythonRegexDifference(text);
    if (unicode !== null) return { class: 'unicode-version', explanation: unicode };
  }
  if (/['’][\s\S]*[ſ\u212a]|[ſ\u212a][\s\S]*'/u.test(text))
    return {
      class: 'case-fold',
      explanation: 'a contraction with ſ / U+212A: the second opinion folds (?i:) differently from tiktoken/Rust regex',
    };
  return { class: 'unclassified', explanation: 'no known cause found on the minimal repro: triage by hand' };
}
