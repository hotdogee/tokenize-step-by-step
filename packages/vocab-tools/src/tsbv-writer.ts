/**
 * TSBV1 container writer (03 §C.1, packages/core/src/format/README.md). Deterministic: sections in the fixed order
 * META PCES TYPS PRIO|SCRF MRGS SPCL, META keys in the order of the spec, zero padding, no timestamps.
 */
import type { Family, TsbvMeta, VocabAssetEntry } from '@tsbs/core';
import { ByteWriter } from './binary.ts';
import { maxPieceBytes, unusedCount, type VocabTables } from './tables.ts';

export const TSBV_MAGIC = 'TSBV';
export const TSBV_VERSION = 1;
/** META must stay small enough to be read eagerly (03 §C.1). */
export const META_MAX_BYTES = 4096;
/** Header `family` byte. */
export const FAMILY_CODE = { 'bytelevel-bpe': 0, 'spm-bpe': 1 } as const satisfies Record<Family, number>;
/** Section tags in their canonical (written) order. */
export const SECTION_ORDER = ['META', 'PCES', 'TYPS', 'PRIO', 'SCRF', 'MRGS', 'SPCL'] as const;
export type SectionTag = (typeof SECTION_ORDER)[number];

/** Provenance and generator facts that are not part of the parsed tables. */
export interface WriteContext {
  readonly upstream: VocabAssetEntry['upstream'];
  readonly modificationNotice: string;
  readonly generator: string;
}

/** Result of encoding one asset. */
export interface EncodedContainer {
  readonly bytes: Uint8Array;
  readonly meta: TsbvMeta;
  /** Payload length per written section (diagnostics and size reports). */
  readonly sections: ReadonlyArray<{ readonly tag: SectionTag; readonly length: number }>;
}

const utf8 = new TextEncoder();
const utf8Strict = new TextDecoder('utf-8', { fatal: true, ignoreBOM: true });

/** True iff every score is an integer (then `PRIO` is written, else `SCRF`, 03 §C.1). */
export function scoresAreIntegral(scores: Float32Array): boolean {
  for (const score of scores) if (!Number.isInteger(score)) return false;
  return true;
}

/** META in the key order of 03 §C.1; optional keys are present only when the tables define them. */
export function buildMeta(tables: VocabTables, context: WriteContext): TsbvMeta {
  const c = tables.config;
  const counts: TsbvMeta['counts'] =
    tables.merges === null
      ? { pieces: tables.pieces.length, specials: tables.specials.length }
      : { pieces: tables.pieces.length, specials: tables.specials.length, merges: tables.merges.resultId.length };
  return {
    tokenizerId: tables.tokenizerId,
    family: tables.family,
    upstream: {
      assetId: context.upstream.assetId,
      file: context.upstream.file,
      sha256: context.upstream.sha256,
      url: context.upstream.url,
      revision: context.upstream.revision,
      retrievedOn: context.upstream.retrievedOn,
    },
    counts,
    maxPieceBytes: maxPieceBytes(tables.pieces),
    unusedCount: unusedCount(tables.types),
    ...(c.idOffset === undefined ? {} : { idOffset: c.idOffset }),
    ...(c.byteFirstId === undefined ? {} : { byteFirstId: c.byteFirstId }),
    ...(c.bosId === undefined ? {} : { bosId: c.bosId }),
    ...(c.eosId === undefined ? {} : { eosId: c.eosId }),
    ...(c.unkId === undefined ? {} : { unkId: c.unkId }),
    ...(c.padId === undefined ? {} : { padId: c.padId }),
    ...(c.addDummyPrefix === undefined ? {} : { addDummyPrefix: c.addDummyPrefix }),
    ...(c.escapeWhitespace === undefined ? {} : { escapeWhitespace: c.escapeWhitespace }),
    ...(c.priority === undefined ? {} : { priority: c.priority }),
    ...(c.fallbackOrder === undefined ? {} : { fallbackOrder: c.fallbackOrder }),
    ...(c.normalScoresMonotone === undefined ? {} : { normalScoresMonotone: c.normalScoresMonotone }),
    ...(c.hfMergesRegenerable === undefined ? {} : { hfMergesRegenerable: c.hfMergesRegenerable }),
    modificationNotice: context.modificationNotice,
    unicodeVersion: '16.0.0',
    generator: context.generator,
  };
}

/** Structural checks every asset must pass before it is encoded (family-specific checks live in the parsers). */
export function assertWritable(tables: VocabTables): void {
  const count = tables.pieces.length;
  if (count === 0) throw new Error(`${tables.tokenizerId}: no pieces`);
  if (tables.types !== null && tables.types.length !== count)
    throw new Error(
      `${tables.tokenizerId}: TYPS has ${String(tables.types.length)} entries for ${String(count)} pieces`,
    );
  if (tables.scores !== null && tables.scores.length !== count)
    throw new Error(
      `${tables.tokenizerId}: scores have ${String(tables.scores.length)} entries for ${String(count)} pieces`,
    );
  if (tables.family === 'spm-bpe' && tables.types === null)
    throw new Error(`${tables.tokenizerId}: spm asset without TYPS`);
  if (tables.family === 'bytelevel-bpe' && (tables.types !== null || tables.scores !== null || tables.merges !== null))
    throw new Error(`${tables.tokenizerId}: bytelevel asset with spm sections`);
  if (unusedCount(tables.types) !== 0)
    throw new Error(`${tables.tokenizerId}: ${String(unusedCount(tables.types))} UNUSED pieces (unsupported, 04 §3.2)`);
  const merges = tables.merges;
  if (merges !== null) {
    if (merges.resultId.length !== merges.splitUtf16.length)
      throw new Error(`${tables.tokenizerId}: MRGS arrays differ in length`);
    for (let rank = 0; rank < merges.resultId.length; rank++) {
      const id = merges.resultId[rank] ?? -1;
      const piece = tables.pieces[id];
      if (piece === undefined)
        throw new Error(`${tables.tokenizerId}: merge ${String(rank)} result id ${String(id)} out of range`);
      const units = utf8Strict.decode(piece).length;
      const split = merges.splitUtf16[rank] ?? 0;
      if (units > 255)
        throw new Error(
          `${tables.tokenizerId}: merge ${String(rank)} result piece is ${String(units)} UTF-16 units (> 255)`,
        );
      if (split <= 0 || split >= units)
        throw new Error(
          `${tables.tokenizerId}: merge ${String(rank)} split ${String(split)} outside the ${String(units)}-unit piece`,
        );
    }
  }
  const seen = new Set<number>();
  for (const special of tables.specials) {
    if (!Number.isSafeInteger(special.id) || special.id < 0)
      throw new Error(`${tables.tokenizerId}: bad special id ${String(special.id)}`);
    if (seen.has(special.id)) throw new Error(`${tables.tokenizerId}: duplicate special id ${String(special.id)}`);
    seen.add(special.id);
  }
}

function section(
  out: ByteWriter,
  tag: SectionTag,
  payload: Uint8Array,
  log: Array<{ tag: SectionTag; length: number }>,
): void {
  for (let i = 0; i < 4; i++) out.u8(tag.charCodeAt(i));
  out.u32(payload.length).bytes(payload).pad(4);
  log.push({ tag, length: payload.length });
}

function encodePieces(pieces: readonly Uint8Array[]): Uint8Array {
  const w = new ByteWriter().varint(pieces.length);
  for (const piece of pieces) w.varint(piece.length).bytes(piece);
  return w.finish();
}

function encodeScores(scores: Float32Array): { tag: 'PRIO' | 'SCRF'; payload: Uint8Array } {
  const w = new ByteWriter();
  if (scoresAreIntegral(scores)) {
    let previous = 0;
    for (const score of scores) {
      const value = Math.round(score);
      w.zigzag(value - previous);
      previous = value;
    }
    return { tag: 'PRIO', payload: w.finish() };
  }
  for (const score of scores) w.f32(score);
  return { tag: 'SCRF', payload: w.finish() };
}

function encodeMerges(resultId: Uint32Array, splitUtf16: Uint8Array): Uint8Array {
  const w = new ByteWriter().varint(resultId.length);
  let previous = 0;
  for (let rank = 0; rank < resultId.length; rank++) {
    const id = resultId[rank] ?? 0;
    w.zigzag(id - previous).u8(splitUtf16[rank] ?? 0);
    previous = id;
  }
  return w.finish();
}

function encodeSpecials(specials: VocabTables['specials']): Uint8Array {
  const w = new ByteWriter().varint(specials.length);
  for (const special of specials) {
    const bytes = utf8.encode(special.text);
    w.varint(special.id).varint(bytes.length).bytes(bytes);
  }
  return w.finish();
}

/** Encodes `tables` as a TSBV1 container (uncompressed). */
export function encodeTsbv1(tables: VocabTables, context: WriteContext): EncodedContainer {
  assertWritable(tables);
  const meta = buildMeta(tables, context);
  const metaBytes = utf8.encode(JSON.stringify(meta));
  if (metaBytes.length > META_MAX_BYTES)
    throw new Error(
      `${tables.tokenizerId}: META is ${String(metaBytes.length)} bytes (limit ${String(META_MAX_BYTES)})`,
    );

  const payloads: Array<{ tag: SectionTag; payload: Uint8Array }> = [
    { tag: 'META', payload: metaBytes },
    { tag: 'PCES', payload: encodePieces(tables.pieces) },
  ];
  if (tables.types !== null) payloads.push({ tag: 'TYPS', payload: tables.types.slice() });
  if (tables.scores !== null) payloads.push(encodeScores(tables.scores));
  if (tables.merges !== null)
    payloads.push({ tag: 'MRGS', payload: encodeMerges(tables.merges.resultId, tables.merges.splitUtf16) });
  payloads.push({ tag: 'SPCL', payload: encodeSpecials(tables.specials) });

  const out = new ByteWriter();
  for (let i = 0; i < 4; i++) out.u8(TSBV_MAGIC.charCodeAt(i));
  out.u8(TSBV_VERSION).u8(FAMILY_CODE[tables.family]).u16(payloads.length);
  const sections: Array<{ tag: SectionTag; length: number }> = [];
  for (const { tag, payload } of payloads) section(out, tag, payload, sections);
  return { bytes: out.finish(), meta, sections };
}
