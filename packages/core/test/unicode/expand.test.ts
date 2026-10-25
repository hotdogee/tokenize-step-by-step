/**
 * Pattern expander unit tests (04 §2.2): the templates are the design's verbatim, porting every upstream pattern
 * reproduces its template (class substitution, case-fold closure, possessive drop), the compiled regexes have the
 * required flags and no inline modifiers, hand-picked strings chunk exactly as the Python `regex` oracle does, and the
 * rule detection works in context.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  compilePattern,
  contractionAtom,
  expandPattern,
  expandTemplate,
  NO_RULE,
  portPattern,
  ruleAt,
  splitAlternatives,
} from '../../src/unicode/expand.ts';
import { CONTRACTION_SOURCE, PATTERN_KEYS, PATTERN_TEMPLATES, type PatternKey } from '../../src/unicode/patterns.ts';
import { findRawVocabDir, REPO_ROOT } from '../helpers/repo.ts';

/**
 * Upstream patterns, verbatim: tiktoken 0.14.0 `openai_public.py` (o200k_base, cl100k_base — the current, possessive
 * one), meta-llama/llama-models `llama3/tokenizer.py`, SGLang `tiktoken_tokenizer.py` `PAT_STR_B` (Grok-2 `V1`) and
 * `claude.json` `pat_str` (the same strings as `tools/oracle/oracles/tiktoken_family.py`).
 */
const UPSTREAM: Readonly<Record<PatternKey, string>> = {
  o200k: String.raw`[^\r\n\p{L}\p{N}]?[\p{Lu}\p{Lt}\p{Lm}\p{Lo}\p{M}]*[\p{Ll}\p{Lm}\p{Lo}\p{M}]+(?i:'s|'t|'re|'ve|'m|'ll|'d)?|[^\r\n\p{L}\p{N}]?[\p{Lu}\p{Lt}\p{Lm}\p{Lo}\p{M}]+[\p{Ll}\p{Lm}\p{Lo}\p{M}]*(?i:'s|'t|'re|'ve|'m|'ll|'d)?|\p{N}{1,3}| ?[^\s\p{L}\p{N}]+[\r\n/]*|\s*[\r\n]+|\s+(?!\S)|\s+`,
  cl100k: String.raw`'(?i:[sdmt]|ll|ve|re)|[^\r\n\p{L}\p{N}]?+\p{L}++|\p{N}{1,3}+| ?[^\s\p{L}\p{N}]++[\r\n]*+|\s++$|\s*[\r\n]|\s+(?!\S)|\s`,
  llama3: String.raw`(?i:'s|'t|'re|'ve|'m|'ll|'d)|[^\r\n\p{L}\p{N}]?\p{L}+|\p{N}{1,3}| ?[^\s\p{L}\p{N}]+[\r\n]*|\s*[\r\n]+|\s+(?!\S)|\s+`,
  'grok2-v1': String.raw`(?i:'s|'t|'re|'ve|'m|'ll|'d)|[^\r\n\p{L}\p{N}]?\p{L}+|\p{N}| ?[^\s\p{L}\p{N}]+[\r\n]*|\s*[\r\n]+|\s+(?!\S)|\s+`,
  'claude-legacy': String.raw`'s|'t|'re|'ve|'m|'ll|'d| ?\p{L}+| ?\p{N}+| ?[^\s\p{L}\p{N}]+|\s+(?!\S)|\s+`,
};

/** The design's `{CONTR}` (04 §2.2, below the table). */
const DESIGN_CONTR = "'(?:[sSſ]|[tT]|[rR][eE]|[vV][eE]|[mM]|[lL][lL]|[dD])";

/** Templates with `{CONTR}` expanded and the class placeholders kept: what porting the upstream pattern must give. */
const withContraction = (key: PatternKey) =>
  expandTemplate(PATTERN_TEMPLATES[key], (name) => (name === 'CONTR' ? contractionAtom() : `{${name}}`));

describe('templates (04 §2.2)', () => {
  it('are verbatim copies of the design table', () => {
    const doc = readFileSync(join(REPO_ROOT, 'docs/design/04-engines.md'), 'utf8');
    const rowOf = (key: PatternKey) => doc.split('\n').find((line) => line.startsWith(`| \`${key}\` |`)) ?? '';
    for (const key of PATTERN_KEYS.filter((k) => k !== 'grok2-v1')) {
      const cell = /\| `((?:[^`])+)` \|$/.exec(rowOf(key))?.[1];
      expect(cell?.replaceAll('\\|', '|'), key).toBe(PATTERN_TEMPLATES[key]);
    }
    // The design states grok2-v1 in prose: "as `llama3` with `[{N}]` (single digit)".
    expect(rowOf('grok2-v1')).toContain('as `llama3` with `[{N}]` (single digit)');
    expect(PATTERN_TEMPLATES['grok2-v1']).toBe(PATTERN_TEMPLATES.llama3.replace('[{N}]{1,3}', '[{N}]'));
    const contr = /`\{CONTR\}` = `([^`]+)`/.exec(doc)?.[1];
    expect(contr).toBe(DESIGN_CONTR);
  });

  it('derive {CONTR} from the upstream (?i:) group through the folding table', () => {
    expect(CONTRACTION_SOURCE).toBe("(?i:'s|'t|'re|'ve|'m|'ll|'d)");
    expect(contractionAtom()).toBe(`(?:${DESIGN_CONTR})`);
  });

  it.each(PATTERN_KEYS)('%s: porting the upstream pattern reproduces the template', (key) => {
    expect(portPattern(UPSTREAM[key])).toBe(withContraction(key));
  });

  it('agree with the upstream patterns shipped in the raw vocabulary files (when fetched)', () => {
    const dir = findRawVocabDir();
    if (dir === null) return;
    const read = (path: string): unknown => JSON.parse(readFileSync(join(dir, path), 'utf8'));
    const claude = read('anthropic-claude-legacy/claude.json') as { pat_str: string };
    expect(claude.pat_str).toBe(UPSTREAM['claude-legacy']);
    const split = (doc: unknown) =>
      (doc as { pre_tokenizer: { pretokenizers: Array<{ type: string; pattern?: { Regex: string } }> } }).pre_tokenizer
        .pretokenizers[0]?.pattern?.Regex;
    expect(split(read('meta-muse-glimmer/tokenizer.json'))).toBe(UPSTREAM.o200k);
    expect(split(read('meta-llama3-model/xenova/tokenizer.json'))).toBe(UPSTREAM.llama3);
  });
});

describe('portPattern', () => {
  it('maps \\s, \\S and \\p{…} to placeholders inside and outside classes', () => {
    expect(portPattern(String.raw`\s+(?!\S)`)).toBe('[{WS}]+(?![^{WS}])');
    expect(portPattern(String.raw`[^\s\p{L}]\p{N}`)).toBe('[^{WS}{L}][{N}]');
  });

  it('drops possessive quantifiers and keeps lazy ones', () => {
    expect(portPattern(String.raw`a?+b*+c++\p{N}{1,3}+`)).toBe('a?b*c+[{N}]{1,3}');
    expect(portPattern('a+?b??')).toBe('a+?b??');
  });

  it('case-folds (?i:) groups, hoisting a shared literal and keeping the group one atom', () => {
    expect(portPattern("(?i:'s|'t)?")).toBe("(?:'(?:[sSſ]|[tT]))?");
    expect(portPattern("'(?i:[sdmt]|ll)")).toBe("'(?:[sSſdDmMtT]|[lL][lL])");
    expect(portPattern('(?i:x|y)')).toBe('(?:[xX]|[yY])');
  });

  it.each([
    String.raw`\d+`,
    String.raw`\w`,
    'a.b',
    String.raw`\P{L}`,
    String.raw`\p{Han}`,
    '[[a]]',
    '(?i:[a-z])',
    '(?s:a)',
    String.raw`\x41`,
    'a{',
  ])('refuses %s (semantics not pinned by this port)', (pattern) => {
    expect(() => portPattern(pattern)).toThrow(/unsupported pattern syntax/);
  });
});

describe('expandPattern / compilePattern', () => {
  it.each(PATTERN_KEYS)('%s: compiles with flags gu, sticky uy alternatives and no inline modifiers', (key) => {
    const pattern = compilePattern(key);
    expect(pattern.regex.flags).toBe('gu');
    expect(pattern.alternatives.every((alt) => alt.flags === 'uy')).toBe(true);
    expect(pattern.alternatives).toHaveLength(splitAlternatives(PATTERN_TEMPLATES[key]).length);
    expect(pattern.source).not.toMatch(/\(\?[imsx-]+:/);
    expect(pattern.source).not.toMatch(/\{(?:L|Lu|Ll|Lt|Lm|Lo|M|N|WS|CONTR)\}/);
    expect(pattern.source).not.toContain('\\p{');
    expect(expandPattern(key)).toBe(pattern.source);
  });

  it.each(PATTERN_KEYS)('%s: the native mode uses \\p{…} of the running engine', (key) => {
    const pattern = compilePattern(key, 'native');
    expect(pattern.source).toContain('\\p{White_Space}');
    expect([...'Hello 台灣 123'.matchAll(pattern.regex)].map((m) => m[0]).join('')).toBe('Hello 台灣 123');
  });

  it('compiles quickly (≈ 1–2 ms per tokenizer once the class bodies exist)', () => {
    compilePattern('o200k');
    const t0 = performance.now();
    for (const key of PATTERN_KEYS) compilePattern(key).regex.exec('warm up');
    expect((performance.now() - t0) / PATTERN_KEYS.length).toBeLessThan(50);
  });

  it('rejects unknown placeholders', () => {
    expect(() => expandTemplate('[{Han}]', () => '')).toThrow(/unknown placeholder/);
  });
});

/** Chunks of hand-picked strings, produced by the Python `regex` oracle on the UPSTREAM patterns. */
const ORACLE_CHUNKS: ReadonlyArray<readonly [string, Readonly<Record<PatternKey, readonly string[]>>]> = [
  [
    "it'ſ ok",
    {
      o200k: ["it'ſ", ' ok'],
      cl100k: ['it', "'ſ", ' ok'],
      llama3: ['it', "'ſ", ' ok'],
      'grok2-v1': ['it', "'ſ", ' ok'],
      'claude-legacy': ['it', "'", 'ſ', ' ok'],
    },
  ],
  [
    "'ſtill",
    {
      o200k: ["'ſtill"],
      cl100k: ["'ſ", 'till'],
      llama3: ["'ſ", 'till'],
      'grok2-v1': ["'ſ", 'till'],
      'claude-legacy': ["'", 'ſtill'],
    },
  ],
  [
    "HE'S DON'T",
    {
      o200k: ["HE'S", " DON'T"],
      cl100k: ['HE', "'S", ' DON', "'T"],
      llama3: ['HE', "'S", ' DON', "'T"],
      'grok2-v1': ['HE', "'S", ' DON', "'T"],
      'claude-legacy': ['HE', "'", 'S', ' DON', "'", 'T'],
    },
  ],
  [
    'a\u0085 b',
    {
      o200k: ['a', '\u0085', ' b'],
      cl100k: ['a', '\u0085', ' b'],
      llama3: ['a', '\u0085', ' b'],
      'grok2-v1': ['a', '\u0085', ' b'],
      'claude-legacy': ['a', '\u0085', ' b'],
    },
  ],
  [
    'x \u0085y',
    {
      o200k: ['x', ' ', '\u0085y'],
      cl100k: ['x', ' ', '\u0085y'],
      llama3: ['x', ' ', '\u0085y'],
      'grok2-v1': ['x', ' ', '\u0085y'],
      'claude-legacy': ['x', ' ', '\u0085', 'y'],
    },
  ],
  [
    'a \ufeffb',
    {
      o200k: ['a', ' \ufeff', 'b'],
      cl100k: ['a', ' \ufeff', 'b'],
      llama3: ['a', ' \ufeff', 'b'],
      'grok2-v1': ['a', ' \ufeff', 'b'],
      'claude-legacy': ['a', ' \ufeff', 'b'],
    },
  ],
  [
    'a\u001cb',
    {
      o200k: ['a', '\u001cb'],
      cl100k: ['a', '\u001cb'],
      llama3: ['a', '\u001cb'],
      'grok2-v1': ['a', '\u001cb'],
      'claude-legacy': ['a', '\u001c', 'b'],
    },
  ],
  [
    'x \u001cy',
    {
      o200k: ['x', ' \u001c', 'y'],
      cl100k: ['x', ' \u001c', 'y'],
      llama3: ['x', ' \u001c', 'y'],
      'grok2-v1': ['x', ' \u001c', 'y'],
      'claude-legacy': ['x', ' \u001c', 'y'],
    },
  ],
  [
    'a\u2028b',
    {
      o200k: ['a', '\u2028b'],
      cl100k: ['a', '\u2028b'],
      llama3: ['a', '\u2028b'],
      'grok2-v1': ['a', '\u2028b'],
      'claude-legacy': ['a', '\u2028', 'b'],
    },
  ],
  [
    '台\u3000南',
    {
      o200k: ['台', '\u3000南'],
      cl100k: ['台', '\u3000南'],
      llama3: ['台', '\u3000南'],
      'grok2-v1': ['台', '\u3000南'],
      'claude-legacy': ['台', '\u3000', '南'],
    },
  ],
  [
    'a  1',
    {
      o200k: ['a', ' ', ' ', '1'],
      cl100k: ['a', ' ', ' ', '1'],
      llama3: ['a', ' ', ' ', '1'],
      'grok2-v1': ['a', ' ', ' ', '1'],
      'claude-legacy': ['a', ' ', ' 1'],
    },
  ],
  [
    'x  y  ',
    {
      o200k: ['x', ' ', ' y', '  '],
      cl100k: ['x', ' ', ' y', '  '],
      llama3: ['x', ' ', ' y', '  '],
      'grok2-v1': ['x', ' ', ' y', '  '],
      'claude-legacy': ['x', ' ', ' y', '  '],
    },
  ],
  [
    '1234567',
    {
      o200k: ['123', '456', '7'],
      cl100k: ['123', '456', '7'],
      llama3: ['123', '456', '7'],
      'grok2-v1': ['1', '2', '3', '4', '5', '6', '7'],
      'claude-legacy': ['1234567'],
    },
  ],
];

describe('hand-picked strings (ſ, U+0085, U+FEFF, U+001C, U+2028, U+3000) chunk as the oracle does', () => {
  for (const [text, expected] of ORACLE_CHUNKS) {
    it.each(PATTERN_KEYS)(`${JSON.stringify(text)} on %s`, (key) => {
      const { regex } = compilePattern(key);
      expect([...text.matchAll(regex)].map((m) => m[0])).toEqual(expected[key]);
    });
  }
});

describe('ruleAt: in-context rule detection (04 §2.1 step 3)', () => {
  /** Rule of every chunk of `text`, in context and (for contrast) of the chunk string in isolation. */
  const rules = (key: PatternKey, text: string) => {
    const pattern = compilePattern(key);
    return [...text.matchAll(pattern.regex)].map((m) => {
      const start = m.index;
      const end = start + m[0].length;
      return {
        chunk: m[0],
        inContext: ruleAt(pattern, text, start, end),
        isolated: ruleAt(pattern, m[0], 0, m[0].length),
      };
    });
  };

  it('a lone whitespace before a letter is the final \\s+ in context, not \\s+(?!\\S) as the isolated string suggests', () => {
    // claude-legacy: rules 0–6 contractions, 7 ` ?\p{L}+`, 8 ` ?\p{N}+`, 9 punctuation, 10 `\s+(?!\S)`, 11 `\s+`.
    // A lone U+0020 never ends right before a letter in any of the five patterns (every letter alternative takes one
    // leading space or non-letter), so the whitespace before the letter here is a tab, U+2028 and U+3000 (the
    // fixture cases tab-between, line-separator and ideographic-space).
    for (const text of ['a\tb', 'a\u2028b', '台\u3000南']) {
      expect(rules('claude-legacy', text)[1]).toMatchObject({ inContext: 11, isolated: 10 });
    }
  });

  it('a lone space before a digit or before NEL + letter is decided in context', () => {
    // o200k: 5 `\s+(?!\S)`, 6 `\s+`. 'a 1' → 'a', ' ', '1': the space is followed by a non-space.
    expect(rules('o200k', 'a 1')[1]).toEqual({ chunk: ' ', inContext: 6, isolated: 5 });
    // cl100k: 4 `\s+$`, 6 `\s+(?!\S)`. 'x \u0085y' (nel-before-letter) → ' ' is followed by NEL (White_Space).
    expect(rules('cl100k', 'x \u0085y')[1]).toEqual({ chunk: ' ', inContext: 6, isolated: 4 });
    // cl100k 'x  y': the first space is followed by ' y'.
    expect(rules('cl100k', 'x  y')[1]).toEqual({ chunk: ' ', inContext: 6, isolated: 4 });
  });

  it('identifies letter, digit, contraction and newline rules', () => {
    // 'Hello', " it's", ' ', '123', '45', '\n\n'
    expect(rules('o200k', "Hello it's 12345\n\n").map((r) => r.inContext)).toEqual([0, 0, 6, 2, 2, 4]);
    expect(rules('o200k', 'HTML').map((r) => r.inContext)).toEqual([1]);
    expect(rules('cl100k', "it's").map((r) => r.inContext)).toEqual([1, 0]);
    expect(rules('claude-legacy', "it's").map((r) => r.inContext)).toEqual([7, 0]);
  });

  it('returns NO_RULE when the span is not what the first matching alternative produces', () => {
    const pattern = compilePattern('o200k');
    expect(ruleAt(pattern, 'Hello world', 0, 3)).toBe(NO_RULE);
    expect(NO_RULE).toBe(255);
  });
});
