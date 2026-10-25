import { mkdtemp, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { TokenFlag, TokenKind, type Fixture, type TokenizerId } from '@tsbs/core';
import {
  DEFAULT_CHIP_CASES,
  DEFAULT_EXAMPLE_BUDGET_GZ,
  EXAMPLES_BUDGET_GZ,
  buildExamples,
  caseToWire,
  loadChips,
  loadFixtures,
  runExamples,
  type ExamplesIndex,
  type ExamplesWire,
} from '../src/index.ts';
import { FIXTURES } from './support/repo.ts';

const CHIPS = DEFAULT_CHIP_CASES.map((fixtureCase) => ({ fixtureCase, paragraph: fixtureCase.endsWith('-paragraph') }));

let fixtures: Map<TokenizerId, Fixture>;
beforeAll(async () => {
  fixtures = await loadFixtures(FIXTURES);
});

function fixture(id: TokenizerId): Fixture {
  const f = fixtures.get(id);
  if (f === undefined) throw new Error(id);
  return f;
}

describe('caseToWire (03 §C.7)', () => {
  it('encodes ids, delta token ends, chunks and merges for the default example', () => {
    const wire = caseToWire(fixture('openai-o200k_base'), 'zh-tw-tainan', true);
    expect(wire).toEqual({
      text: '台灣台南',
      ids: [3735, 133072, 3735, 14609],
      tokenEnd: [3, 3, 3, 3],
      chunks: [12],
      merges: [{ c: 0, d: 0, s: [0, 948, 5, 948, 7, 2166, 0, 3735, 4, 3735, 1, 13864, 4, 14609, 1, 133072] }],
    });
  });

  it('marks partial tokens and spm kinds; the Grok-1 dummy prefix is zero-width', () => {
    const grok1 = caseToWire(fixture('xai-grok1'), 'zh-tw-tainan', true);
    expect(grok1.tokenEnd).toEqual([0, 3, 1, 1, 1, 3, 3]);
    expect(grok1.type).toEqual([TokenKind.DummyPrefix, 0, TokenKind.Byte, TokenKind.Byte, TokenKind.Byte, 0, 0]);
    expect(grok1.piece).toEqual(['▁', 0, '<0xE7>', '<0x81>', '<0xA3>', 0, 0]);
    expect(grok1.flags).toEqual([
      [0, TokenFlag.ZeroWidth],
      [2, TokenFlag.Partial | TokenFlag.ByteFallback],
      [3, TokenFlag.Partial | TokenFlag.ByteFallback],
      [4, TokenFlag.Partial | TokenFlag.ByteFallback],
    ]);
    expect(grok1.merges).toBeUndefined();
    expect(grok1.chunks).toBeUndefined();
  });

  it('maps gemma4 USER_DEFINED to Normal (AD-31) but keeps it for gemma2', () => {
    for (const name of ['tab-only', 'newline-pair', 'three-spaces']) {
      const wire = caseToWire(fixture('google-gemma4'), name, true);
      expect(
        wire.type?.every((kind) => kind === TokenKind.Normal),
        name,
      ).toBe(true);
      expect(wire.flags ?? [], name).toEqual([]);
    }
    const gemma2 = caseToWire(fixture('google-gemma2'), 'tab-only', true);
    expect(gemma2.type).toEqual([TokenKind.Byte]);
  });

  it('decodes back to the fixture tokens', () => {
    for (const [id, f] of fixtures) {
      for (const name of ['mixed-hello-taiwan-tokyo', 'emoji-family-zwj', 'ja-paragraph']) {
        const wire = caseToWire(f, name, true);
        const source = f.cases.find((c) => c.name === name);
        let end = 0;
        const spans = wire.tokenEnd.map((len) => [end, (end += len)]);
        expect(spans, `${id}/${name}`).toEqual(source?.tokens.map((t) => [t.start, t.end]));
        expect(wire.ids).toEqual(source?.ids);
      }
    }
  });
});

describe('buildExamples', () => {
  it('stays within the budgets and omits merges for paragraph chips', () => {
    const out = buildExamples(fixtures, CHIPS);
    expect(out.perTokenizer).toHaveLength(9);
    for (const file of out.perTokenizer) {
      expect(file.gzipBytes, file.name).toBeLessThanOrEqual(EXAMPLES_BUDGET_GZ);
      expect(file.name).toMatch(new RegExp(`^${file.tokenizer}\\.[0-9a-f]{8}\\.json$`));
      const wire = JSON.parse(file.json) as ExamplesWire;
      expect(Object.keys(wire.cases)).toEqual([...DEFAULT_CHIP_CASES]);
      for (const name of ['zh-tw-paragraph', 'ja-paragraph', 'en-paragraph'])
        expect(wire.cases[name]?.merges).toBeUndefined();
    }
    expect(out.defaultExample.gzipBytes).toBeLessThanOrEqual(DEFAULT_EXAMPLE_BUDGET_GZ);
    const index = JSON.parse(out.index.json) as ExamplesIndex;
    expect(index.default).toEqual({ tokenizer: 'openai-o200k_base', case: 'zh-tw-tainan' });
    expect(index.files['xai-grok1']).toMatch(/^\/examples\/xai-grok1\.[0-9a-f]{8}\.json$/);
    expect(index.partial['openai-cl100k_base']).toContain('zh-tw-tainan');
    expect(index.partial['openai-o200k_base']).not.toContain('zh-tw-tainan');
  });

  it('is deterministic and rejects chips the fixtures do not have or whose text differs', () => {
    expect(buildExamples(fixtures, CHIPS).index.json).toBe(buildExamples(fixtures, CHIPS).index.json);
    expect(() => buildExamples(fixtures, [{ fixtureCase: 'nope', paragraph: false }])).toThrow(/missing/);
    expect(() => buildExamples(fixtures, [{ fixtureCase: 'zh-tw-tainan', text: '台南', paragraph: false }])).toThrow(
      /text differs/,
    );
  });
});

describe('loadChips / runExamples', () => {
  let dir = '';
  beforeAll(async () => {
    dir = await mkdtemp(join(tmpdir(), 'tsbs-examples-'));
  });
  afterAll(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  it('falls back to the 05 §6 chips when examples.json is missing, else reads it', async () => {
    const fallback = await loadChips(join(dir, 'missing.json'));
    expect(fallback.chips).toHaveLength(19);
    expect(fallback.warning).toMatch(/not found/);
    await writeFile(
      join(dir, 'examples.json'),
      JSON.stringify([{ key: 'p', fixtureCase: 'en-paragraph', text: 'x', label: { en: 'p' } }]),
    );
    const read = await loadChips(join(dir, 'examples.json'));
    expect(read).toEqual({ chips: [{ fixtureCase: 'en-paragraph', text: 'x', paragraph: true }], warning: null });
  });

  it('writes nine lazy files plus the default and the index', async () => {
    await runExamples({ fixtures: FIXTURES, chips: join(dir, 'missing.json'), out: join(dir, 'out') });
    const names = await readdir(join(dir, 'out'));
    expect(names).toHaveLength(11);
    expect(names).toContain('examples-default.json');
    expect(names).toContain('examples-index.json');
  });
});
