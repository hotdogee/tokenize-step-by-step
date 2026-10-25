/**
 * The `pnpm test:fuzz` harness itself (WP12), without Python: seeded generators (determinism, the 04 §7 alphabet, no
 * lone surrogates), the ddmin shrinker, the engine/oracle comparison, the divergence classifier, the candidate case
 * shape and the run loop over a fake oracle, engine and second opinion. The real run is `pnpm test:fuzz`.
 */
import { describe, expect, it } from 'vitest';
import type { Tokenizer, TokenizationResult } from '../../src/index.ts';
import { EXTRA_CODE_POINTS, readAlphabetFile, REPEAT_UNITS } from './alphabet.ts';
import { fixtureTokens, isPartial, toHex } from './candidates.ts';
import {
  classifyDivergence,
  jsWhitespaceDifference,
  nativeUnicodeDifference,
  pythonRegexDifference,
} from './classify.ts';
import { compareWithOracle, firstDifference } from './compare.ts';
import { GENERATOR_KINDS, generateStrings } from './generators.ts';
import type { OracleLike, OracleResult } from './oracle-client.ts';
import { asciiJson } from './oracle-client.ts';
import { createRng, fnv1a32 } from './prng.ts';
import { printable } from './report.ts';
import { runTokenizer } from './run.ts';
import { shrink } from './shrink.ts';

const alphabet = readAlphabetFile();
const LONE_SURROGATE = /[\ud800-\udbff](?![\udc00-\udfff])|(?<![\ud800-\udbff])[\udc00-\udfff]/;

describe('prng', () => {
  it('is deterministic per (seed, stream) and differs across streams', () => {
    const draw = (seed: number, stream: string) => {
      const rng = createRng(seed, stream);
      return Array.from({ length: 8 }, () => rng.int(1000));
    };
    expect(draw(20261025, 'a')).toEqual(draw(20261025, 'a'));
    expect(draw(20261025, 'a')).not.toEqual(draw(20261025, 'b'));
    expect(draw(20261025, 'a')).not.toEqual(draw(20261026, 'a'));
    expect(fnv1a32('')).toBe(0x811c9dc5);
  });

  it('stays in range', () => {
    const rng = createRng(1, 'range');
    for (let i = 0; i < 10_000; i++) {
      const x = rng.next();
      expect(x >= 0 && x < 1).toBe(true);
      const k = rng.between(3, 5);
      expect(k >= 3 && k <= 5).toBe(true);
    }
    expect(() => createRng(-1, 'x')).toThrow(RangeError);
    expect(() => rng.int(0)).toThrow(RangeError);
  });
});

describe('generators (04 §7)', () => {
  const strings = generateStrings(alphabet, 20261025, 'openai-o200k_base', 2000);

  it('are deterministic, and string i does not depend on n', () => {
    expect(generateStrings(alphabet, 20261025, 'openai-o200k_base', 2000)).toEqual(strings);
    expect(generateStrings(alphabet, 20261025, 'openai-o200k_base', 10)).toEqual(strings.slice(0, 10));
    expect(generateStrings(alphabet, 20261025, 'google-gemma4', 10)).not.toEqual(strings.slice(0, 10));
  });

  it('use every kind and the extra classes of 04 §7', () => {
    for (const kind of GENERATOR_KINDS) expect(strings.some((s) => s.kind === kind)).toBe(true);
    const all = strings.map((s) => s.text).join('');
    const extras = [
      ...EXTRA_CODE_POINTS.informationSeparators,
      EXTRA_CODE_POINTS.nel,
      EXTRA_CODE_POINTS.bom,
      EXTRA_CODE_POINTS.lineSeparator,
      EXTRA_CODE_POINTS.paragraphSeparator,
      EXTRA_CODE_POINTS.ideographicSpace,
      EXTRA_CODE_POINTS.zwj,
      EXTRA_CODE_POINTS.vs16,
      EXTRA_CODE_POINTS.spmMark,
      EXTRA_CODE_POINTS.longS,
    ];
    for (const cp of extras) expect(all.includes(String.fromCodePoint(cp)), `U+${cp.toString(16)}`).toBe(true);
    expect(/[\u{10000}-\u{10ffff}]/u.test(all)).toBe(true); // surrogate pairs
    expect(/'(?:[sſS]|[tT]|re|RE|Re|rE|ve|VE|m|M|ll|LL|d|D)/u.test(all)).toBe(true); // contractions
    for (const unit of REPEAT_UNITS) expect(all.includes(unit.repeat(9)), JSON.stringify(unit)).toBe(true);
  });

  it('never produce lone surrogates and stay a few hundred code points long at most', () => {
    for (const s of strings) {
      expect(LONE_SURROGATE.test(s.text)).toBe(false);
      expect(Array.from(s.text).length).toBeLessThanOrEqual(400);
    }
  });
});

describe('shrink (ddmin over code points)', () => {
  const batch = (fails: (text: string) => boolean) => (texts: readonly string[]) => Promise.resolve(texts.map(fails));

  it('reduces to the failure-inducing code points', async () => {
    const result = await shrink(
      'abcdefxghijklmnopyqrst',
      batch((t) => t.includes('x') && t.includes('y')),
    );
    expect(result.text).toBe('xy');
  });

  it('never splits a surrogate pair', async () => {
    const result = await shrink(
      'ab𰻝cd台',
      batch((t) => t.includes('𰻝')),
    );
    expect(result.text).toBe('𰻝');
  });

  it('keeps a text that cannot shrink', async () => {
    expect(
      (
        await shrink(
          'z',
          batch(() => true),
        )
      ).text,
    ).toBe('z');
  });
});

describe('comparison', () => {
  const oracle = {
    ids: [1, 2],
    spans: [
      [0, 1],
      [1, 3],
    ] as const,
    cross: null,
    crossNote: null,
  };

  it('reports ids before spans and engine errors', () => {
    const spans = (...pairs: Array<readonly [number, number]>) => pairs;
    expect(compareWithOracle({ ids: [1, 2], spans: spans([0, 1], [1, 3]) }, oracle)).toBeNull();
    expect(compareWithOracle({ ids: [1, 3], spans: spans([0, 1], [1, 3]) }, oracle)).toEqual({ kind: 'ids', at: 1 });
    expect(compareWithOracle({ ids: [1, 2], spans: spans([0, 2], [2, 3]) }, oracle)).toEqual({ kind: 'spans', at: 0 });
    expect(compareWithOracle({ error: 'boom' }, oracle)).toEqual({ kind: 'engine-error', message: 'boom' });
    expect(firstDifference([1], [1, 2], (a, b) => a === b)).toBe(1);
  });
});

describe('divergence classes', () => {
  const base = { specials: ['<|endoftext|>'] } as const;

  it('names each known cause', () => {
    expect(classifyDivergence({ ...base, text: 'x', engine: 'gemma3-spm', crossNote: 'literal' }).class).toBe(
      'gemma3-literal-special',
    );
    expect(classifyDivergence({ ...base, text: '\n\n\n', engine: 'gemma3-spm' }).class).toBe('hf-vs-spm-tie-break');
    expect(classifyDivergence({ ...base, text: 'a<|endoftext|>', engine: 'node-regex' }).class).toBe('special-string');
    expect(classifyDivergence({ ...base, text: 'a\u0085b', engine: 'node-regex' }).class).toBe('js-whitespace-class');
    expect(classifyDivergence({ ...base, text: '\u{32828}:m', engine: 'node-regex' }).class).toBe('unicode-version');
    expect(classifyDivergence({ ...base, text: '\u{332f9}_Z', engine: 'python-regex' }).class).toBe('unicode-version');
    expect(classifyDivergence({ ...base, text: " I'ſ", engine: 'node-regex' }).class).toBe('case-fold');
    expect(classifyDivergence({ ...base, text: 'plain', engine: 'unicode-16' }).class).toBe('unclassified');
  });

  it('detects the class differences it relies on', () => {
    expect(jsWhitespaceDifference('a\ufeff')).toContain('U+FEFF');
    expect(jsWhitespaceDifference('a b\tc\u3000')).toBeNull();
    expect(nativeUnicodeDifference('台灣 abc 123')).toBeNull();
    expect(pythonRegexDifference('台灣')).toBeNull();
  });
});

describe('candidate cases', () => {
  it('use the fixture token shape (bytes hex, partial, zeroWidth)', () => {
    const tokens = fixtureTokens(
      '灣a',
      [1, 2, 3, 4],
      [
        [0, 0],
        [0, 2],
        [2, 3],
        [3, 4],
      ],
    );
    expect(tokens.map((t) => [t.bytes, t.partial, t.zeroWidth])).toEqual([
      ['', false, true],
      ['e781', true, false],
      ['a3', true, false],
      ['61', false, false],
    ]);
    expect(isPartial(new Uint8Array([0xef, 0xbb, 0xbf]))).toBe(false); // a BOM alone is complete UTF-8
    expect(toHex(new Uint8Array([0, 255]))).toBe('00ff');
  });

  it('print invisible characters as escapes and send ASCII JSON', () => {
    expect(printable('a\u0085\ufeff\n"')).toBe('"a\\u{85}\\u{feff}\\n\\""');
    expect(asciiJson({ t: '台\u{30edd}' })).toBe('{"t":"\\u53f0\\ud883\\udedd"}');
  });
});

describe('runTokenizer with fakes', () => {
  /** A fake engine that tokenizes per code point and misreads every "!" as id 0. */
  const fakeEngine = {
    info: { specials: [{ id: 99, text: '<s>' }] },
    encode(text: string): TokenizationResult {
      const ids: number[] = [];
      const starts: number[] = [0];
      let pos = 0;
      for (const ch of text) {
        ids.push(ch === '!' ? 0 : (ch.codePointAt(0) ?? 0));
        pos += new TextEncoder().encode(ch).length;
        starts.push(pos);
      }
      return { tokens: { count: ids.length, id: Uint32Array.from(ids), byteStart: Uint32Array.from(starts) } } as never;
    },
  } as unknown as Tokenizer;

  /** The fake oracle: per code point ids; "#" is an oracle error; the cross-check disagrees on "~". */
  const fakeOracle: OracleLike = {
    request(texts) {
      const results: Record<string, OracleResult[]> = {};
      for (const [id, list] of Object.entries(texts)) {
        results[id] = list.map((text) => {
          if (text.includes('#')) return { error: 'cannot' };
          const ids = Array.from(text, (ch) => ch.codePointAt(0) ?? 0);
          let pos = 0;
          const spans = Array.from(text, (ch) => {
            const start = pos;
            pos += new TextEncoder().encode(ch).length;
            return [start, pos] as const;
          });
          return { ids, spans, cross: text.includes('~') ? [0] : ids, crossNote: null };
        });
      }
      return Promise.resolve({ results, oracles: { 'xai-grok1': { library: 'fake', crossLibrary: 'fake cross' } } });
    },
    close: () => Promise.resolve(),
  };

  it('finds the engine mismatches, shrinks them and counts divergences', async () => {
    const report = await runTokenizer({
      tokenizer: 'xai-grok1',
      seed: 20261025,
      n: 300,
      alphabet,
      oracle: fakeOracle,
      engine: fakeEngine,
      secondOpinion: null,
    });
    expect(report.strings).toBe(300);
    expect(report.idMismatches).toBeGreaterThan(0);
    const mismatch = report.cases.find((c) => c.classification === 'engine-mismatch');
    expect(mismatch?.minimal?.text).toBe('!');
    expect(mismatch?.tokens?.length).toBe(Array.from(mismatch?.text ?? '').length);
    expect(report.oracleErrors).toBeGreaterThan(0);
    expect(report.opinions).toHaveLength(1);
    expect(report.opinions[0]?.compared).toBeGreaterThan(0);
    expect(report.failures).toBe(
      report.idMismatches + report.oracleErrors + (report.opinions[0]?.divergences.unclassified ?? 0),
    );
  });
});
