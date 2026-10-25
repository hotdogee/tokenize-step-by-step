/**
 * WP02 acceptance (07 §2): the expanded `o200k` / `cl100k` / `llama3` / `grok2-v1` / `claude-legacy` regexes reproduce
 * EVERY fixture `chunks` span of the six tiktoken-family fixtures (incl. fuzz-031/062/086 for cl100k and the ten
 * discriminating cases), every chunk has an in-context rule, and a deliberately wrong port — the JavaScript `\s` set,
 * no `ſ` closure, case-sensitive contractions — fails on the discriminating cases the oracle lane reported for each
 * tokenizer (tools/oracle/README.md § "Golden fixtures").
 */
import process from 'node:process';
import { describe, expect, it } from 'vitest';
import type { TiktokenFixture, TiktokenFixtureCase } from '../../src/index.ts';
import { classBody } from '../../src/unicode/classes.ts';
import { compilePattern, contractionAtom, expandTemplate, NO_RULE, ruleAt } from '../../src/unicode/expand.ts';
import { PATTERN_TEMPLATES, type PatternKey } from '../../src/unicode/patterns.ts';
import { chunkByteSpans, loadFixture } from '../helpers/repo.ts';

/** Fixture → template (04 §2.2 "Used by"). */
const FIXTURES: ReadonlyArray<readonly [string, PatternKey]> = [
  ['openai-o200k_base', 'o200k'],
  ['meta-llama4-muse', 'o200k'],
  ['openai-cl100k_base', 'cl100k'],
  ['meta-llama3', 'llama3'],
  ['xai-grok2', 'grok2-v1'],
  ['anthropic-claude-legacy', 'claude-legacy'],
];

const DISCRIMINATORS = [
  'ws-bom-mid',
  'nel-after-space',
  'nel-before-letter',
  'fs-control',
  'fs-before-letter',
  'contraction-upper',
  'contraction-long-s',
  'contraction-dont-upper',
  'contraction-upper-run',
  'contraction-long-s-run',
] as const;

/** The deliberate porting mistakes the discriminating cases exist to catch (04 §2.2 rules 1 and 3). */
type Mistake = 'js-whitespace' | 'no-long-s' | 'case-sensitive' | 'fs-is-whitespace';

/** Cases each mistake must break, per template, as the oracle lane reported them (tools/oracle/README.md). */
const EXPECTED_FAILURES: Readonly<Record<PatternKey, Readonly<Record<Mistake, readonly string[]>>>> = {
  o200k: {
    'js-whitespace': ['ws-bom-mid', 'nel-before-letter'],
    'no-long-s': ['contraction-long-s'],
    'case-sensitive': ['contraction-upper', 'contraction-long-s', 'contraction-dont-upper'],
    'fs-is-whitespace': ['fs-before-letter'],
  },
  cl100k: {
    'js-whitespace': ['ws-bom-mid', 'nel-before-letter'],
    'no-long-s': ['contraction-long-s-run'],
    'case-sensitive': ['contraction-upper-run', 'contraction-long-s-run'],
    'fs-is-whitespace': ['fs-before-letter'],
  },
  llama3: {
    'js-whitespace': ['ws-bom-mid', 'nel-before-letter'],
    'no-long-s': ['contraction-long-s-run'],
    'case-sensitive': ['contraction-upper-run', 'contraction-long-s-run'],
    'fs-is-whitespace': ['fs-before-letter'],
  },
  'grok2-v1': {
    'js-whitespace': ['ws-bom-mid', 'nel-before-letter'],
    'no-long-s': ['contraction-long-s-run'],
    'case-sensitive': ['contraction-upper-run', 'contraction-long-s-run'],
    'fs-is-whitespace': ['fs-before-letter'],
  },
  // claude.json's contractions are case-sensitive upstream, so only the whitespace mistakes apply.
  'claude-legacy': {
    'js-whitespace': ['ws-bom-mid', 'nel-before-letter'],
    'no-long-s': [],
    'case-sensitive': [],
    'fs-is-whitespace': ['fs-before-letter'],
  },
};

/** A wrong port of `key` with the given mistakes. */
function wrongPort(key: PatternKey, mistakes: ReadonlySet<Mistake>): RegExp {
  let template = PATTERN_TEMPLATES[key];
  if (key === 'cl100k') {
    if (mistakes.has('case-sensitive'))
      template = template.replace("'(?:[sSſdDmMtT]|[lL][lL]|[vV][eE]|[rR][eE])", "'(?:[sdmt]|ll|ve|re)");
    else if (mistakes.has('no-long-s')) template = template.replace('[sSſdDmMtT]', '[sSdDmMtT]');
  }
  const source = expandTemplate(template, (name) => {
    if (name === 'CONTR') {
      if (mistakes.has('case-sensitive')) return "(?:'(?:s|t|re|ve|m|ll|d))";
      return mistakes.has('no-long-s') ? contractionAtom().replace('ſ', '') : contractionAtom();
    }
    if (name === 'WS') {
      if (mistakes.has('js-whitespace')) return '\\s';
      return classBody('White_Space') + (mistakes.has('fs-is-whitespace') ? '\\u{1c}-\\u{1f}' : '');
    }
    return classBody(name);
  });
  return new RegExp(source, 'gu');
}

const casesOf = (fixture: TiktokenFixture): TiktokenFixtureCase[] => [
  ...fixture.cases,
  ...(fixture.normalizedNFKC ?? []),
];

const failingCases = (regex: RegExp, cases: readonly TiktokenFixtureCase[]) =>
  cases.filter((c) => JSON.stringify(chunkByteSpans(regex, c.text)) !== JSON.stringify(c.chunks)).map((c) => c.name);

describe.each(FIXTURES)('%s (%s template)', (name, key) => {
  const fixture = loadFixture(name) as TiktokenFixture;
  const cases = casesOf(fixture);

  it('holds every case, the discriminators and (cl100k) the trailing-whitespace fuzz cases', () => {
    expect(fixture.cases).toHaveLength(374);
    const names = new Set(fixture.cases.map((c) => c.name));
    for (const discriminator of DISCRIMINATORS) expect(names.has(discriminator), discriminator).toBe(true);
    if (key === 'cl100k') for (const fuzz of ['fuzz-031', 'fuzz-062', 'fuzz-086']) expect(names.has(fuzz)).toBe(true);
    if (key === 'claude-legacy') expect(fixture.normalizedNFKC).toHaveLength(152);
  });

  it('reproduces every fixture chunk span (Unicode 16.0 pinned classes)', () => {
    const { regex } = compilePattern(key);
    const mismatches = cases.filter((c) => {
      expect(new TextEncoder().encode(c.text).length, c.name).toBe(c.utf8Len);
      return JSON.stringify(chunkByteSpans(regex, c.text)) !== JSON.stringify(c.chunks);
    });
    expect(mismatches.map((c) => c.name)).toEqual([]);
  });

  it('assigns every chunk an in-context rule (never NO_RULE)', () => {
    const pattern = compilePattern(key);
    for (const c of cases) {
      for (const m of c.text.matchAll(pattern.regex)) {
        expect(ruleAt(pattern, c.text, m.index, m.index + m[0].length), c.name).not.toBe(NO_RULE);
      }
    }
  });

  it.each(['js-whitespace', 'no-long-s', 'case-sensitive', 'fs-is-whitespace'] as const)(
    'a port with the mistake "%s" fails exactly on the discriminators the oracle lane reported',
    (mistake) => {
      const failing = failingCases(wrongPort(key, new Set([mistake])), cases);
      expect(failing).toEqual(EXPECTED_FAILURES[key][mistake]);
    },
  );

  it('the deliberately wrong port (JS \\s set, no ſ closure, case-sensitive contractions) fails on a discriminator', () => {
    const failing = failingCases(wrongPort(key, new Set(['js-whitespace', 'no-long-s', 'case-sensitive'])), cases);
    expect(failing.length).toBeGreaterThan(0);
    expect(failing.every((n) => (DISCRIMINATORS as readonly string[]).includes(n))).toBe(true);
  });
});

/**
 * Parity report against the engine's native `\p{…}` (AD-4: `TSBS_NATIVE_UNICODE=1`). Divergences are expected only for
 * code points assigned after Unicode 16.0; the corpus avoids them, so the fixtures must agree.
 */
describe.runIf(process.env['TSBS_NATIVE_UNICODE'] === '1')('TSBS_NATIVE_UNICODE=1 parity', () => {
  it.each(FIXTURES)('%s: native classes reproduce the fixture chunks', (name, key) => {
    const failing = failingCases(compilePattern(key, 'native').regex, casesOf(loadFixture(name) as TiktokenFixture));
    console.info(`[native parity] ${name}: ${String(failing.length)} divergent case(s)`, failing);
    expect(failing).toEqual([]);
  });
});
