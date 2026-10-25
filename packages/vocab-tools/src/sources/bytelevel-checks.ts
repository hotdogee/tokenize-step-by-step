/**
 * Assertions shared by the byte-level parsers (03 §C.5): ranks contiguous (guaranteed by building `pieces` densely),
 * byte strings unique and non-empty, all 256 single bytes present, and specials outside the rank range.
 */
import { Buffer } from 'node:buffer';
import { byteKey, hex, type SpecialEntry } from '../tables.ts';

/** Throws unless `pieces` is a valid byte-level rank table. */
export function assertByteLevelPieces(label: string, pieces: readonly Uint8Array[]): void {
  const seen = new Map<string, number>();
  const singles = new Uint8Array(256);
  pieces.forEach((piece, rank) => {
    if (piece.length === 0) throw new Error(`${label}: rank ${String(rank)} is empty`);
    const key = byteKey(piece);
    const previous = seen.get(key);
    if (previous !== undefined)
      throw new Error(`${label}: ranks ${String(previous)} and ${String(rank)} share the bytes ${hex(piece)}`);
    seen.set(key, rank);
    if (piece.length === 1) singles[piece[0] ?? 0] = 1;
  });
  const missing = singles.indexOf(0);
  if (missing !== -1) throw new Error(`${label}: single byte 0x${missing.toString(16).padStart(2, '0')} has no rank`);
}

/** Throws if a special id falls inside the rank id range or two specials share an id or a string. */
export function assertSpecialsOutside(
  label: string,
  specials: readonly SpecialEntry[],
  firstRankId: number,
  rankCount: number,
): void {
  const ids = new Set<number>();
  const texts = new Set<string>();
  for (const { id, text } of specials) {
    if (id >= firstRankId && id < firstRankId + rankCount)
      throw new Error(`${label}: special ${text} id ${String(id)} collides with a rank id`);
    if (ids.has(id)) throw new Error(`${label}: duplicate special id ${String(id)}`);
    if (texts.has(text)) throw new Error(`${label}: duplicate special string ${text}`);
    ids.add(id);
    texts.add(text);
  }
}

/** Strict base64 decoding (Node's decoder silently skips invalid characters). */
export function decodeBase64Strict(text: string, where: string): Uint8Array {
  if (text.length % 4 !== 0 || !/^[A-Za-z0-9+/]*={0,2}$/.test(text))
    throw new Error(`${where}: invalid base64 "${text}"`);
  return new Uint8Array(Buffer.from(text, 'base64'));
}
