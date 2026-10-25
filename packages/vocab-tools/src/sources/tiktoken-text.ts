/**
 * `tiktokenText` parser (03 §C.5): `base64 rank` lines (o200k_base, cl100k_base, Llama 3 `tokenizer.model`).
 * PCES in rank order; SPCL from a committed specials table (`sources/specials/<tokenizerId>.json`, AD-12), because the
 * rank file itself carries none.
 */
import type { TokenizerId } from '@tsbs/core';
import type { SpecialEntry, TableConfig, VocabTables } from '../tables.ts';
import { assertByteLevelPieces, assertSpecialsOutside, decodeBase64Strict } from './bytelevel-checks.ts';

/** Options for {@link parseTiktokenText}. */
export interface TiktokenTextOptions {
  readonly tokenizerId: TokenizerId;
  readonly specials: readonly SpecialEntry[];
  /** BOS id recorded in META (Llama 3: `<|begin_of_text|>` 128000); omitted for OpenAI. */
  readonly bosId?: number;
}

/** Parses the text of a tiktoken rank file into rank-ordered byte strings (ranks must be exactly 0..N−1). */
export function parseTiktokenRanks(text: string, label: string): Uint8Array[] {
  const pieces: Array<Uint8Array | undefined> = [];
  let lineNo = 0;
  for (const line of text.split('\n')) {
    lineNo++;
    const trimmed = line.endsWith('\r') ? line.slice(0, -1) : line;
    if (trimmed === '') continue;
    const parts = trimmed.split(' ');
    const [b64, rankText] = parts;
    if (parts.length !== 2 || b64 === undefined || rankText === undefined || !/^\d+$/.test(rankText))
      throw new Error(`${label}:${String(lineNo)}: expected "<base64> <rank>"`);
    const rank = Number(rankText);
    if (pieces[rank] !== undefined) throw new Error(`${label}:${String(lineNo)}: rank ${String(rank)} appears twice`);
    pieces[rank] = decodeBase64Strict(b64, `${label}:${String(lineNo)}`);
  }
  const dense: Uint8Array[] = [];
  for (let rank = 0; rank < pieces.length; rank++) {
    const piece = pieces[rank];
    if (piece === undefined) throw new Error(`${label}: ranks are not contiguous (rank ${String(rank)} missing)`);
    dense.push(piece);
  }
  return dense;
}

/** Parses a tiktoken rank file into byte-level tables. */
export function parseTiktokenText(text: string, options: TiktokenTextOptions): VocabTables {
  const label = options.tokenizerId;
  const pieces = parseTiktokenRanks(text, label);
  assertByteLevelPieces(label, pieces);
  assertSpecialsOutside(label, options.specials, 0, pieces.length);
  const config: TableConfig = { idOffset: 0, ...(options.bosId === undefined ? {} : { bosId: options.bosId }) };
  return {
    tokenizerId: options.tokenizerId,
    family: 'bytelevel-bpe',
    pieces,
    types: null,
    scores: null,
    merges: null,
    specials: options.specials,
    config,
    notes: [`${String(pieces.length)} ranks`, `${String(options.specials.length)} specials from the committed table`],
  };
}
