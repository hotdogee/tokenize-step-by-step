/**
 * `ByteVocab` (AD-8, 03 §C.2): byte-keyed lookup over the `PCES` section of a TSBV1 container, for both engine
 * families. Keys are bytes, never decoded strings, so BOM-prefixed and non-UTF-8 entries need no special case.
 *
 * Layout built at load:
 * - `bytes`: an own, compact copy of the entry bytes (the varint headers dropped), so the decompressed container can be
 *   garbage-collected once the reader is done;
 * - `offsets` (`count + 1`): entry `i` is `bytes[offsets[i], offsets[i + 1])`;
 * - a hash table of 2^ceil(log2(2·count)) `Int32` slots (load factor ≤ ½) holding entry indices, keyed by 32-bit FNV-1a
 *   over the entry bytes, collisions resolved by linear probing with a byte compare.
 *
 * The longest probe sequence is measured at build time and must stay ≤ {@link MAX_PROBE_LENGTH}; a vocabulary that
 * clusters worse is rejected rather than silently made slow. Lookups allocate nothing.
 */
import type { ByteVocab } from './types.ts';
import { FormatError } from './format-error.ts';
import { createStrictUtf8Decoder, decodeUtf8OrNull, type Utf8Decoder } from './utf8.ts';
import { ByteReader } from './varint.ts';

/**
 * Upper bound on the linear-probe distance of any entry. The raw vocabularies measure 19–39 (Gemma 4 and the Gemma 3
 * model, at load factor exactly ½, are the worst), so this leaves headroom while still rejecting a degenerate table.
 */
export const MAX_PROBE_LENGTH = 64;

const FNV_OFFSET = 0x811c9dc5 | 0;
const FNV_PRIME = 0x01000193;
const EMPTY = -1;

/** 32-bit FNV-1a of `buf[start, end)` as a signed 32-bit integer. */
export function fnv1a32(buf: Uint8Array, start: number, end: number): number {
  let h = FNV_OFFSET;
  for (let i = start; i < end; i++) h = Math.imul(h ^ (buf[i] ?? 0), FNV_PRIME);
  return h;
}

/** A `ByteVocab` plus the build statistics the reader and the tests check. */
export interface ByteVocabStats extends ByteVocab {
  /** Longest entry in bytes (validated against `META.maxPieceBytes` by `readTsbv1`). */
  readonly maxEntryBytes: number;
  /** Longest linear-probe distance seen while building the table (0 = every entry in its home slot). */
  readonly maxProbe: number;
  /** Number of hash slots (a power of two ≥ 2·count). */
  readonly tableSize: number;
  /** Bytes held by the vocabulary's own typed arrays (entry bytes, offsets, hash table). */
  readonly residentBytes: number;
}

/** Whether `a[aStart, aStart + len)` equals `b[bStart, bStart + len)`. */
function sameBytes(a: Uint8Array, aStart: number, b: Uint8Array, bStart: number, len: number): boolean {
  for (let k = 0; k < len; k++) if (a[aStart + k] !== b[bStart + k]) return false;
  return true;
}

class HashedByteVocab implements ByteVocabStats {
  readonly count: number;
  readonly offsets: Uint32Array;
  readonly bytes: Uint8Array;
  readonly maxEntryBytes: number;
  readonly maxProbe: number;
  readonly #table: Int32Array;
  readonly #pieces = new Map<number, string | null>();
  #decoder: Utf8Decoder | null = null;

  constructor(offsets: Uint32Array, bytes: Uint8Array, table: Int32Array, maxEntryBytes: number, maxProbe: number) {
    this.count = offsets.length - 1;
    this.offsets = offsets;
    this.bytes = bytes;
    this.#table = table;
    this.maxEntryBytes = maxEntryBytes;
    this.maxProbe = maxProbe;
  }

  get tableSize(): number {
    return this.#table.length;
  }

  get residentBytes(): number {
    return this.bytes.byteLength + this.offsets.byteLength + this.#table.byteLength;
  }

  indexOf(buf: Uint8Array, start: number, end: number): number {
    const { bytes, offsets } = this;
    const table = this.#table;
    const mask = table.length - 1;
    const len = end - start;
    let slot = fnv1a32(buf, start, end) & mask;
    for (let index = table[slot] ?? EMPTY; index !== EMPTY; index = table[slot] ?? EMPTY) {
      const from = offsets[index] ?? 0;
      if ((offsets[index + 1] ?? 0) - from === len && sameBytes(bytes, from, buf, start, len)) return index;
      slot = (slot + 1) & mask;
    }
    return -1;
  }

  bytesOf(index: number): Uint8Array {
    if (!Number.isInteger(index) || index < 0 || index >= this.count) {
      throw new RangeError(`ByteVocab.bytesOf: index ${String(index)} outside [0, ${String(this.count)})`);
    }
    return this.bytes.subarray(this.offsets[index], this.offsets[index + 1]);
  }

  pieceOf(index: number): string | null {
    const cached = this.#pieces.get(index);
    if (cached !== undefined) return cached;
    const bytes = this.bytesOf(index);
    this.#decoder ??= createStrictUtf8Decoder();
    const piece = decodeUtf8OrNull(this.#decoder, bytes);
    this.#pieces.set(index, piece);
    return piece;
  }
}

/**
 * Builds a {@link ByteVocab} from a `PCES` payload (`varint count`, then `count × (varint len, len bytes)`). The entry
 * bytes are copied, so `payload` (and the container it views) may be released afterwards. Throws {@link FormatError}
 * (section `PCES`) on a truncated or overlong payload, an empty entry, duplicate entries or pathological clustering;
 * `base` is the payload's offset in the container, for error messages.
 */
export function byteVocabFromBuffer(payload: Uint8Array, base = 0): ByteVocabStats {
  const reader = new ByteReader(payload, 'PCES', 0, payload.length, base);
  const count = reader.varint();
  // Every entry needs at least 2 bytes (length varint + one byte); reject absurd counts before allocating.
  if (count * 2 > reader.remaining) throw reader.error(`count ${String(count)} does not fit in the payload`);
  const first = reader.pos;

  // Pass 1: lengths → offsets (compact coordinates), validating the framing before anything is copied.
  const offsets = new Uint32Array(count + 1);
  let total = 0;
  let maxEntryBytes = 0;
  for (let i = 0; i < count; i++) {
    const len = reader.varint();
    if (len === 0) throw reader.error(`entry ${String(i)} is empty`);
    if (len > reader.remaining) throw reader.error(`truncated entry ${String(i)}: ${String(len)} bytes declared`);
    reader.pos += len;
    offsets[i] = total;
    total += len;
    if (len > maxEntryBytes) maxEntryBytes = len;
  }
  offsets[count] = total;
  if (reader.remaining !== 0)
    throw reader.error(`${String(reader.remaining)} trailing bytes after ${String(count)} entries`);

  // Pass 2: copy each entry (dropping its length header) while hashing it, then insert it. Plain loops: entries
  // average ~8 bytes, where a per-entry subarray() + set() would allocate one view per entry.
  let size = 2;
  while (size < 2 * count) size *= 2;
  const mask = size - 1;
  const table = new Int32Array(size).fill(EMPTY);
  const bytes = new Uint8Array(total);
  let maxProbe = 0;
  let pos = first;
  for (let i = 0; i < count; i++) {
    const start = offsets[i] ?? 0;
    const len = (offsets[i + 1] ?? 0) - start;
    pos += len < 0x80 ? 1 : len < 0x4000 ? 2 : len < 0x200000 ? 3 : len < 0x10000000 ? 4 : 5; // minimal LEB128 header (pass 1 rejected overlong varints)
    let h = FNV_OFFSET;
    for (let src = pos, dst = start, stop = pos + len; src < stop; src++, dst++) {
      const byte = payload[src] ?? 0;
      bytes[dst] = byte;
      h = Math.imul(h ^ byte, FNV_PRIME);
    }
    pos += len;
    let slot = h & mask;
    let probe = 0;
    for (let other = table[slot] ?? EMPTY; other !== EMPTY; other = table[slot] ?? EMPTY) {
      const from = offsets[other] ?? 0;
      if ((offsets[other + 1] ?? 0) - from === len && sameBytes(bytes, from, bytes, start, len)) {
        throw new FormatError('PCES', base, `entries ${String(other)} and ${String(i)} have the same bytes`);
      }
      slot = (slot + 1) & mask;
      probe++;
    }
    if (probe > MAX_PROBE_LENGTH) {
      throw new FormatError('PCES', base, `hash probe length ${String(probe)} exceeds ${String(MAX_PROBE_LENGTH)}`);
    }
    table[slot] = i;
    if (probe > maxProbe) maxProbe = probe;
  }
  return new HashedByteVocab(offsets, bytes, table, maxEntryBytes, maxProbe);
}
