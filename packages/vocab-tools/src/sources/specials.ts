/**
 * Committed special-token tables for sources whose vocabulary file carries none (03 §C.5 `tiktokenText`): each
 * `specials/<tokenizerId>.json` records the upstream file, pinned revision and symbol it was copied from, and the
 * tokens in source order (AD-12).
 */
import { readFile } from 'node:fs/promises';
import type { SpecialEntry } from '../tables.ts';

/** Shape of `sources/specials/<tokenizerId>.json`. */
export interface SpecialsTable {
  readonly tokenizer: string;
  readonly source: { readonly url: string; readonly revision: string; readonly tag: string; readonly symbol: string };
  readonly specials: readonly SpecialEntry[];
}

/** Tokenizers that have a committed specials table. */
export const SPECIALS_TABLES = ['openai-o200k_base', 'openai-cl100k_base', 'meta-llama3'] as const;
export type SpecialsTableId = (typeof SPECIALS_TABLES)[number];

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** Validates a parsed specials table. */
export function parseSpecialsTable(value: unknown, label: string): SpecialsTable {
  if (!isRecord(value) || typeof value['tokenizer'] !== 'string' || !isRecord(value['source']))
    throw new Error(`${label}: not a specials table`);
  const source = value['source'];
  const fields = ['url', 'revision', 'tag', 'symbol'] as const;
  for (const field of fields)
    if (typeof source[field] !== 'string') throw new Error(`${label}: source.${field} must be a string`);
  const list = value['specials'];
  if (!Array.isArray(list)) throw new Error(`${label}: specials must be an array`);
  const specials = list.map((entry: unknown, index): SpecialEntry => {
    if (!isRecord(entry) || !Number.isSafeInteger(entry['id']) || typeof entry['text'] !== 'string')
      throw new Error(`${label}: specials[${String(index)}] must be { id, text }`);
    return { id: entry['id'] as number, text: entry['text'] };
  });
  return {
    tokenizer: value['tokenizer'],
    source: {
      url: source['url'] as string,
      revision: source['revision'] as string,
      tag: source['tag'] as string,
      symbol: source['symbol'] as string,
    },
    specials,
  };
}

/** Loads the committed table of `tokenizerId`. */
export async function loadSpecialsTable(tokenizerId: SpecialsTableId): Promise<SpecialsTable> {
  const url = new URL(`./specials/${tokenizerId}.json`, import.meta.url);
  const table = parseSpecialsTable(JSON.parse(await readFile(url, 'utf8')), `specials/${tokenizerId}.json`);
  if (table.tokenizer !== tokenizerId) throw new Error(`specials/${tokenizerId}.json names ${table.tokenizer}`);
  return table;
}
