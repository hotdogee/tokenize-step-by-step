/**
 * `spmProto` parser (03 §C.5): SentencePiece `.model` (Grok-1, Gemma 1/2) → PCES, TYPS, PRIO/SCRF, SPCL and META
 * facts from `trainer_spec` / `normalizer_spec`, through the minimal proto2 reader.
 *
 * ModelProto: pieces[1]{piece 1, score 2, type 3}, trainer_spec[2]{model_type 3, byte_fallback 35, unk_id 40, bos_id 41,
 * eos_id 42, pad_id 43}, normalizer_spec[3]{name 1, precompiled_charsmap 2, add_dummy_prefix 3,
 * remove_extra_whitespaces 4, escape_whitespaces 5}. Absent fields take their **proto2 defaults** (Grok-1 omits
 * `escape_whitespaces`, default true). BYTE pieces must be 256 contiguous `<0xNN>` ids whose byte value is taken from
 * the id (Gemma 1/2 tab quirk: HF JSON keys id 226 as a literal tab; the `.model` is authoritative). UNUSED pieces are
 * rejected (resegmentation unsupported, 04 §3.2). SPCL lists the CONTROL and UNK pieces in id order — the strings the
 * `'match'` mode pre-matches (04 §3.1; the oracle lane's emulation matches the same set).
 */
import type { TokenizerId } from '@tsbs/core';
import { PieceType, type PieceTypeCode, type SpecialEntry, type VocabTables } from '../tables.ts';
import { boolField, bytesField, floatField, int32Field, readMessage } from './proto.ts';

/** SentencePiece proto `Type` enum → TSBV1 `TYPS` code. */
const PROTO_TYPE: Readonly<Record<number, PieceTypeCode>> = {
  1: PieceType.Normal,
  2: PieceType.Unk,
  3: PieceType.Control,
  4: PieceType.UserDefined,
  5: PieceType.Unused,
  6: PieceType.Byte,
};

/** `trainer_spec.model_type` value for BPE. */
const MODEL_TYPE_BPE = 2;

const utf8 = new TextDecoder('utf-8', { fatal: true, ignoreBOM: true });

/** Facts read from the proto, exposed for tests and the dev loader. */
export interface SpmModelFacts {
  readonly modelType: number;
  readonly byteFallback: boolean;
  readonly unkId: number;
  readonly bosId: number;
  readonly eosId: number;
  readonly padId: number;
  readonly normalizerName: string;
  readonly addDummyPrefix: boolean;
  readonly removeExtraWhitespaces: boolean;
  readonly escapeWhitespaces: boolean;
}

/** True iff the scores of NORMAL pieces strictly decrease with id (A1; recorded, never relied on — AD-7). */
export function normalScoresMonotone(types: Uint8Array, scores: Float32Array): boolean {
  let previous = Infinity;
  for (let id = 0; id < types.length; id++) {
    if (types[id] !== PieceType.Normal) continue;
    const score = scores[id] ?? 0;
    if (!(score < previous)) return false;
    previous = score;
  }
  return true;
}

/** Parses a SentencePiece BPE `.model` into spm tables. */
export function parseSpmModel(model: Uint8Array, tokenizerId: TokenizerId): VocabTables {
  const label = tokenizerId;
  const top = readMessage(model);
  const pieces: Uint8Array[] = [];
  const typeList: number[] = [];
  const scoreList: number[] = [];
  for (const field of top) {
    if (field.field !== 1) continue;
    if (field.wire !== 2) throw new Error(`${label}: pieces[] is not a message`);
    const sub = readMessage(field.bytes);
    const piece = bytesField(sub, 1);
    if (piece === null) throw new Error(`${label}: piece ${String(pieces.length)} has no string`);
    utf8.decode(piece); // must be valid UTF-8
    const protoType = int32Field(sub, 3, 1);
    const type = PROTO_TYPE[protoType];
    if (type === undefined)
      throw new Error(`${label}: piece ${String(pieces.length)} has unknown type ${String(protoType)}`);
    pieces.push(piece.slice());
    typeList.push(type);
    scoreList.push(floatField(sub, 2, 0));
  }
  const trainerBytes = bytesField(top, 2);
  const normalizerBytes = bytesField(top, 3);
  if (trainerBytes === null || normalizerBytes === null)
    throw new Error(`${label}: trainer_spec / normalizer_spec missing`);
  const trainer = readMessage(trainerBytes);
  const normalizer = readMessage(normalizerBytes);
  const charsmap = bytesField(normalizer, 2);
  const nameBytes = bytesField(normalizer, 1);
  const facts: SpmModelFacts = {
    modelType: int32Field(trainer, 3, 1),
    byteFallback: boolField(trainer, 35, false),
    unkId: int32Field(trainer, 40, 0),
    bosId: int32Field(trainer, 41, 1),
    eosId: int32Field(trainer, 42, 2),
    padId: int32Field(trainer, 43, -1),
    normalizerName: nameBytes === null ? '' : utf8.decode(nameBytes),
    addDummyPrefix: boolField(normalizer, 3, true),
    removeExtraWhitespaces: boolField(normalizer, 4, true),
    escapeWhitespaces: boolField(normalizer, 5, true),
  };
  if (facts.modelType !== MODEL_TYPE_BPE)
    throw new Error(`${label}: model_type ${String(facts.modelType)} is not BPE (2)`);
  if (!facts.byteFallback) throw new Error(`${label}: byte_fallback must be true`);
  if (facts.normalizerName !== 'identity')
    throw new Error(`${label}: normalizer "${facts.normalizerName}" is not identity`);
  if (charsmap !== null && charsmap.length > 0) throw new Error(`${label}: precompiled_charsmap must be empty`);
  if (facts.removeExtraWhitespaces) throw new Error(`${label}: remove_extra_whitespaces must be false`);
  if (!facts.escapeWhitespaces) throw new Error(`${label}: escape_whitespaces must be true`);

  const types = Uint8Array.from(typeList);
  const scores = Float32Array.from(scoreList);
  const unused = typeList.filter((t) => t === PieceType.Unused).length;
  if (unused !== 0) throw new Error(`${label}: ${String(unused)} UNUSED pieces (resegmentation unsupported, 04 §3.2)`);

  const byteIds = typeList.flatMap((t, id) => (t === PieceType.Byte ? [id] : []));
  const byteFirstId = byteIds[0] ?? -1;
  if (byteIds.length !== 256 || byteIds.at(-1) !== byteFirstId + 255)
    throw new Error(`${label}: BYTE pieces are not 256 contiguous ids`);
  for (const id of byteIds) {
    const expected = `<0x${(id - byteFirstId).toString(16).toUpperCase().padStart(2, '0')}>`;
    const actual = utf8.decode(pieces[id]);
    if (actual !== expected) throw new Error(`${label}: BYTE id ${String(id)} is "${actual}", expected "${expected}"`);
  }
  const typeOf = (id: number): number | undefined => (id >= 0 ? typeList[id] : undefined);
  if (typeOf(facts.unkId) !== PieceType.Unk)
    throw new Error(`${label}: unk_id ${String(facts.unkId)} is not the UNK piece`);
  for (const [name, id] of [
    ['bos', facts.bosId],
    ['eos', facts.eosId],
    ['pad', facts.padId],
  ] as const)
    if (id >= 0 && typeOf(id) !== PieceType.Control)
      throw new Error(`${label}: ${name}_id ${String(id)} is not a CONTROL piece`);

  const specials: SpecialEntry[] = [];
  typeList.forEach((t, id) => {
    if (t === PieceType.Control || t === PieceType.Unk) specials.push({ id, text: utf8.decode(pieces[id]) });
  });
  const monotone = normalScoresMonotone(types, scores);
  const userDefined = typeList.filter((t) => t === PieceType.UserDefined).length;
  return {
    tokenizerId,
    family: 'spm-bpe',
    pieces,
    types,
    scores,
    merges: null,
    specials,
    config: {
      byteFirstId,
      bosId: facts.bosId,
      eosId: facts.eosId,
      unkId: facts.unkId,
      ...(facts.padId >= 0 ? { padId: facts.padId } : {}),
      addDummyPrefix: facts.addDummyPrefix,
      escapeWhitespace: facts.escapeWhitespaces,
      priority: 'score',
      fallbackOrder: 'after-merge',
      normalScoresMonotone: monotone,
    },
    notes: [
      `${String(pieces.length)} pieces (${String(userDefined)} USER_DEFINED, BYTE ${String(byteFirstId)}..${String(byteFirstId + 255)}, ${String(specials.length)} CONTROL/UNK)`,
      `add_dummy_prefix ${String(facts.addDummyPrefix)}, escape_whitespaces ${String(facts.escapeWhitespaces)}`,
      `NORMAL scores ${monotone ? '' : 'not '}strictly decreasing with id`,
    ],
  };
}
