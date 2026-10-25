/**
 * `grok2Json` parser (03 §C.5): xAI Grok-2 `tokenizer.tok.json`. PCES from `regular_tokens[].bytes` ordered by id
 * (ids 128..131,071, idOffset 128; rank = token id as SGLang builds it), SPCL from `special_tokens` (ids 0..127) in
 * file order. Asserts `reserved_tokens === 128`, single-byte tokens at id 128 + byte, and `word_split === "V1"`.
 */
import type { SpecialEntry, VocabTables } from '../tables.ts';
import { assertByteLevelPieces, assertSpecialsOutside } from './bytelevel-checks.ts';

export const GROK2_ID_OFFSET = 128;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function tokenBytes(value: unknown, where: string): Uint8Array {
  if (!Array.isArray(value) || !value.every((b) => Number.isInteger(b) && (b as number) >= 0 && (b as number) <= 255))
    throw new Error(`${where}: bytes must be an array of 0..255`);
  return Uint8Array.from(value as number[]);
}

function tokenId(entry: unknown, where: string): { id: number; bytes: Uint8Array } {
  if (!isRecord(entry) || !Number.isSafeInteger(entry['token'])) throw new Error(`${where}: expected { bytes, token }`);
  return { id: entry['token'] as number, bytes: tokenBytes(entry['bytes'], where) };
}

/** Parses tokenizer.tok.json text into byte-level tables. */
export function parseGrok2Json(text: string): VocabTables {
  const label = 'xai-grok2';
  const data: unknown = JSON.parse(text);
  if (!isRecord(data)) throw new Error(`${label}: not an object`);
  if (data['word_split'] !== 'V1') throw new Error(`${label}: word_split must be "V1"`);
  if ('pat_str' in data) throw new Error(`${label}: an explicit pat_str is not supported (V1 pattern expected)`);
  if (data['reserved_tokens'] !== GROK2_ID_OFFSET)
    throw new Error(`${label}: reserved_tokens must be ${String(GROK2_ID_OFFSET)}`);
  const regular = data['regular_tokens'];
  const special = data['special_tokens'];
  if (!Array.isArray(regular) || !Array.isArray(special))
    throw new Error(`${label}: regular_tokens / special_tokens missing`);

  const byIndex: Array<Uint8Array | undefined> = new Array<Uint8Array | undefined>(regular.length);
  regular.forEach((entry: unknown, i) => {
    const { id, bytes } = tokenId(entry, `${label} regular_tokens[${String(i)}]`);
    const index = id - GROK2_ID_OFFSET;
    if (index < 0 || index >= regular.length)
      throw new Error(`${label}: regular token id ${String(id)} outside 128..${String(127 + regular.length)}`);
    if (byIndex[index] !== undefined) throw new Error(`${label}: regular token id ${String(id)} appears twice`);
    byIndex[index] = bytes;
  });
  const pieces = byIndex.map((piece, index) => {
    if (piece === undefined) throw new Error(`${label}: id ${String(index + GROK2_ID_OFFSET)} missing`);
    return piece;
  });
  assertByteLevelPieces(label, pieces);
  pieces.forEach((piece, index) => {
    if (piece.length === 1 && piece[0] !== index)
      throw new Error(
        `${label}: single byte ${String(piece[0])} has id ${String(index + GROK2_ID_OFFSET)}, expected ${String((piece[0] ?? 0) + GROK2_ID_OFFSET)}`,
      );
  });
  if (data['vocab_size'] !== GROK2_ID_OFFSET + pieces.length)
    throw new Error(`${label}: vocab_size ${JSON.stringify(data['vocab_size'])} != 128 + ${String(pieces.length)}`);

  const decoder = new TextDecoder('utf-8', { fatal: true });
  const specials: SpecialEntry[] = special.map((entry: unknown, i) => {
    const { id, bytes } = tokenId(entry, `${label} special_tokens[${String(i)}]`);
    if (id >= GROK2_ID_OFFSET)
      throw new Error(`${label}: special id ${String(id)} is not below ${String(GROK2_ID_OFFSET)}`);
    return { id, text: decoder.decode(bytes) };
  });
  if (specials.length !== GROK2_ID_OFFSET)
    throw new Error(`${label}: ${String(specials.length)} specials, expected 128`);
  assertSpecialsOutside(label, specials, GROK2_ID_OFFSET, pieces.length);

  return {
    tokenizerId: 'xai-grok2',
    family: 'bytelevel-bpe',
    pieces,
    types: null,
    scores: null,
    merges: null,
    specials,
    config: { idOffset: GROK2_ID_OFFSET },
    notes: [
      `${String(pieces.length)} regular tokens at ids 128..${String(127 + pieces.length)}`,
      `${String(specials.length)} specials`,
    ],
  };
}
