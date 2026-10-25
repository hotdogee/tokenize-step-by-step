/**
 * `runFixture` (04 §7) end to end against a fixture-backed tokenizer for all 9 shipping fixtures, plus negative tests that
 * corrupt one aspect at a time and must be reported under the right field.
 */
import { describe, expect, it } from 'vitest';
import { TokenFlag, TokenKind, type TokenizationResult } from '@tsbs/core';
import { compareMergeSteps, firstDifference, formatReport, runFixture } from '../src/index.ts';
import { corrupt, fixtureTokenizer, loadFixture, SHIPPING } from './helpers/fixture-tokenizer.ts';

/** A copy of `r` with `patch` applied to a cloned token table. */
function withTokens(
  r: TokenizationResult,
  patch: (tokens: { id: Uint32Array; flags: Uint8Array; kind: Uint8Array }) => void,
) {
  const tokens = { ...r.tokens, id: r.tokens.id.slice(), flags: r.tokens.flags.slice(), kind: r.tokens.kind.slice() };
  patch(tokens);
  return { ...r, tokens };
}

describe.each(SHIPPING)('runFixture on %s', (id) => {
  it('passes every case and assertion', () => {
    const fixture = loadFixture(id);
    const report = runFixture(fixture, fixtureTokenizer(id));
    expect(report.failures, formatReport(report)).toEqual([]);
    expect(report.ok).toBe(true);
    const nfkc = fixture.family === 'tiktoken-bpe' ? (fixture.normalizedNFKC?.length ?? 0) : 0;
    expect(report.cases).toBe(374 + nfkc);
    expect(report.assertions).toBeGreaterThan(374 * 5);
  });
});

describe('runFixture negative cases', () => {
  const o200k = () => fixtureTokenizer('openai-o200k_base');
  const fixture = loadFixture('openai-o200k_base');
  const few = { cases: ['zh-tw-tainan', 'ja-shibuya-ramen', 'special-endoftext', 'nel'] };

  it('reports wrong ids', () => {
    const bad = corrupt(o200k(), (r) => withTokens(r, (t) => (t.id[0] = 1)));
    const report = runFixture(fixture, bad, few);
    expect(report.ok).toBe(false);
    expect(report.failures.map((f) => f.field)).toContain('ids');
  });

  it('reports flag corruption and the invariant it breaks', () => {
    const bad = corrupt(o200k(), (r) => withTokens(r, (t) => (t.flags[1] = (t.flags[1] ?? 0) ^ TokenFlag.Partial)));
    const fields = runFixture(fixture, bad, { cases: ['zh-tw-tainan'] }).failures.map((f) => f.field);
    expect(fields).toContain('tokens.partial');
    expect(fields).toContain('invariants');
  });

  it('reports a missing timeline and wrong directHit', () => {
    const noTimeline = corrupt(o200k(), (r) => ({ ...r, timeline: null }));
    expect(runFixture(fixture, noTimeline, few).failures.map((f) => f.field)).toContain('merges');
    const flipped = corrupt(o200k(), (r) => ({
      ...r,
      chunks: { ...r.chunks, directHit: r.chunks.directHit.map((d) => 1 - d) },
    }));
    const messages = runFixture(fixture, flipped, few)
      .failures.filter((f) => f.field === 'merges')
      .map((f) => f.message);
    expect(messages.some((m) => m.includes('directHit'))).toBe(true);
  });

  it('reports encode() ≢ encodeIncremental()', () => {
    const inner = o200k();
    const bad = corrupt(inner, (r) => r, {
      *encodeIncremental(text, options) {
        yield { bytesDone: 0, bytesTotal: 0 };
        const r = inner.encode(text, options);
        return { ...r, stats: { ...r.stats, mergeSteps: r.stats.mergeSteps + 1 } };
      },
    });
    const failures = runFixture(fixture, bad, few).failures.filter((f) => f.field === 'encodeIncremental');
    expect(failures.length).toBeGreaterThan(0);
    expect(failures[0]?.message).toContain('result.stats.mergeSteps');
  });

  it('reports wrong ids under specialTokens: match', () => {
    const inner = o200k();
    const bad = corrupt(inner, (r, _text, options) => (options.specialTokens === 'match' ? inner.encode(r.text) : r));
    const failures = runFixture(fixture, bad, { cases: ['special-endoftext'] }).failures;
    expect(failures.map((f) => [f.variant, f.field])).toContainEqual(['match', 'idsWithSpecials']);
  });

  it('enforces AD-31 on gemma4 and exact kinds on gemma2', () => {
    const gemma4 = corrupt(fixtureTokenizer('google-gemma4'), (r) =>
      withTokens(r, (t) => t.kind.fill(TokenKind.UserDefined)),
    );
    const g4 = runFixture(loadFixture('google-gemma4'), gemma4, {
      cases: ['tab-only', 'newline-pair', 'three-spaces'],
    });
    expect(g4.failures.filter((f) => f.field === 'tokens.type')).toHaveLength(3);
    const gemma2 = corrupt(fixtureTokenizer('google-gemma2'), (r) =>
      withTokens(r, (t) => t.kind.fill(TokenKind.Normal)),
    );
    const g2 = runFixture(loadFixture('google-gemma2'), gemma2, { cases: ['tab-only'] });
    expect(g2.failures.map((f) => f.field)).toContain('tokens.type');
  });

  it('reports a wrong piece string and a thrown error', () => {
    const inner = fixtureTokenizer('xai-grok1');
    const pieces = corrupt(inner, (r) => r, { pieceString: () => 'x' });
    expect(
      runFixture(loadFixture('xai-grok1'), pieces, { cases: ['zh-tw-tainan'] }).failures.map((f) => f.field),
    ).toContain('tokens.piece');
    const throws = corrupt(inner, () => {
      throw new Error('boom');
    });
    const report = runFixture(loadFixture('xai-grok1'), throws, { cases: ['zh-tw-tainan'], incremental: false });
    expect(report.failures[0]).toMatchObject({ field: 'encode', message: 'Error: boom' });
  });

  it('checks the addBos variant where the tokenizer declares a BOS id', () => {
    const inner = fixtureTokenizer('meta-llama3');
    const dropped = corrupt(inner, (r, text, options) => (options.addBos === true ? inner.encode(text) : r));
    const fields = runFixture(loadFixture('meta-llama3'), dropped, { cases: ['zh-tw-tainan', 'empty'] }).failures.map(
      (f) => `${f.variant}:${f.field}`,
    );
    expect(fields).toContain('bos:ids');
    expect(fields).toContain('bos:bos');
  });

  it('checks splitChars from the fixture tokens (Grok-1 zh-tw-tainan = 1)', () => {
    const bad = corrupt(fixtureTokenizer('xai-grok1'), (r) => ({ ...r, stats: { ...r.stats, splitChars: 2 } }));
    const fields = runFixture(loadFixture('xai-grok1'), bad, { cases: ['zh-tw-tainan'] }).failures.map((f) => f.field);
    expect(fields).toContain('stats.splitChars');
  });

  it('stops collecting at maxFailures', () => {
    const bad = corrupt(o200k(), (r) => withTokens(r, (t) => t.id.fill(1)));
    const report = runFixture(fixture, bad, { maxFailures: 3 });
    expect(report.failures).toHaveLength(3);
    expect(report.truncated).toBe(true);
    expect(formatReport(report)).toContain('(truncated)');
  });
});

describe('helpers', () => {
  it('compareMergeSteps flags a step-count mismatch', () => {
    const r = fixtureTokenizer('openai-cl100k_base').encode('台灣台南');
    expect(compareMergeSteps(r, [{ chunk: 0, directHit: false, steps: [[0, 5877]] }])[0]).toContain('7 steps');
    expect(compareMergeSteps(r, [{ chunk: 3, directHit: false, steps: [] }])[0]).toContain('does not exist');
  });

  it('firstDifference ignores timings only at the top level', () => {
    const r = fixtureTokenizer('openai-cl100k_base').encode('台灣台南');
    expect(firstDifference(r, { ...r, timings: { analyzeMs: 9, encodeMs: 9 } })).toBeNull();
    expect(firstDifference(r, { ...r, utf8: r.utf8.slice(1) })).toBe('result.utf8');
  });
});
