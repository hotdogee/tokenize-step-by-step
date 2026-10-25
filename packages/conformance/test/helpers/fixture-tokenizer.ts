/**
 * Test-only `Tokenizer` that answers from a golden fixture through `fromFixtureCase`, so the conformance runner can be
 * exercised end to end before the engines exist (and negative tests can corrupt its output on purpose).
 *
 * `specialTokens: 'match'` returns the fixture's `idsWithSpecials` with synthetic spans: tokens shared with the default
 * ids keep their spans, the differing middle gets one code point per token and the rest goes to the last one, which
 * becomes a SpecialString chunk. Only the ids of that mode are asserted by `runFixture`.
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import {
  analyzeText,
  buildResult,
  ChunkKind,
  DEFAULT_OPTIONS,
  fixturePieceOf,
  fromFixtureCase,
  nfkcSegmentStart,
  TokenKind,
  type EncodeOptions,
  type Fixture,
  type FixtureTokenizerRef,
  type SpmFixtureCase,
  type TiktokenFixtureCase,
  type TokenizationResult,
  type Tokenizer,
  type TokenizerId,
} from '@tsbs/core';

const ROOT = fileURLToPath(new URL('../../../../', import.meta.url));

export const SHIPPING: readonly TokenizerId[] = [
  'openai-o200k_base',
  'openai-cl100k_base',
  'anthropic-claude-legacy',
  'google-gemma4',
  'google-gemma2',
  'meta-llama4-muse',
  'meta-llama3',
  'xai-grok2',
  'xai-grok1',
];

export const REFS: Readonly<Record<TokenizerId, FixtureTokenizerRef>> = {
  'openai-o200k_base': { id: 'openai-o200k_base', family: 'bytelevel-bpe', engine: { bosId: null } },
  'openai-cl100k_base': { id: 'openai-cl100k_base', family: 'bytelevel-bpe', engine: { bosId: null } },
  'anthropic-claude-legacy': { id: 'anthropic-claude-legacy', family: 'bytelevel-bpe', engine: { bosId: null } },
  'google-gemma4': { id: 'google-gemma4', family: 'spm-bpe', engine: { bosId: 2 } },
  'google-gemma2': { id: 'google-gemma2', family: 'spm-bpe', engine: { bosId: 2 } },
  'meta-llama4-muse': { id: 'meta-llama4-muse', family: 'bytelevel-bpe', engine: { bosId: 200000 } },
  'meta-llama3': { id: 'meta-llama3', family: 'bytelevel-bpe', engine: { bosId: 128000 } },
  'xai-grok2': { id: 'xai-grok2', family: 'bytelevel-bpe', engine: { bosId: null } },
  'xai-grok1': { id: 'xai-grok1', family: 'spm-bpe', engine: { bosId: 1 } },
};

const cache = new Map<string, Fixture>();

export function loadFixture(id: TokenizerId): Fixture {
  let fixture = cache.get(id);
  if (fixture === undefined) {
    fixture = JSON.parse(readFileSync(`${ROOT}fixtures/${id}.json`, 'utf8')) as Fixture;
    cache.set(id, fixture);
  }
  return fixture;
}

interface Tables {
  readonly normalization: {
    readonly cccNonZero: ReadonlyArray<readonly [number, number]>;
    readonly nfkcQcNotYes: ReadonlyArray<readonly [number, number]>;
  };
}
const tables = JSON.parse(readFileSync(`${ROOT}tools/oracle/unicode_tables.json`, 'utf8')) as Tables;
const cut = nfkcSegmentStart(tables.normalization);

/** The `'match'` result: `ids` with synthetic spans aligned on the default result (see the module comment). */
function matchResult(base: TokenizationResult, ids: readonly number[]): TokenizationResult {
  const baseIds = Array.from(base.tokens.id);
  let p = 0;
  while (p < baseIds.length && p < ids.length && baseIds[p] === ids[p]) p++;
  let s = 0;
  while (s < baseIds.length - p && s < ids.length - p && baseIds[baseIds.length - 1 - s] === ids[ids.length - 1 - s])
    s++;
  const starts = Array.from(base.tokens.byteStart);
  const midStart = starts[p] ?? 0;
  const midEnd = starts[baseIds.length - s] ?? base.utf8.length;
  const middle = ids.length - p - s;
  const cpStarts = Array.from(base.chars.byteStart).filter((b) => b > midStart && b < midEnd);
  const tokenStarts = [
    ...starts.slice(0, p + 1),
    ...cpStarts.slice(0, Math.max(0, middle - 1)),
    ...starts.slice(baseIds.length - s),
  ];
  const kinds = [
    ...Array.from(base.tokens.kind.subarray(0, p)),
    ...Array.from({ length: middle }, (_, k) => (k === middle - 1 ? TokenKind.Special : TokenKind.Normal)),
    ...Array.from(base.tokens.kind.subarray(baseIds.length - s)),
  ];
  const isCp = new Set(Array.from(base.chars.byteStart));
  const chunkStarts = [...new Set(tokenStarts.slice(0, -1).filter((b) => isCp.has(b)))];
  const specialStart = tokenStarts[p + middle - 1] ?? -1;
  const specialEnd = tokenStarts[p + middle] ?? -1;
  const plain = base.family === 'spm-bpe' ? ChunkKind.SpmText : ChunkKind.Regex;
  const chunkKinds = chunkStarts.map((b, i) =>
    b === specialStart && (chunkStarts[i + 1] ?? base.utf8.length) === specialEnd ? ChunkKind.SpecialString : plain,
  );
  return buildResult({
    tokenizer: base.tokenizer,
    family: base.family,
    options: { ...base.options, specialTokens: 'match', trace: false },
    analysis: analyzeText(base.text),
    chunks: { byteStart: [...chunkStarts, base.utf8.length], kind: chunkKinds },
    tokens: { id: ids, byteStart: tokenStarts, kind: kinds },
    timeline: null,
  });
}

/** A `Tokenizer` over the fixture of `id`. */
export function fixtureTokenizer(id: TokenizerId): Tokenizer {
  const fixture = loadFixture(id);
  const ref = REFS[id];
  const cases = fixture.cases as ReadonlyArray<TiktokenFixtureCase | SpmFixtureCase>;
  const byText = new Map<string, TiktokenFixtureCase | SpmFixtureCase>();
  for (const c of cases) if (!byText.has(c.text)) byText.set(c.text, c);
  const pieceOf = fixturePieceOf(fixture);
  const encode = (text: string, options: Partial<EncodeOptions> = {}): TokenizationResult => {
    const o = { ...DEFAULT_OPTIONS, ...options };
    const c = byText.get(text);
    if (c === undefined) throw new Error(`text not in ${id}`);
    if (o.normalize === 'NFKC')
      return fromFixtureCase(fixture, c.name, ref, { normalize: 'NFKC', nfkcSegmentStart: cut });
    const base = fromFixtureCase(fixture, c.name, ref, { addBos: o.addBos, merges: o.trace !== false });
    return o.specialTokens === 'match' && c.idsWithSpecials ? matchResult(base, c.idsWithSpecials) : base;
  };
  return {
    info: {
      id,
      family: ref.family,
      vocabSize: 0,
      rankCount: 0,
      specials: [],
      bosId: ref.engine?.bosId ?? null,
      unicodeVersion: '16.0.0',
      sourceSha256: fixture.vocabSha256,
      supports: {
        nfkc: id === 'anthropic-claude-legacy',
        bos: (ref.engine?.bosId ?? null) !== null,
        specialsToggle: true,
      },
    },
    encode,
    *encodeIncremental(text, options) {
      yield { bytesDone: 0, bytesTotal: analyzeText(text, { segmenter: null }).utf8.length };
      return encode(text, options);
    },
    tokenBytes: () => null,
    pieceString: (tokenId) => (ref.family === 'spm-bpe' ? pieceOf(tokenId) : null),
    idOf: () => null,
    pretokenize: (text) => {
      const r = encode(text);
      return Array.from(
        { length: r.chunks.count },
        (_, k) => [r.chunks.byteStart[k] ?? 0, r.chunks.byteStart[k + 1] ?? 0] as const,
      );
    },
    dispose: () => undefined,
  };
}

/** Wraps a tokenizer, rewriting `encode` results (negative tests). */
export function corrupt(
  inner: Tokenizer,
  rewrite: (r: TokenizationResult, text: string, options: Partial<EncodeOptions>) => TokenizationResult,
  overrides: Partial<Tokenizer> = {},
): Tokenizer {
  const encode = (text: string, options: Partial<EncodeOptions> = {}): TokenizationResult =>
    rewrite(inner.encode(text, options), text, options);
  return {
    ...inner,
    encode,
    *encodeIncremental(text, options) {
      yield { bytesDone: 0, bytesTotal: 0 };
      return encode(text, options);
    },
    ...overrides,
  };
}
