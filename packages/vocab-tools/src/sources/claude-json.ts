/**
 * `claudeJson` parser (03 §C.5): the archived `@anthropic-ai/tokenizer` 0.0.4 `claude.json`. `bpe_ranks` is in the
 * tiktoken/lite format (`! <offset> <b64> <b64> …` lines; one line with offset 5 today), so ranks 5..64,999 become
 * PCES with idOffset 5; `special_tokens` (<EOT> 0 … <SOS> 4) become SPCL in key order. `explicit_n_vocab` (64,739)
 * matches neither the 64,995 ranks nor the 65,000 ids and is ignored, as the archived package ignored it.
 */
import type { SpecialEntry, VocabTables } from '../tables.ts';
import { assertByteLevelPieces, assertSpecialsOutside, decodeBase64Strict } from './bytelevel-checks.ts';
import { CLAUDE_LEGACY_PAT_STR } from './patterns.ts';

/** Expected rank count (64,995) and id offset (5) of the shipped file. */
export const CLAUDE_RANK_COUNT = 64_995;
export const CLAUDE_ID_OFFSET = 5;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** Options for tests on synthetic inputs (the real file uses the defaults). */
export interface ClaudeJsonOptions {
  readonly expectedRankCount?: number;
}

/** Parses claude.json text into byte-level tables. */
export function parseClaudeJson(text: string, options: ClaudeJsonOptions = {}): VocabTables {
  const label = 'anthropic-claude-legacy';
  const data: unknown = JSON.parse(text);
  if (!isRecord(data)) throw new Error(`${label}: claude.json is not an object`);
  const { bpe_ranks: bpeRanks, special_tokens: specialTokens, pat_str: patStr } = data;
  if (typeof bpeRanks !== 'string' || !isRecord(specialTokens) || typeof patStr !== 'string')
    throw new Error(`${label}: claude.json lacks bpe_ranks / special_tokens / pat_str`);
  if (patStr !== CLAUDE_LEGACY_PAT_STR) throw new Error(`${label}: pat_str differs from the claude-legacy template`);

  const byId: Array<Uint8Array | undefined> = [];
  let firstId = Infinity;
  for (const line of bpeRanks.split('\n')) {
    if (line === '') continue;
    const [marker, offsetText, ...tokens] = line.split(' ');
    if (marker !== '!' || offsetText === undefined || !/^\d+$/.test(offsetText))
      throw new Error(`${label}: unexpected bpe_ranks line prefix "${line.slice(0, 20)}"`);
    const offset = Number(offsetText);
    firstId = Math.min(firstId, offset);
    tokens.forEach((b64, i) => {
      if (byId[offset + i] !== undefined) throw new Error(`${label}: rank ${String(offset + i)} appears twice`);
      byId[offset + i] = decodeBase64Strict(b64, `${label} rank ${String(offset + i)}`);
    });
  }
  if (firstId !== CLAUDE_ID_OFFSET)
    throw new Error(`${label}: ranks start at ${String(firstId)}, expected ${String(CLAUDE_ID_OFFSET)}`);
  const pieces: Uint8Array[] = [];
  for (let id = CLAUDE_ID_OFFSET; id < byId.length; id++) {
    const piece = byId[id];
    if (piece === undefined) throw new Error(`${label}: ranks are not contiguous (id ${String(id)} missing)`);
    pieces.push(piece);
  }
  const expected = options.expectedRankCount ?? CLAUDE_RANK_COUNT;
  if (pieces.length !== expected)
    throw new Error(`${label}: ${String(pieces.length)} ranks, expected ${String(expected)}`);
  assertByteLevelPieces(label, pieces);

  const specials: SpecialEntry[] = Object.entries(specialTokens).map(([text, id]) => {
    if (!Number.isSafeInteger(id)) throw new Error(`${label}: special ${text} has a non-integer id`);
    return { id: id as number, text };
  });
  assertSpecialsOutside(label, specials, CLAUDE_ID_OFFSET, pieces.length);
  if (specials.some((s) => s.id >= CLAUDE_ID_OFFSET))
    throw new Error(`${label}: specials must use ids below the offset`);

  return {
    tokenizerId: 'anthropic-claude-legacy',
    family: 'bytelevel-bpe',
    pieces,
    types: null,
    scores: null,
    merges: null,
    specials,
    config: { idOffset: CLAUDE_ID_OFFSET },
    notes: [
      `${String(pieces.length)} ranks at ids ${String(CLAUDE_ID_OFFSET)}..${String(CLAUDE_ID_OFFSET + pieces.length - 1)}`,
      `explicit_n_vocab ${JSON.stringify(data['explicit_n_vocab'])} ignored (matches neither the rank count nor the id range)`,
    ],
  };
}
