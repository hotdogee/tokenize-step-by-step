/**
 * Little-endian section reader for TSBV1 payloads (03 §C.1): unsigned LEB128 varints, zigzag varints, `u8`, `u32` and
 * `f32`. Every read is bounds-checked and throws {@link FormatError} naming the section and the absolute byte offset.
 */
import { FormatError } from './format-error.ts';

/** Largest value an unsigned varint may encode here (2^32 − 1: counts, lengths, ids and zigzagged deltas are u32). */
const MAX_VARINT = 0xffffffff;

/** A forward-only cursor over `bytes[pos, end)`; `base` is added to offsets in error messages. */
export class ByteReader {
  readonly bytes: Uint8Array;
  readonly section: string;
  readonly end: number;
  readonly base: number;
  pos: number;

  constructor(bytes: Uint8Array, section: string, start = 0, end = bytes.length, base = 0) {
    this.bytes = bytes;
    this.section = section;
    this.pos = start;
    this.end = end;
    this.base = base;
  }

  /** A {@link FormatError} at the current position (or at `at`). */
  error(reason: string, at = this.pos): FormatError {
    return new FormatError(this.section, this.base + at, reason);
  }

  /** Bytes left before `end`. */
  get remaining(): number {
    return this.end - this.pos;
  }

  /** Throws unless `n` more bytes are available. */
  need(n: number, what: string): void {
    if (n > this.end - this.pos)
      throw this.error(`truncated ${what}: need ${String(n)} bytes, have ${String(this.remaining)}`);
  }

  u8(): number {
    this.need(1, 'u8');
    return this.bytes[this.pos++] ?? 0;
  }

  /** Little-endian u32. */
  u32(): number {
    this.need(4, 'u32');
    const b = this.bytes;
    const p = this.pos;
    this.pos += 4;
    return ((b[p] ?? 0) | ((b[p + 1] ?? 0) << 8) | ((b[p + 2] ?? 0) << 16)) + (b[p + 3] ?? 0) * 0x1000000;
  }

  /** Little-endian IEEE 754 binary32. */
  f32(): number {
    this.need(4, 'f32');
    const value = new DataView(this.bytes.buffer, this.bytes.byteOffset + this.pos, 4).getFloat32(0, true);
    this.pos += 4;
    return value;
  }

  /** Unsigned LEB128, at most 5 bytes and 2^32 − 1. */
  varint(): number {
    const start = this.pos;
    let value = 0;
    let scale = 1;
    for (let i = 0; i < 5; i++) {
      if (this.pos >= this.end) throw this.error('truncated varint', start);
      const byte = this.bytes[this.pos++] ?? 0;
      value += (byte & 0x7f) * scale;
      if ((byte & 0x80) === 0) {
        if (value > MAX_VARINT) throw this.error('varint exceeds 32 bits', start);
        if (i > 0 && byte === 0) throw this.error('overlong varint', start);
        return value;
      }
      scale *= 128;
    }
    throw this.error('varint longer than 5 bytes', start);
  }

  /** Zigzag-decoded signed LEB128 (0 → 0, 1 → −1, 2 → 1, …). */
  zigzag(): number {
    const n = this.varint();
    return n % 2 === 0 ? n / 2 : -(n + 1) / 2;
  }
}
