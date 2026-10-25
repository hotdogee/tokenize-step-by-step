/**
 * The fixture bridge (03 §B.5, §C.7): `fromFixtureCase` round-trips every case of all 9 shipping fixtures through the
 * invariants, in both the fixture and the `ExampleCaseWire` form; `replay(timeline, k)` equals the fixture-derived parts
 * for every tiktoken-family case and every k; the AD-31 gemma4 rule; Grok-1's zero-width dummy; the research anchors.
 */
import { describe, expect, it } from 'vitest';
import {
  checkInvariants,
  fixturePieceOf,
  fromFixtureCase,
  nfkcSegmentStart,
  replay,
  TokenFlag,
  TokenizationView,
  TokenKind,
  toExampleCaseWire,
  toExamplesWire,
  type SpmFixtureCase,
  type TiktokenFixtureCase,
  type TokenizationResult,
} from '../src/index.ts';
import { timelineToFixtureMerges } from '../src/timeline/fixture-steps.ts';
import {
  caseOf,
  hexBytes,
  loadFixture,
  REFS,
  SHIPPING,
  spmFixture,
  tiktokenFixture,
  TIKTOKEN_IDS,
  unicodeTables,
} from './helpers/fixtures.ts';

/** Chars with more than one non-zero-width token, computed from the fixture tokens alone. */
function fixtureSplitChars(result: TokenizationResult, c: TiktokenFixtureCase | SpmFixtureCase): number {
  const { chars } = result;
  let split = 0;
  for (let i = 0; i < chars.count; i++) {
    const s = chars.byteStart[i] ?? 0;
    const e = chars.byteStart[i + 1] ?? 0;
    const overlapping = c.tokens.filter((t) => !t.zeroWidth && t.start < e && t.end > s).length;
    if (overlapping > 1) split++;
  }
  return split;
}

function same(a: ArrayLike<number>, b: ArrayLike<number>): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false;
  return true;
}

/** A JSON-comparable copy of a result (typed arrays as plain arrays). */
function serialise(r: TokenizationResult): unknown {
  return JSON.parse(JSON.stringify(r, (_k, v: unknown) => (ArrayBuffer.isView(v) ? Array.from(v as Uint8Array) : v)));
}

/** Everything that differs between a result and its fixture case (plus invariant violations); empty when it matches. */
function fixtureProblems(result: TokenizationResult, c: TiktokenFixtureCase | SpmFixtureCase): string[] {
  const out = checkInvariants(result).map((v) => `${c.name}: ${v}`);
  const fail = (what: string): void => {
    out.push(`${c.name}: ${what}`);
  };
  if (result.text !== c.text) fail('text');
  if (result.utf8.length !== c.utf8Len) fail('utf8Len');
  if (!same(result.tokens.id, c.ids)) fail('ids');
  if (result.tokens.count !== c.tokens.length) fail('token count');
  c.tokens.forEach((t, i) => {
    if (result.tokens.byteStart[i] !== t.start || result.tokens.byteStart[i + 1] !== t.end)
      fail(`token ${String(i)} span`);
    if (!same(result.utf8.subarray(t.start, t.end), hexBytes(t.bytes))) fail(`token ${String(i)} bytes`);
    const flags = result.tokens.flags[i] ?? 0;
    if (((flags & TokenFlag.Partial) !== 0) !== t.partial) fail(`token ${String(i)} partial`);
    if (((flags & TokenFlag.ZeroWidth) !== 0) !== t.zeroWidth) fail(`token ${String(i)} zeroWidth`);
  });
  if (result.stats.splitChars !== fixtureSplitChars(result, c)) fail('splitChars');
  if ('chunks' in c) {
    if (!same(result.chunks.byteStart, [0, ...c.chunks.map(([, e]) => e)])) fail('chunks');
    if (c.chunks.length > 0 && c.chunks[0]?.[0] !== 0) fail('chunks start');
    if (JSON.stringify(timelineToFixtureMerges(result)) !== JSON.stringify(c.merges)) fail('merges');
  }
  return out;
}

function expectMatchesFixture(result: TokenizationResult, c: TiktokenFixtureCase | SpmFixtureCase): void {
  expect(fixtureProblems(result, c)).toEqual([]);
}

describe.each(SHIPPING)('fromFixtureCase round-trips %s', (id) => {
  const fixture = loadFixture(id);
  const cases = fixture.cases as ReadonlyArray<TiktokenFixtureCase | SpmFixtureCase>;
  const ref = REFS[id];

  it('has the full corpus', () => {
    expect(cases).toHaveLength(374);
  });

  it('every case: invariants, ids, spans, flags, chunks, merges, splitChars', () => {
    expect(cases.flatMap((c) => fixtureProblems(fromFixtureCase(fixture, c.name, ref), c))).toEqual([]);
  });

  it('every case through ExampleCaseWire equals the fixture result', () => {
    const wire = toExamplesWire(
      fixture,
      id,
      cases.map((c) => c.name),
    );
    const problems: string[] = [];
    for (const c of cases) {
      const viaWire = fromFixtureCase(wire, c.name, ref);
      problems.push(...checkInvariants(viaWire));
      if (JSON.stringify(serialise(viaWire)) !== JSON.stringify(serialise(fromFixtureCase(fixture, c.name, ref)))) {
        problems.push(`${c.name}: wire result differs`);
      }
    }
    expect(problems).toEqual([]);
    const sample = cases.find((c) => c.name === 'zh-tw-tainan')?.name ?? '';
    expect(fromFixtureCase(wire, sample, ref)).toEqual(fromFixtureCase(fixture, sample, ref));
  });

  it('wire cases without merges keep tokens and chunks, with no timeline', () => {
    for (const c of cases.filter((x) => x.name.endsWith('-paragraph'))) {
      const wire = {
        schema: 1 as const,
        tokenizer: id,
        cases: { [c.name]: toExampleCaseWire(fixture, c, { merges: false }) },
      };
      const result = fromFixtureCase(wire, c.name, ref);
      expect(checkInvariants(result)).toEqual([]);
      expect(result.timeline).toBeNull();
      expect(Array.from(result.tokens.id)).toEqual(c.ids);
    }
  });

  it('addBos prepends a zero-width Bos token when the tokenizer declares one', () => {
    const result = fromFixtureCase(fixture, 'zh-tw-tainan', ref, { addBos: true });
    expect(checkInvariants(result)).toEqual([]);
    const bosId = ref.engine?.bosId ?? null;
    if (bosId === null) {
      expect(result.tokens.count).toBe(caseOf(id, 'zh-tw-tainan').ids.length);
      return;
    }
    expect(result.tokens.id[0]).toBe(bosId);
    expect(result.tokens.kind[0]).toBe(TokenKind.Bos);
    expect(result.tokens.flags[0]).toBe(TokenFlag.ZeroWidth | TokenFlag.Special);
    expect(result.tokens.chunk[0]).toBe(-1);
    expect(result.stats.splitChars).toBe(fromFixtureCase(fixture, 'zh-tw-tainan', ref).stats.splitChars);
  });
});

describe('replay(timeline, k) equals the fixture-derived parts', () => {
  /** Expected boundary lists for k = 0..steps, by naive splicing of the fixture positions chunk by chunk. */
  function expectedBoundaries(c: TiktokenFixtureCase): number[][] {
    const parts = c.chunks.map(([s, e], i) => {
      const direct = c.merges.find((m) => m.chunk === i)?.directHit ?? false;
      return direct ? [s] : Array.from({ length: e - s }, (_, k) => s + k);
    });
    const snapshot = (): number[] => (c.utf8Len === 0 ? [0] : [...parts.flat(), c.utf8Len]);
    const out = [snapshot()];
    for (const m of c.merges) {
      for (const [position] of m.steps) {
        parts[m.chunk]?.splice(position + 1, 1);
        out.push(snapshot());
      }
    }
    return out;
  }

  it.each(TIKTOKEN_IDS)('%s: every case, every k (also through the view cursor, both directions)', (id) => {
    const fixture = tiktokenFixture(id);
    let checked = 0;
    const problems: string[] = [];
    for (const c of fixture.cases) {
      const result = fromFixtureCase(fixture, c.name, REFS[id]);
      const timeline = result.timeline;
      if (timeline === null) throw new Error('missing timeline');
      const expected = expectedBoundaries(c);
      if (timeline.stepCount !== expected.length - 1) problems.push(`${c.name}: stepCount`);
      const view = new TokenizationView(result);
      for (let k = 0; k <= timeline.stepCount; k++) {
        if (!same(replay(timeline, k), expected[k] ?? [])) problems.push(`${c.name}: replay(${String(k)})`);
        if (!same(view.partsAt(k).partStart, expected[k] ?? [])) problems.push(`${c.name}: partsAt(${String(k)})`);
        checked++;
      }
      for (let k = timeline.stepCount; k >= 0; k -= 3) {
        if (!same(view.partsAt(k).partStart, expected[k] ?? []))
          problems.push(`${c.name}: partsAt(${String(k)}) backwards`);
      }
    }
    expect(problems).toEqual([]);
    expect(checked).toBeGreaterThan(fixture.cases.length);
  });
});

describe('AD-31 and SentencePiece kinds', () => {
  it('maps gemma4 USER_DEFINED to Normal: tab-only, newline-pair, three-spaces', () => {
    const fixture = spmFixture('google-gemma4');
    for (const name of ['tab-only', 'newline-pair', 'three-spaces']) {
      const c = caseOf('google-gemma4', name) as SpmFixtureCase;
      expect(c.tokens.map((t) => t.type)).toEqual(['USER_DEFINED']);
      const result = fromFixtureCase(fixture, name, REFS['google-gemma4']);
      expect(Array.from(result.tokens.kind)).toEqual([TokenKind.Normal]);
      expect((result.tokens.flags[0] ?? 0) & TokenFlag.UserDefined).toBe(0);
      const wire = toExampleCaseWire(fixture, c);
      expect(wire.type).toEqual([TokenKind.Normal]);
    }
  });

  it('keeps gemma2 USER_DEFINED and BYTE kinds (tab → BYTE 226)', () => {
    const fixture = spmFixture('google-gemma2');
    const tab = fromFixtureCase(fixture, 'tab-only', REFS['google-gemma2']);
    expect(Array.from(tab.tokens.id)).toEqual([226]);
    expect(tab.tokens.kind[0]).toBe(TokenKind.Byte);
    expect((tab.tokens.flags[0] ?? 0) & TokenFlag.ByteFallback).toBe(TokenFlag.ByteFallback);
    const turn = fromFixtureCase(fixture, 'special-start-of-turn', REFS['google-gemma2']);
    expect(Array.from(turn.tokens.kind)).toContain(TokenKind.UserDefined);
  });

  it('Grok-1 zh-tw-tainan: zero-width dummy prefix, splitChars === 1', () => {
    const result = fromFixtureCase(spmFixture('xai-grok1'), 'zh-tw-tainan', REFS['xai-grok1']);
    expect(Array.from(result.tokens.id)).toEqual([130089, 130876, 300, 198, 232, 130876, 130899]);
    expect(result.tokens.kind[0]).toBe(TokenKind.DummyPrefix);
    expect(result.tokens.flags[0]).toBe(TokenFlag.ZeroWidth);
    expect(result.tokens.byteStart[0]).toBe(0);
    expect(result.tokens.byteStart[1]).toBe(0);
    expect(result.stats.splitChars).toBe(1);
    expect(result.stats.zeroWidthTokens).toBe(1);
    expect(result.chars.tokenFirst[0]).toBe(1);
    expect(result.timeline).toBeNull();
    const withBos = fromFixtureCase(spmFixture('xai-grok1'), 'zh-tw-tainan', REFS['xai-grok1'], { addBos: true });
    expect(withBos.stats.splitChars).toBe(1);
    expect(Array.from(withBos.tokens.kind.subarray(0, 2))).toEqual([TokenKind.Bos, TokenKind.DummyPrefix]);
  });

  it('Grok-1 leading-spaces: the dummy fuses with three spaces (▁▁▁▁ id 336, [0,3), not zero-width)', () => {
    const result = fromFixtureCase(spmFixture('xai-grok1'), 'leading-spaces', REFS['xai-grok1']);
    expect(result.tokens.id[0]).toBe(336);
    expect(result.tokens.byteStart[1]).toBe(3);
    expect((result.tokens.flags[0] ?? 0) & TokenFlag.ZeroWidth).toBe(0);
    expect(fixturePieceOf(spmFixture('xai-grok1'))(336)).toBe('▁▁▁▁');
  });

  it('collects piece strings from fixtures and from the wire form', () => {
    const fixture = spmFixture('google-gemma4');
    const wire = toExamplesWire(fixture, 'google-gemma4', ['zh-tw-tainan', 'literal-sp-space', 'cjk-ext-g-biang']);
    const fromWire = fixturePieceOf(wire);
    const fromFixture = fixturePieceOf(fixture);
    for (const name of ['zh-tw-tainan', 'literal-sp-space', 'cjk-ext-g-biang']) {
      for (const t of (caseOf('google-gemma4', name) as SpmFixtureCase).tokens) {
        expect(fromWire(t.id)).toBe(t.piece);
        expect(fromFixture(t.id)).toBe(t.piece);
      }
    }
    expect(fromWire(-5)).toBeNull();
  });
});

describe('normalizedNFKC through fromFixtureCase', () => {
  const fixture = tiktokenFixture('anthropic-claude-legacy');
  const ref = REFS['anthropic-claude-legacy'];
  const cut = nfkcSegmentStart(unicodeTables().normalization);

  it('builds every normalizedNFKC case with an exact source map against the original text', () => {
    for (const c of fixture.normalizedNFKC ?? []) {
      const result = fromFixtureCase(fixture, c.name, ref, { normalize: 'NFKC', nfkcSegmentStart: cut });
      expectMatchesFixture(result, c);
      expect(result.normalization).toEqual({ form: 'NFKC', changed: true });
      expect(result.input.text).toBe(caseOf('anthropic-claude-legacy', c.name).text);
      expect(result.chars.sourceRunStart).toHaveLength(result.chars.count);
    }
  });

  it('halfwidth-katakana-dakuten: ﾀﾞ → ダ is a 2 → 1 run', () => {
    const result = fromFixtureCase(fixture, 'halfwidth-katakana-dakuten', ref, {
      normalize: 'NFKC',
      nfkcSegmentStart: cut,
    });
    const view = new TokenizationView(result);
    const input = Array.from(result.input.text);
    const dakuten = Array.from(result.text).indexOf('ダ');
    const run = view.charAt(dakuten).sourceRun;
    expect(run).not.toBeNull();
    expect(input.slice(run?.[0], run?.[1]).join('')).toBe('ﾀﾞ');
  });

  it('a case NFKC leaves unchanged keeps an identity map with changed: false', () => {
    const result = fromFixtureCase(fixture, 'zh-tw-tainan', ref, { normalize: 'NFKC', nfkcSegmentStart: cut });
    expect(result.normalization).toEqual({ form: 'NFKC', changed: false });
    expect(Array.from(result.chars.sourceRunStart ?? [])).toEqual([0, 1, 2, 3]);
  });
});

describe('research anchors (04 §7)', () => {
  it('o200k 台灣台南 → [3735, 133072, 3735, 14609]', () => {
    const result = fromFixtureCase(loadFixture('openai-o200k_base'), 'zh-tw-tainan', REFS['openai-o200k_base']);
    expect(Array.from(result.tokens.id)).toEqual([3735, 133072, 3735, 14609]);
  });

  it('cl100k 灣 is split at step 7 of 7 → 66285', () => {
    const result = fromFixtureCase(loadFixture('openai-cl100k_base'), 'zh-tw-tainan', REFS['openai-cl100k_base']);
    const view = new TokenizationView(result);
    const sentence = view.stepSentence(7);
    expect(sentence).toMatchObject({ step: 7, stepCount: 7, kind: 'merge', leftHex: ['E7'], rightHex: ['81'] });
    expect(sentence).toMatchObject({ resultId: 66285, rank: 66285, charsText: '灣', partOf: 'part' });
    expect(result.tokens.stepFormed[1]).toBe(7);
    expect(view.tokenAt(1)).toMatchObject({ id: 66285, completes: 'starts', missingBytes: 1, partial: true });
    expect(view.tokenAt(2)).toMatchObject({ id: 96, completes: 'ends', missingBytes: 2 });
  });

  it('Grok-2 zh-tw-tainan first step is [0, 1128] (stepResultId = stepRank = 1128)', () => {
    const result = fromFixtureCase(loadFixture('xai-grok2'), 'zh-tw-tainan', REFS['xai-grok2']);
    expect(result.timeline?.stepResultId[0]).toBe(1128);
    expect(result.timeline?.stepRank[0]).toBe(1128);
    expect([result.timeline?.stepLeft[0], result.timeline?.stepMid[0], result.timeline?.stepEnd[0]]).toEqual([0, 1, 2]);
  });

  it('Grok-2 4242 (ー + 2 bytes of メ) and Claude 20094 cross a char boundary while partial', () => {
    const grok = new TokenizationView(fromFixtureCase(loadFixture('xai-grok2'), 'ja-shibuya-ramen', REFS['xai-grok2']));
    const g = grok.result.tokens;
    const gi = Array.from(g.id).indexOf(4242);
    expect(grok.tokenAt(gi)).toMatchObject({ completes: 'crosses', missingBytes: 1, partial: true });
    expect(grok.charsOfToken(gi).map((i) => grok.charAt(i).cp)).toEqual([0x30fc, 0x30e1]);
    const claude = new TokenizationView(
      fromFixtureCase(loadFixture('anthropic-claude-legacy'), 'ja-tokenization', REFS['anthropic-claude-legacy']),
    );
    const ci = Array.from(claude.result.tokens.id).indexOf(20094);
    expect(claude.tokenAt(ci).completes).toBe('crosses');
  });

  it('direct-hit chunks carry the DirectHit flag and no inside boundaries', () => {
    const fixture = tiktokenFixture('openai-o200k_base');
    const c = fixture.cases.find((x) => x.merges.some((m) => m.directHit && (c0(x, m.chunk) ?? 0) > 1));
    if (c === undefined) throw new Error('no multi-byte direct hit in the corpus');
    const result = fromFixtureCase(fixture, c.name, REFS['openai-o200k_base']);
    const chunk = c.merges.find((m) => m.directHit && (c0(c, m.chunk) ?? 0) > 1)?.chunk ?? -1;
    const t = result.chunks.tokenStart[chunk] ?? 0;
    expect((result.tokens.flags[t] ?? 0) & TokenFlag.DirectHit).toBe(TokenFlag.DirectHit);
    expect(result.tokens.stepFormed[t]).toBe(-1);
    const [s, e] = c.chunks[chunk] ?? [0, 0];
    for (let b = s + 1; b < e; b++) expect(result.timeline?.boundaryBorn[b]).toBe(0x7fffffff);
  });
});

/** Byte length of chunk `i` of a tiktoken case. */
function c0(c: TiktokenFixtureCase, i: number): number | undefined {
  const span = c.chunks[i];
  return span === undefined ? undefined : span[1] - span[0];
}
