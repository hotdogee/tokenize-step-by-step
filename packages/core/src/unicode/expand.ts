/**
 * Pattern expander (04 §2.2): turns the templates of `patterns.ts` into JavaScript regexes with the pinned Unicode 16.0
 * classes, and ports upstream Rust/Python `regex` syntax to the template form.
 *
 * Porting rules implemented by {@link portPattern} (04 §2.2):
 * 1. `\s` → `[{WS}]`, `\S` → `[^{WS}]` (`White_Space`, not the JavaScript `\s` set, which adds U+FEFF and lacks U+0085).
 * 2. `\p{X}` → `[{X}]` outside a class, `{X}` inside one; the classes are substituted later, never native `\p{…}`.
 * 3. `(?i:…)` → an alternation of case-fold closures from the folding table (`fold.ts`), e.g. `(?i:'s)` →
 *    `'[sSſ]`; a literal shared by every alternative is hoisted. No inline modifiers survive (PD-5).
 * 4. Possessive quantifiers (`?+ *+ ++ {m,n}+`) → greedy (equivalent in these patterns, see the design).
 * 5. The compiled regex uses the flags `gu` (never `v`); each top-level alternative is also compiled alone with `uy` for
 *    the in-context rule detection of {@link ruleAt}.
 */
import { classBody, type UnicodeClass } from './classes.ts';
import { caseFoldClosure } from './fold.ts';
import { CONTRACTION_SOURCE, PATTERN_TEMPLATES, type PatternKey } from './patterns.ts';

/** `pinned16`: the generated Unicode 16.0 ranges (production). `native`: `\p{…}` of the running engine (parity runs). */
export type UnicodeMode = 'pinned16' | 'native';

/** A template placeholder: a class name, `WS` (`White_Space`) or `CONTR` (the contraction group). */
export type Placeholder = 'L' | 'Lu' | 'Ll' | 'Lt' | 'Lm' | 'Lo' | 'M' | 'N' | 'WS' | 'CONTR';

/** `ruleAt` result when no alternative matches the chunk exactly (an engine bug; the chunk itself is still valid). */
export const NO_RULE = 255;

/** A compiled pre-tokenizer pattern. `regex` is stateful (`g`): callers set `lastIndex` before every scan. */
export interface CompiledPattern {
  readonly key: PatternKey;
  readonly mode: UnicodeMode;
  /** Expanded regex source. */
  readonly source: string;
  /** The whole pattern, flags `gu`. */
  readonly regex: RegExp;
  /** Each top-level alternative alone, flags `uy` (index = rule number). */
  readonly alternatives: readonly RegExp[];
}

const CATEGORIES: ReadonlySet<string> = new Set(['L', 'Lu', 'Ll', 'Lt', 'Lm', 'Lo', 'M', 'N']);
const PLACEHOLDERS: ReadonlySet<string> = new Set([...CATEGORIES, 'WS', 'CONTR']);
const PLACEHOLDER_RE = /\{([A-Za-z_]\w*)\}/g;
const QUANTIFIER_BRACES = /^\{\d+(?:,\d*)?\}/;

class PatternSyntaxError extends Error {
  constructor(source: string, index: number, reason: string) {
    super(`unsupported pattern syntax at ${String(index)} (${reason}) in ${source}`);
    this.name = 'PatternSyntaxError';
  }
}

/** Index one past the `]` closing the class that opens at `open`. */
function classEnd(src: string, open: number): number {
  for (let i = open + 1; i < src.length; i++) {
    const ch = src.charAt(i);
    if (ch === '\\') i++;
    else if (ch === '[') throw new PatternSyntaxError(src, i, 'nested class');
    else if (ch === ']') return i + 1;
  }
  throw new PatternSyntaxError(src, open, 'unterminated class');
}

/** Index one past the `)` closing the group that opens at `open`. */
function groupEnd(src: string, open: number): number {
  let depth = 0;
  for (let i = open; i < src.length; i++) {
    const ch = src.charAt(i);
    if (ch === '\\') i++;
    else if (ch === '[') i = classEnd(src, i) - 1;
    else if (ch === '(') depth++;
    else if (ch === ')' && --depth === 0) return i + 1;
  }
  throw new PatternSyntaxError(src, open, 'unterminated group');
}

/** Length of the escape starting at `at` (`\p{X}` or a single escaped character). */
function escapeLength(src: string, at: number): number {
  const kind = src.charAt(at + 1);
  if (kind === 'p' || kind === 'P') {
    const close = src.indexOf('}', at);
    if (src.charAt(at + 2) !== '{' || close < 0) throw new PatternSyntaxError(src, at, 'malformed \\p');
    return close - at + 1;
  }
  if (kind === 'x' || kind === 'u' || kind === 'c' || /\d/.test(kind))
    throw new PatternSyntaxError(src, at, `\\${kind}`);
  return 2;
}

/** Translates one escape; `inClass` selects the class-body form. */
function portEscape(src: string, at: number, inClass: boolean): string {
  const token = src.slice(at, at + escapeLength(src, at));
  if (token.startsWith('\\p{')) {
    const name = token.slice(3, -1);
    if (!CATEGORIES.has(name)) throw new PatternSyntaxError(src, at, `class ${name}`);
    return inClass ? `{${name}}` : `[{${name}}]`;
  }
  if (token === '\\s') return inClass ? '{WS}' : '[{WS}]';
  if (token === '\\S' && !inClass) return '[^{WS}]';
  if (/^\\[SdDwWbBP]/.test(token)) throw new PatternSyntaxError(src, at, `${token} has engine-specific semantics`);
  return token;
}

/** Translates a whole `[…]` class. */
function portClass(src: string, open: number, end: number): string {
  let out = '[';
  for (let i = open + 1; i < end - 1; i++) {
    if (src.charAt(i) === '\\') {
      out += portEscape(src, i, true);
      i += escapeLength(src, i) - 1;
    } else {
      out += src.charAt(i);
    }
  }
  return `${out}]`;
}

const escapeLiteral = (ch: string) => (/[\\^$.|?*+()[\]{}/]/.test(ch) ? `\\${ch}` : ch);
const escapeInClass = (ch: string) => (/[\\\]^-]/.test(ch) ? `\\${ch}` : ch);

/** One atom of a `(?i:…)` body: the characters it matches after case folding. */
type FoldAtom = readonly string[];

const renderAtom = (atom: FoldAtom) =>
  atom.length === 1 ? escapeLiteral(atom[0] ?? '') : `[${atom.map(escapeInClass).join('')}]`;

/** Parses one alternative of a `(?i:…)` body (literals, escaped literals and simple classes) into folded atoms. */
function foldAlternative(src: string, from: number, to: number): FoldAtom[] {
  const atoms: FoldAtom[] = [];
  for (let i = from; i < to; i++) {
    const ch = src.charAt(i);
    if (ch === '[') {
      const end = classEnd(src, i);
      const members = Array.from(src.slice(i + 1, end - 1));
      if (members[0] === '^' || members.includes('-') || members.includes('\\')) {
        throw new PatternSyntaxError(src, i, 'only plain member lists can be case-folded');
      }
      atoms.push([...new Set(members.flatMap(caseFoldClosure))]);
      i = end - 1;
    } else if (ch === '\\') {
      const escaped = src.charAt(i + 1);
      if (/[A-Za-z0-9]/.test(escaped)) throw new PatternSyntaxError(src, i, 'escape inside (?i:)');
      atoms.push([escaped]);
      i++;
    } else if ('()|?*+{.^$'.includes(ch)) {
      throw new PatternSyntaxError(src, i, `${ch} inside (?i:)`);
    } else {
      const cp = src.codePointAt(i) ?? 0;
      const char = String.fromCodePoint(cp);
      atoms.push(caseFoldClosure(char));
      i += char.length - 1;
    }
  }
  return atoms;
}

/** Expands the body of `(?i:…)` (between `from` and `to`) into an inline-modifier-free alternation. */
function foldGroupBody(src: string, from: number, to: number): string {
  const alternatives: FoldAtom[][] = [];
  let start = from;
  for (let i = from; i <= to; i++) {
    if (i === to || src.charAt(i) === '|') {
      alternatives.push(foldAlternative(src, start, i));
      start = i + 1;
    } else if (src.charAt(i) === '\\') {
      i++;
    } else if (src.charAt(i) === '[') {
      i = classEnd(src, i) - 1;
    }
  }
  const first = alternatives[0]?.[0];
  const hoist =
    first?.length === 1 &&
    alternatives.every((alt) => alt.length >= 2 && alt[0]?.length === 1 && alt[0][0] === first[0]);
  if (hoist) {
    return `${renderAtom(first)}(?:${alternatives.map((alt) => alt.slice(1).map(renderAtom).join('')).join('|')})`;
  }
  return alternatives.map((alt) => alt.map(renderAtom).join('')).join('|');
}

/**
 * Ports an upstream Rust/Python `regex` pattern to template syntax (rules 1–4 above). Throws on any construct whose
 * semantics this port does not pin (`\d`, `\w`, `.`, `\P{…}`, nested classes, case folding of ranges …).
 */
export function portPattern(upstream: string): string {
  let out = '';
  let afterQuantifier = false;
  for (let i = 0; i < upstream.length;) {
    const ch = upstream.charAt(i);
    let quantifier = false;
    if (ch === '\\') {
      out += portEscape(upstream, i, false);
      i += escapeLength(upstream, i);
    } else if (ch === '[') {
      const end = classEnd(upstream, i);
      out += portClass(upstream, i, end);
      i = end;
    } else if (upstream.startsWith('(?i:', i)) {
      const end = groupEnd(upstream, i);
      out += `(?:${foldGroupBody(upstream, i + 4, end - 1)})`;
      i = end;
    } else if (ch === '(') {
      const prefix = /^\((?:\?(?::|!|=|<=|<!))?/.exec(upstream.slice(i, i + 4))?.[0] ?? '(';
      if (upstream.charAt(i + 1) === '?' && prefix === '(') throw new PatternSyntaxError(upstream, i, 'group flags');
      out += prefix;
      i += prefix.length;
    } else if (ch === '?' || ch === '*' || ch === '+') {
      if (afterQuantifier && ch === '+') {
        i++; // possessive → greedy (rule 4)
        afterQuantifier = false;
        continue;
      }
      out += ch;
      i++;
      quantifier = !afterQuantifier; // `??` / `+?` are lazy markers, not new quantifiers
    } else if (ch === '{') {
      const braces = QUANTIFIER_BRACES.exec(upstream.slice(i))?.[0];
      if (braces === undefined) throw new PatternSyntaxError(upstream, i, 'literal {');
      out += braces;
      i += braces.length;
      quantifier = true;
    } else if (ch === '.') {
      throw new PatternSyntaxError(upstream, i, '. has engine-specific semantics');
    } else {
      out += ch;
      i++;
    }
    afterQuantifier = quantifier;
  }
  return out;
}

let contraction: string | undefined;

/** The `{CONTR}` atom: {@link CONTRACTION_SOURCE} ported, `(?:'(?:[sSſ]|[tT]|[rR][eE]|[vV][eE]|[mM]|[lL][lL]|[dD]))`. */
export function contractionAtom(): string {
  contraction ??= portPattern(CONTRACTION_SOURCE);
  return contraction;
}

/** Substitutes every placeholder of `template` with `resolve(name)`; throws on an unknown `{Name}`. */
export function expandTemplate(template: string, resolve: (name: Placeholder) => string): string {
  for (const [, name] of template.matchAll(PLACEHOLDER_RE)) {
    if (name === undefined || !PLACEHOLDERS.has(name)) throw new RangeError(`unknown placeholder {${String(name)}}`);
  }
  return template.replace(PLACEHOLDER_RE, (_match, name: string) => resolve(name as Placeholder));
}

function resolver(mode: UnicodeMode): (name: Placeholder) => string {
  return (name) => {
    if (name === 'CONTR') return contractionAtom();
    const cls: UnicodeClass = name === 'WS' ? 'White_Space' : name;
    return mode === 'pinned16' ? classBody(cls) : `\\p{${cls}}`;
  };
}

const sourceCache = new Map<string, string>();

/** The regex source of a template with every placeholder substituted (memoised per key and mode). */
export function expandPattern(key: PatternKey, mode: UnicodeMode = 'pinned16'): string {
  const cacheKey = `${key}\u0000${mode}`;
  let source = sourceCache.get(cacheKey);
  if (source === undefined) {
    source = expandTemplate(PATTERN_TEMPLATES[key], resolver(mode));
    sourceCache.set(cacheKey, source);
  }
  return source;
}

/** Splits a regex source at its top-level `|` (outside groups and classes). */
export function splitAlternatives(source: string): string[] {
  const out: string[] = [];
  let depth = 0;
  let start = 0;
  for (let i = 0; i < source.length; i++) {
    const ch = source.charAt(i);
    if (ch === '\\') i++;
    else if (ch === '[') i = classEnd(source, i) - 1;
    else if (ch === '(') depth++;
    else if (ch === ')') depth--;
    else if (ch === '|' && depth === 0) {
      out.push(source.slice(start, i));
      start = i + 1;
    }
  }
  out.push(source.slice(start));
  return out;
}

/** Compiles a template once per tokenizer load (≈ 1–2 ms): the `gu` regex plus one sticky regex per alternative. */
export function compilePattern(key: PatternKey, mode: UnicodeMode = 'pinned16'): CompiledPattern {
  const source = expandPattern(key, mode);
  return {
    key,
    mode,
    source,
    regex: new RegExp(source, 'gu'),
    alternatives: splitAlternatives(source).map((alt) => new RegExp(alt, 'uy')),
  };
}

/**
 * The rule (top-level alternative index) that produced the chunk `[start, end)` of `segment` (UTF-16 offsets), or
 * {@link NO_RULE}. Each alternative is tried IN CONTEXT on the full segment from `start`: the first one that matches
 * there is the one the leftmost-first `gu` scan took, so its match must end at `end`. Testing the isolated chunk string
 * would be wrong: a lone `' '` before a digit is matched by the final `\s+` in context (`\s+(?!\S)` fails there), but
 * the isolated string satisfies `\s+(?!\S)`.
 */
export function ruleAt(pattern: CompiledPattern, segment: string, start: number, end: number): number {
  for (let rule = 0; rule < pattern.alternatives.length; rule++) {
    const alt = pattern.alternatives[rule];
    if (alt === undefined) break;
    alt.lastIndex = start;
    if (alt.exec(segment) !== null) return alt.lastIndex === end ? rule : NO_RULE;
  }
  return NO_RULE;
}
