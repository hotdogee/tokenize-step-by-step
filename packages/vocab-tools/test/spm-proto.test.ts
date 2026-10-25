import { describe, expect, it } from 'vitest';
import { readMessage, readVarint } from '../src/sources/proto.ts';
import { normalScoresMonotone, parseSpmModel } from '../src/sources/spm-proto.ts';
import { PieceType } from '../src/tables.ts';

// ---- a tiny protobuf encoder for synthetic .model files ----
function varint(value: bigint): number[] {
  let v = BigInt.asUintN(64, value);
  const out: number[] = [];
  while (v >= 0x80n) {
    out.push(Number(v & 0x7fn) | 0x80);
    v >>= 7n;
  }
  out.push(Number(v));
  return out;
}
const key = (field: number, wire: number): number[] => varint(BigInt(field * 8 + wire));
const vfield = (field: number, value: number | bigint): number[] => [...key(field, 0), ...varint(BigInt(value))];
const bytesField = (field: number, data: number[]): number[] => [
  ...key(field, 2),
  ...varint(BigInt(data.length)),
  ...data,
];
const strField = (field: number, s: string): number[] => bytesField(field, [...new TextEncoder().encode(s)]);
function floatField(field: number, value: number): number[] {
  const b = new Uint8Array(4);
  new DataView(b.buffer).setFloat32(0, value, true);
  return [...key(field, 5), ...b];
}

interface Piece {
  piece: string;
  score: number;
  type?: number; // proto Type; omitted = NORMAL (1)
}

function model(pieces: Piece[], trainer: number[], normalizer: number[]): Uint8Array {
  const out: number[] = [];
  for (const p of pieces) {
    const body = [
      ...strField(1, p.piece),
      ...floatField(2, p.score),
      ...(p.type === undefined ? [] : vfield(3, p.type)),
    ];
    out.push(...bytesField(1, body));
  }
  out.push(...bytesField(2, trainer), ...bytesField(3, normalizer));
  return Uint8Array.from(out);
}

function standardPieces(): Piece[] {
  const pieces: Piece[] = [
    { piece: '<unk>', score: 0, type: 2 },
    { piece: '<s>', score: 0, type: 3 },
    { piece: '</s>', score: 0, type: 3 },
  ];
  for (let b = 0; b < 256; b++)
    pieces.push({ piece: `<0x${b.toString(16).toUpperCase().padStart(2, '0')}>`, score: 0, type: 6 });
  pieces.push(
    { piece: '1', score: 0, type: 4 },
    { piece: '▁a', score: -1 },
    { piece: 'b', score: -2 },
    { piece: '▁ab', score: -3 },
  );
  return pieces;
}
const TRAINER = [
  ...vfield(3, 2),
  ...vfield(35, 1),
  ...vfield(40, 0),
  ...vfield(41, 1),
  ...vfield(42, 2),
  ...vfield(43, -1n),
];
// escape_whitespaces (5) deliberately omitted: proto2 default true (Grok-1 omits it).
const NORMALIZER = [...strField(1, 'identity'), ...vfield(3, 1), ...vfield(4, 0)];

describe('proto2 reader', () => {
  it('reads 10-byte negative int32 varints and rejects truncation', () => {
    const bytes = Uint8Array.from(varint(-1n));
    expect(bytes.length).toBe(10);
    expect(BigInt.asIntN(32, readVarint(bytes, 0, bytes.length)[0])).toBe(-1n);
    expect(() => readVarint(Uint8Array.of(0x80, 0x80), 0, 2)).toThrow(/truncated/);
    expect(() => readMessage(Uint8Array.of(0x0a, 0x05, 0x01))).toThrow(/overruns/);
    expect(() => readMessage(Uint8Array.of(0x0b))).toThrow(/wire type 3/);
  });
});

describe('spmProto', () => {
  it('reads pieces, types, scores and the specs with proto2 defaults', () => {
    const tables = parseSpmModel(model(standardPieces(), TRAINER, NORMALIZER), 'xai-grok1');
    expect(tables.pieces).toHaveLength(263);
    expect(new TextDecoder().decode(tables.pieces[260])).toBe('▁a');
    const types = tables.types ?? new Uint8Array();
    expect([types[0], types[1], types[3], types[259], types[260]]).toEqual([
      PieceType.Unk,
      PieceType.Control,
      PieceType.Byte,
      PieceType.UserDefined,
      PieceType.Normal,
    ]);
    expect([...(tables.scores ?? [])].slice(259)).toEqual([0, -1, -2, -3]);
    expect(tables.config).toEqual({
      byteFirstId: 3,
      bosId: 1,
      eosId: 2,
      unkId: 0,
      addDummyPrefix: true,
      escapeWhitespace: true,
      priority: 'score',
      fallbackOrder: 'after-merge',
      normalScoresMonotone: true,
    });
    expect(tables.specials).toEqual([
      { id: 0, text: '<unk>' },
      { id: 1, text: '<s>' },
      { id: 2, text: '</s>' },
    ]);
  });

  it('keeps pad_id when present and reports non-monotone NORMAL scores', () => {
    const pieces = standardPieces();
    pieces.push({ piece: '▁b', score: 5 });
    const trainer = [
      ...vfield(3, 2),
      ...vfield(35, 1),
      ...vfield(40, 0),
      ...vfield(41, 1),
      ...vfield(42, 2),
      ...vfield(43, 1),
    ];
    const tables = parseSpmModel(model(pieces, trainer, NORMALIZER), 'google-gemma2');
    expect(tables.config.padId).toBe(1);
    expect(tables.config.normalScoresMonotone).toBe(false);
    expect(normalScoresMonotone(Uint8Array.of(0, 2, 0), Float32Array.of(-1, 9, -2))).toBe(true);
  });

  it('rejects unigram models, missing byte fallback, non-identity normalizers, UNUSED pieces and broken BYTE blocks', () => {
    const unigram = [...vfield(3, 1), ...vfield(35, 1)];
    expect(() => parseSpmModel(model(standardPieces(), unigram, NORMALIZER), 'xai-grok1')).toThrow(/not BPE/);
    expect(() => parseSpmModel(model(standardPieces(), [...vfield(3, 2)], NORMALIZER), 'xai-grok1')).toThrow(
      /byte_fallback/,
    );
    expect(() => parseSpmModel(model(standardPieces(), TRAINER, [...strField(1, 'nmt_nfkc')]), 'xai-grok1')).toThrow(
      /identity/,
    );
    expect(() => parseSpmModel(model(standardPieces(), TRAINER, [...strField(1, 'identity')]), 'xai-grok1')).toThrow(
      /remove_extra_whitespaces/,
    );
    const withCharsmap = [...NORMALIZER, ...bytesField(2, [1, 2])];
    expect(() => parseSpmModel(model(standardPieces(), TRAINER, withCharsmap), 'xai-grok1')).toThrow(/charsmap/);
    const unused = standardPieces();
    unused.push({ piece: 'zz', score: -9, type: 5 });
    expect(() => parseSpmModel(model(unused, TRAINER, NORMALIZER), 'xai-grok1')).toThrow(/UNUSED/);
    const mislabelled = standardPieces();
    mislabelled[3 + 9] = { piece: '\t', score: 0, type: 6 };
    expect(() => parseSpmModel(model(mislabelled, TRAINER, NORMALIZER), 'google-gemma2')).toThrow(/expected "<0x09>"/);
    const short = standardPieces().filter((p) => p.piece !== '<0xFF>');
    expect(() => parseSpmModel(model(short, TRAINER, NORMALIZER), 'xai-grok1')).toThrow(/256 contiguous/);
  });
});
