/**
 * `hfByteLevel` parser (03 §C.5): Muse Glimmer `tokenizer.json` (HF tokenizers byte-level BPE) → the Llama 4 / Muse
 * 202k tables. PCES via the inverse GPT-2 byte map (one code point = one byte); SPCL from `added_tokens` (2,048) in
 * file order. The HF `merges` list is not shipped: byte-level BPE with tiktoken semantics merges by rank (04 §2.1).
 *
 * Asserts: `model.type === "BPE"`, vocab ids contiguous 0..N−1, `ignore_merges === true`, no normalizer, the `Split`
 * regex byte-equal to tiktoken's o200k_base `pat_str`, added tokens contiguous right after the vocabulary and all
 * `special`. When the oracle-only Llama 4 `tokenizer.model` is available locally, every rank is cross-checked against it.
 */
import type { VocabTables } from '../tables.ts';
import { byteKey } from '../tables.ts';
import { assertByteLevelPieces, assertSpecialsOutside } from './bytelevel-checks.ts';
import { decodeByteLevelKey } from './gpt2-bytes.ts';
import { O200K_PAT_STR } from './patterns.ts';

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** The `Split` regex of a `Sequence[Split, ByteLevel]` pre-tokenizer. */
function splitRegex(preTokenizer: unknown): string {
  if (!isRecord(preTokenizer) || preTokenizer['type'] !== 'Sequence' || !Array.isArray(preTokenizer['pretokenizers']))
    throw new Error('pre_tokenizer is not a Sequence');
  const steps: unknown[] = preTokenizer['pretokenizers'];
  const [split, byteLevel] = steps;
  if (
    steps.length !== 2 ||
    !isRecord(split) ||
    split['type'] !== 'Split' ||
    !isRecord(byteLevel) ||
    byteLevel['type'] !== 'ByteLevel'
  )
    throw new Error('pre_tokenizer is not Sequence[Split, ByteLevel]');
  if (byteLevel['use_regex'] !== false || byteLevel['add_prefix_space'] !== false)
    throw new Error('ByteLevel pre-tokenizer must not add a prefix space or apply its own regex');
  const pattern = split['pattern'];
  if (!isRecord(pattern) || typeof pattern['Regex'] !== 'string') throw new Error('Split has no Regex pattern');
  if (split['behavior'] !== 'Isolated' || split['invert'] !== false)
    throw new Error('Split must be Isolated and not inverted');
  return pattern['Regex'];
}

/** Options of {@link parseHfByteLevelJson}. */
export interface HfByteLevelOptions {
  /** Llama 4 `tokenizer.model` ranks (oracle-only; cross-check when present). */
  readonly crossCheckRanks?: readonly Uint8Array[] | null;
  /** Expected added-token count (2,048 for Glimmer). */
  readonly expectedSpecials?: number;
}

/** Parses an HF byte-level `tokenizer.json` (already JSON-parsed) into byte-level tables. */
export function parseHfByteLevelJson(json: unknown, options: HfByteLevelOptions = {}): VocabTables {
  const label = 'meta-llama4-muse';
  if (!isRecord(json) || !isRecord(json['model']) || !Array.isArray(json['added_tokens']))
    throw new Error(`${label}: not an HF tokenizer.json`);
  const model = json['model'];
  if (model['type'] !== 'BPE') throw new Error(`${label}: model.type must be BPE`);
  if (model['ignore_merges'] !== true)
    throw new Error(`${label}: model.ignore_merges must be true (tiktoken semantics)`);
  if (model['byte_fallback'] === true) throw new Error(`${label}: byte_fallback is not byte-level BPE`);
  if (json['normalizer'] !== null) throw new Error(`${label}: a normalizer is not supported`);
  if (splitRegex(json['pre_tokenizer']) !== O200K_PAT_STR)
    throw new Error(`${label}: Split regex differs from the o200k pattern`);
  const vocab = model['vocab'];
  if (!isRecord(vocab)) throw new Error(`${label}: model.vocab missing`);

  const entries = Object.entries(vocab);
  const pieces = new Array<Uint8Array | undefined>(entries.length);
  for (const [key, id] of entries) {
    if (!Number.isSafeInteger(id) || (id as number) < 0 || (id as number) >= entries.length)
      throw new Error(
        `${label}: vocab id ${JSON.stringify(id)} of ${JSON.stringify(key)} is not in 0..${String(entries.length - 1)}`,
      );
    if (pieces[id as number] !== undefined) throw new Error(`${label}: vocab id ${String(id)} appears twice`);
    pieces[id as number] = decodeByteLevelKey(key);
  }
  const dense = pieces.map((piece, id) => {
    if (piece === undefined) throw new Error(`${label}: vocab ids are not contiguous (id ${String(id)} missing)`);
    return piece;
  });
  assertByteLevelPieces(label, dense);

  const added: unknown[] = json['added_tokens'];
  const specials = added.map((entry, i) => {
    if (!isRecord(entry) || !Number.isSafeInteger(entry['id']) || typeof entry['content'] !== 'string')
      throw new Error(`${label}: added_tokens[${String(i)}] malformed`);
    if (entry['special'] !== true) throw new Error(`${label}: added token ${entry['content']} is not special`);
    if (entry['id'] !== dense.length + i)
      throw new Error(`${label}: added tokens are not contiguous after the vocabulary`);
    return { id: entry['id'], text: entry['content'] };
  });
  const expected = options.expectedSpecials ?? 2048;
  if (specials.length !== expected)
    throw new Error(`${label}: ${String(specials.length)} added tokens, expected ${String(expected)}`);
  assertSpecialsOutside(label, specials, 0, dense.length);

  const notes = [
    `${String(dense.length)} ranks decoded through the inverse GPT-2 byte map`,
    `${String(specials.length)} specials`,
  ];
  const cross = options.crossCheckRanks;
  if (cross !== undefined && cross !== null) {
    if (cross.length !== dense.length)
      throw new Error(
        `${label}: Llama 4 cross-check has ${String(cross.length)} ranks, Glimmer ${String(dense.length)}`,
      );
    cross.forEach((piece, rank) => {
      const mine = dense[rank];
      if (mine === undefined || byteKey(piece) !== byteKey(mine))
        throw new Error(`${label}: rank ${String(rank)} differs from the Llama 4 tokenizer.model`);
    });
    notes.push('all ranks byte-identical to the oracle-only Llama 4 tokenizer.model');
  } else {
    notes.push('Llama 4 tokenizer.model not available locally: rank cross-check skipped');
  }

  const bos = specials.find((s) => s.text === '<|begin_of_text|>');
  return {
    tokenizerId: 'meta-llama4-muse',
    family: 'bytelevel-bpe',
    pieces: dense,
    types: null,
    scores: null,
    merges: null,
    specials,
    config: { idOffset: 0, ...(bos === undefined ? {} : { bosId: bos.id }) },
    notes,
  };
}
