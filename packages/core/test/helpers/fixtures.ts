/**
 * Test-only access to the committed golden fixtures and Unicode tables (read from the repository with node:fs, cached).
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import type {
  Fixture,
  FixtureTokenizerRef,
  SpmFixture,
  SpmFixtureCase,
  TiktokenFixture,
  TiktokenFixtureCase,
  TokenizerId,
} from '../../src/index.ts';

const ROOT = fileURLToPath(new URL('../../../../', import.meta.url));

/** The nine shipping tokenizers (ctok fixtures are Phase 2, AD-30). */
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

/** Tokenizer refs as the registry will declare them (family + BOS id, 03 §B.7 / 04 §3.1). */
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

/** `fixtures/<id>.json`. */
export function loadFixture(id: TokenizerId): Fixture {
  let fixture = cache.get(id);
  if (fixture === undefined) {
    fixture = JSON.parse(readFileSync(`${ROOT}fixtures/${id}.json`, 'utf8')) as Fixture;
    cache.set(id, fixture);
  }
  return fixture;
}

export function tiktokenFixture(id: TokenizerId): TiktokenFixture {
  const f = loadFixture(id);
  if (f.family !== 'tiktoken-bpe') throw new Error(`${id} is not a tiktoken fixture`);
  return f;
}

export function spmFixture(id: TokenizerId): SpmFixture {
  const f = loadFixture(id);
  if (f.family !== 'sentencepiece-bpe') throw new Error(`${id} is not a sentencepiece fixture`);
  return f;
}

export function caseOf(id: TokenizerId, name: string): TiktokenFixtureCase | SpmFixtureCase {
  const c = (loadFixture(id).cases as ReadonlyArray<TiktokenFixtureCase | SpmFixtureCase>).find((x) => x.name === name);
  if (c === undefined) throw new Error(`${id} has no case ${name}`);
  return c;
}

export const TIKTOKEN_IDS = SHIPPING.filter((id) => loadFixture(id).family === 'tiktoken-bpe');

export interface UnicodeTables {
  readonly classes: Readonly<Record<string, ReadonlyArray<readonly [number, number]>>>;
  readonly normalization: {
    readonly cccNonZero: ReadonlyArray<readonly [number, number]>;
    readonly nfkcQcNotYes: ReadonlyArray<readonly [number, number]>;
  };
}

let tables: UnicodeTables | undefined;

/** tools/oracle/unicode_tables.json (the source WP02 converts to core/unicode/tables.generated.ts, AD-4). */
export function unicodeTables(): UnicodeTables {
  tables ??= JSON.parse(readFileSync(`${ROOT}tools/oracle/unicode_tables.json`, 'utf8')) as UnicodeTables;
  return tables;
}

/** Bytes of a fixture token's lowercase hex. */
export function hexBytes(hex: string): Uint8Array {
  const out = new Uint8Array(hex.length / 2);
  for (let i = 0; i < out.length; i++) out[i] = Number.parseInt(hex.slice(2 * i, 2 * i + 2), 16);
  return out;
}
