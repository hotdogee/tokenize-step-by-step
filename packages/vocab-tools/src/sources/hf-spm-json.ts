/**
 * `hfSpmJson` parser (03 §C.5): Gemma 4 `tokenizer.json` (HF tokenizers, SentencePiece-style BPE with byte fallback)
 * + `tokenizer_config.json` → PCES (id order), TYPS, MRGS, SPCL and META `{priority: 'merge-rank', fallbackOrder:
 * 'before-merge', unkId, bosId, eosId, padId}`.
 *
 * TYPS is derived from the JSON, the source of the ids (AD-31): BYTE = the 256 contiguous `<0xNN>` ids, UNK = the
 * `unk_token`, CONTROL = the other `added_tokens[special=true]`, everything else NORMAL — never USER_DEFINED (the
 * fixture's USER_DEFINED labels are Gemma 3 proto provenance only). MRGS keeps the exact HF merge list in rank order:
 * result piece id + split offset in UTF-16 units (AD-6).
 *
 * Asserts: normalizer exactly `Replace(" " → "▁")`; pre-tokenizer the no-op `Split(" ", MergedWithPrevious)`;
 * `model.ignore_merges === false`; `byte_fallback === true`; every merge's halves and result exist; every piece ≤ 255
 * UTF-16 units; no `added_tokens[special=false]` (TYPS could not express them). The A2 regeneration check is recorded
 * as `hfMergesRegenerable` (informational, never relied on).
 */
import { PieceType, type MergeTable, type SpecialEntry, type VocabTables } from '../tables.ts';

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

const BYTE_PIECE = /^<0x([0-9A-F]{2})>$/;
/** Pieces made of one repeated whitespace symbol: Gemma 3's USER_DEFINED score class (score 0). */
const WHITESPACE_RUN = /^(?:\n+|▁+|\t+)$/u;
const utf8 = new TextEncoder();

/** A merge as listed in `model.merges` (`[left, right]` pairs; the legacy "left right" string form is rejected). */
function mergePair(entry: unknown, rank: number): [string, string] {
  if (Array.isArray(entry) && entry.length === 2 && typeof entry[0] === 'string' && typeof entry[1] === 'string')
    return [entry[0], entry[1]];
  throw new Error(`google-gemma4: merge ${String(rank)} is not a [left, right] pair`);
}

/**
 * A2 regeneration check: HF `generate_merges` (every split of every piece into two vocabulary pieces, sorted by
 * `(score, len(left), len(right))` descending with a stable order and the per-piece splits pre-sorted by the halves'
 * ids), with scores derived from the JSON alone — whitespace-run pieces score 0, every other piece
 * `(byteFirstId + 256) − id`. True iff the regenerated list equals `merges` exactly.
 */
export function mergesRegenerable(
  vocab: ReadonlyMap<string, number>,
  idToPiece: readonly string[],
  merges: ReadonlyArray<readonly [string, string]>,
  byteFirstId: number,
): boolean {
  const firstNormal = byteFirstId + 256;
  const regenerated: Array<{ l: string; r: string; score: number }> = [];
  idToPiece.forEach((piece, id) => {
    const local: Array<{ l: string; r: string; li: number; ri: number }> = [];
    for (let i = 1; i < piece.length; i++) {
      const l = piece.slice(0, i);
      const r = piece.slice(i);
      const li = vocab.get(l);
      const ri = vocab.get(r);
      if (li !== undefined && ri !== undefined) local.push({ l, r, li, ri });
    }
    local.sort((a, b) => a.li - b.li || a.ri - b.ri);
    const score = WHITESPACE_RUN.test(piece) ? 0 : firstNormal - id;
    for (const { l, r } of local) regenerated.push({ l, r, score });
  });
  if (regenerated.length !== merges.length) return false;
  regenerated.sort((a, b) => b.score - a.score || b.l.length - a.l.length || b.r.length - a.r.length);
  return regenerated.every(({ l, r }, rank) => {
    const merge = merges[rank];
    return merge?.[0] === l && merge[1] === r;
  });
}

/** Options for synthetic inputs (the real file uses the defaults). */
export interface HfSpmJsonOptions {
  /** Run the ~1 s A2 regeneration check (default true). */
  readonly regenerationCheck?: boolean;
}

/** Parses Gemma 4 `tokenizer.json` + `tokenizer_config.json` (both already JSON-parsed) into spm tables. */
export function parseHfSpmJson(json: unknown, config: unknown, options: HfSpmJsonOptions = {}): VocabTables {
  const label = 'google-gemma4';
  if (!isRecord(json) || !isRecord(json['model']) || !Array.isArray(json['added_tokens']) || !isRecord(config))
    throw new Error(`${label}: not an HF tokenizer.json + tokenizer_config.json pair`);
  const { normalizer, pre_tokenizer: pre } = json;
  if (
    !isRecord(normalizer) ||
    normalizer['type'] !== 'Replace' ||
    JSON.stringify(normalizer['pattern']) !== '{"String":" "}' ||
    normalizer['content'] !== '▁'
  )
    throw new Error(`${label}: normalizer must be exactly Replace(" " → "▁")`);
  if (
    !isRecord(pre) ||
    pre['type'] !== 'Split' ||
    JSON.stringify(pre['pattern']) !== '{"String":" "}' ||
    pre['behavior'] !== 'MergedWithPrevious' ||
    pre['invert'] !== false
  )
    throw new Error(`${label}: pre_tokenizer must be the no-op Split(" ", MergedWithPrevious)`);
  const model = json['model'];
  if (model['type'] !== 'BPE') throw new Error(`${label}: model.type must be BPE`);
  if (model['ignore_merges'] !== false) throw new Error(`${label}: model.ignore_merges must be false`);
  if (model['byte_fallback'] !== true) throw new Error(`${label}: model.byte_fallback must be true`);
  if (model['dropout'] !== null && model['dropout'] !== undefined)
    throw new Error(`${label}: BPE dropout is not supported`);
  if (!isRecord(model['vocab']) || !Array.isArray(model['merges']))
    throw new Error(`${label}: model.vocab / model.merges missing`);

  const entries = Object.entries(model['vocab']);
  const idToPiece = new Array<string | undefined>(entries.length);
  const vocab = new Map<string, number>();
  for (const [piece, id] of entries) {
    if (
      !Number.isSafeInteger(id) ||
      (id as number) < 0 ||
      (id as number) >= entries.length ||
      idToPiece[id as number] !== undefined
    )
      throw new Error(
        `${label}: vocab ids are not a permutation of 0..${String(entries.length - 1)} (${JSON.stringify(piece)})`,
      );
    idToPiece[id as number] = piece;
    vocab.set(piece, id as number);
  }
  const pieceStrings = idToPiece.map((piece, id) => {
    if (piece === undefined) throw new Error(`${label}: vocab id ${String(id)} missing`);
    if (piece.length > 255)
      throw new Error(`${label}: piece ${String(id)} is ${String(piece.length)} UTF-16 units (> 255)`);
    return piece;
  });

  const types = new Uint8Array(pieceStrings.length).fill(PieceType.Normal);
  const byteIds = pieceStrings.flatMap((piece, id) => (BYTE_PIECE.test(piece) ? [id] : []));
  const byteFirstId = byteIds[0] ?? -1;
  if (byteIds.length !== 256 || byteIds.at(-1) !== byteFirstId + 255)
    throw new Error(`${label}: <0xNN> pieces are not 256 contiguous ids`);
  for (const id of byteIds) {
    const value = Number.parseInt(BYTE_PIECE.exec(pieceStrings[id] ?? '')?.[1] ?? '', 16);
    if (value !== id - byteFirstId)
      throw new Error(`${label}: byte piece ${String(id)} is not <0x${(id - byteFirstId).toString(16)}>`);
    types[id] = PieceType.Byte;
  }

  const idOfToken = (key: string): number => {
    const text = config[key];
    const id = typeof text === 'string' ? vocab.get(text) : undefined;
    if (id === undefined)
      throw new Error(`${label}: tokenizer_config ${key} ${JSON.stringify(text)} is not in the vocabulary`);
    return id;
  };
  const unkId = idOfToken('unk_token');
  if (model['unk_token'] !== config['unk_token'])
    throw new Error(`${label}: model.unk_token differs from tokenizer_config unk_token`);
  const added: unknown[] = json['added_tokens'];
  const specials: SpecialEntry[] = [];
  let nonSpecial = 0;
  added.forEach((entry, i) => {
    if (!isRecord(entry) || !Number.isSafeInteger(entry['id']) || typeof entry['content'] !== 'string')
      throw new Error(`${label}: added_tokens[${String(i)}] malformed`);
    const id = entry['id'] as number;
    if (vocab.get(entry['content']) !== id)
      throw new Error(`${label}: added token ${entry['content']} is not vocab id ${String(id)}`);
    if (entry['special'] !== true) {
      nonSpecial++;
      return;
    }
    specials.push({ id, text: entry['content'] });
    types[id] = id === unkId ? PieceType.Unk : PieceType.Control;
  });
  if (nonSpecial !== 0)
    throw new Error(
      `${label}: ${String(nonSpecial)} added_tokens[special=false] (not expressible without USER_DEFINED)`,
    );
  types[unkId] = PieceType.Unk;

  const rawMerges: unknown[] = model['merges'];
  const pairs = rawMerges.map((entry, rank) => mergePair(entry, rank));
  const resultId = new Uint32Array(pairs.length);
  const splitUtf16 = new Uint8Array(pairs.length);
  pairs.forEach(([left, right], rank) => {
    const id = vocab.get(left + right);
    if (!vocab.has(left) || !vocab.has(right) || id === undefined)
      throw new Error(
        `${label}: merge ${String(rank)} (${JSON.stringify(left)}, ${JSON.stringify(right)}) is not closed over the vocabulary`,
      );
    resultId[rank] = id;
    splitUtf16[rank] = left.length;
  });
  const merges: MergeTable = { resultId, splitUtf16 };
  const regenerable =
    options.regenerationCheck === false ? undefined : mergesRegenerable(vocab, pieceStrings, pairs, byteFirstId);

  return {
    tokenizerId: 'google-gemma4',
    family: 'spm-bpe',
    pieces: pieceStrings.map((piece) => utf8.encode(piece)),
    types,
    scores: null,
    merges,
    specials,
    config: {
      byteFirstId,
      bosId: idOfToken('bos_token'),
      eosId: idOfToken('eos_token'),
      unkId,
      padId: idOfToken('pad_token'),
      addDummyPrefix: false,
      escapeWhitespace: true,
      priority: 'merge-rank',
      fallbackOrder: 'before-merge',
      ...(regenerable === undefined ? {} : { hfMergesRegenerable: regenerable }),
    },
    notes: [
      `${String(pieceStrings.length)} pieces (BYTE ${String(byteFirstId)}..${String(byteFirstId + 255)}, ${String(specials.length)} special added tokens, 0 USER_DEFINED)`,
      `${String(pairs.length)} merges; added_tokens[special=false]: ${String(nonSpecial)}`,
      regenerable === undefined
        ? 'A2 regeneration check skipped'
        : `A2 regeneration check: ${regenerable ? 'all merges reproduced' : 'NOT reproduced'}`,
    ],
  };
}
