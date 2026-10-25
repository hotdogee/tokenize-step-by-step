/**
 * In-memory vocabulary tables: what every parser (03 §C.5) produces, what the TSBV1 writer encodes and what the dev
 * loaders hand to engine work before a converted asset exists. Arrays are in id order (bytelevel: index = rank, id =
 * index + idOffset), specials in upstream source order (AD-12).
 */
import { Buffer } from 'node:buffer';
import type { Family, TokenizerId } from '@tsbs/core';

/** TSBV1 `TYPS` codes (03 §C.1). */
export const PieceType = { Normal: 0, UserDefined: 1, Byte: 2, Control: 3, Unk: 4, Unused: 5 } as const;
export type PieceTypeCode = (typeof PieceType)[keyof typeof PieceType];

/** One special token as written to `SPCL`. */
export interface SpecialEntry {
  readonly id: number;
  readonly text: string;
}

/** Merge-rank table (`MRGS`): one row per HF merge in rank order. */
export interface MergeTable {
  /** Id of the merged (result) piece per rank. */
  readonly resultId: Uint32Array;
  /** Length of the left half in UTF-16 code units (≤ 255, asserted by the writer). */
  readonly splitUtf16: Uint8Array;
}

/** Engine configuration facts recorded in META (03 §C.1); each family fills its own subset. */
export interface TableConfig {
  readonly idOffset?: number;
  readonly byteFirstId?: number;
  readonly bosId?: number;
  readonly eosId?: number;
  readonly unkId?: number;
  readonly padId?: number;
  readonly addDummyPrefix?: boolean;
  readonly escapeWhitespace?: boolean;
  readonly priority?: 'score' | 'merge-rank';
  readonly fallbackOrder?: 'after-merge' | 'before-merge';
  readonly normalScoresMonotone?: boolean;
  readonly hfMergesRegenerable?: boolean;
}

/** Parser output. `pieces[i]` is the PCES entry of index i (bytelevel: raw token bytes; spm: UTF-8 of the piece). */
export interface VocabTables {
  readonly tokenizerId: TokenizerId;
  readonly family: Family;
  readonly pieces: readonly Uint8Array[];
  /** `TYPS`, spm only. */
  readonly types: Uint8Array | null;
  /** Piece scores (spm `priority: score`); written as `PRIO` when all integral, else `SCRF`. */
  readonly scores: Float32Array | null;
  /** `MRGS`, spm `priority: merge-rank` only. */
  readonly merges: MergeTable | null;
  readonly specials: readonly SpecialEntry[];
  readonly config: TableConfig;
  /** Facts the parser measured or decided that the build log and tests report (not written to the asset). */
  readonly notes: readonly string[];
}

/** Longest PCES entry in bytes (META `maxPieceBytes`). */
export function maxPieceBytes(pieces: readonly Uint8Array[]): number {
  let max = 0;
  for (const piece of pieces) if (piece.length > max) max = piece.length;
  return max;
}

/** Number of UNUSED pieces (META `unusedCount`; must be 0, 04 §3.2). */
export function unusedCount(types: Uint8Array | null): number {
  if (types === null) return 0;
  let count = 0;
  for (const type of types) if (type === PieceType.Unused) count++;
  return count;
}

/** Hex string of a byte array (diagnostics). */
export function hex(bytes: Uint8Array): string {
  return Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
}

/** Key for byte-string uniqueness checks: latin1 is a bijection between bytes and code units 0–255. */
export function byteKey(bytes: Uint8Array): string {
  return Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength).toString('latin1');
}
