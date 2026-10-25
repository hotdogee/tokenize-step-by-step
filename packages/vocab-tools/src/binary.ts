/**
 * Little-endian byte writer with LEB128 varints (03 §C.1: "Varints are unsigned LEB128; zigzag = signed LEB128
 * (zigzag-encoded)"). Numbers are JavaScript doubles, so every integer up to 2^53 − 1 is encoded exactly; the TSBV1
 * fields stay far below that.
 */

const INITIAL_CAPACITY = 1 << 16;

/** Throws unless `value` is a safe non-negative integer. */
function assertUnsigned(value: number, what: string): void {
  if (!Number.isSafeInteger(value) || value < 0)
    throw new RangeError(`${what}: ${String(value)} is not a safe unsigned integer`);
}

/** Zigzag mapping of a signed integer: 0 → 0, −1 → 1, 1 → 2, −2 → 3 … (exact for |n| < 2^52). */
export function zigzag(value: number): number {
  if (!Number.isSafeInteger(value)) throw new RangeError(`zigzag: ${String(value)} is not a safe integer`);
  return value >= 0 ? value * 2 : -value * 2 - 1;
}

/** Inverse of {@link zigzag}. */
export function unzigzag(value: number): number {
  return value % 2 === 0 ? value / 2 : -(value + 1) / 2;
}

/** A growable output buffer. `finish()` returns a view of exactly the bytes written. */
export class ByteWriter {
  private buf = new Uint8Array(INITIAL_CAPACITY);
  private view = new DataView(this.buf.buffer);
  private pos = 0;

  /** Number of bytes written so far. */
  get length(): number {
    return this.pos;
  }

  private reserve(extra: number): void {
    const needed = this.pos + extra;
    if (needed <= this.buf.length) return;
    let capacity = this.buf.length * 2;
    while (capacity < needed) capacity *= 2;
    const next = new Uint8Array(capacity);
    next.set(this.buf.subarray(0, this.pos));
    this.buf = next;
    this.view = new DataView(next.buffer);
  }

  u8(value: number): this {
    if (!Number.isInteger(value) || value < 0 || value > 0xff)
      throw new RangeError(`u8: ${String(value)} out of range`);
    this.reserve(1);
    this.buf[this.pos++] = value;
    return this;
  }

  u16(value: number): this {
    if (!Number.isInteger(value) || value < 0 || value > 0xffff)
      throw new RangeError(`u16: ${String(value)} out of range`);
    this.reserve(2);
    this.view.setUint16(this.pos, value, true);
    this.pos += 2;
    return this;
  }

  u32(value: number): this {
    if (!Number.isInteger(value) || value < 0 || value > 0xffffffff)
      throw new RangeError(`u32: ${String(value)} out of range`);
    this.reserve(4);
    this.view.setUint32(this.pos, value, true);
    this.pos += 4;
    return this;
  }

  f32(value: number): this {
    this.reserve(4);
    this.view.setFloat32(this.pos, value, true);
    this.pos += 4;
    return this;
  }

  /** Unsigned LEB128. */
  varint(value: number): this {
    assertUnsigned(value, 'varint');
    this.reserve(8);
    let rest = value;
    while (rest >= 0x80) {
      this.buf[this.pos++] = (rest % 0x80) | 0x80;
      rest = Math.floor(rest / 0x80);
    }
    this.buf[this.pos++] = rest;
    return this;
  }

  /** Signed LEB128 through the zigzag mapping. */
  zigzag(value: number): this {
    return this.varint(zigzag(value));
  }

  bytes(data: Uint8Array): this {
    this.reserve(data.length);
    this.buf.set(data, this.pos);
    this.pos += data.length;
    return this;
  }

  /** Zero bytes until the length is a multiple of `alignment`. */
  pad(alignment: number): this {
    const rest = this.pos % alignment;
    if (rest !== 0) {
      const count = alignment - rest;
      this.reserve(count);
      this.buf.fill(0, this.pos, this.pos + count);
      this.pos += count;
    }
    return this;
  }

  /** The written bytes (a copy, so the writer's buffer can be collected). */
  finish(): Uint8Array {
    return this.buf.slice(0, this.pos);
  }
}

/** Sequential reader for the same encodings (used by `inspect`/`verify` and the proto2 reader). */
export class ByteReader {
  readonly buf: Uint8Array;
  readonly end: number;
  private readonly view: DataView;
  pos: number;

  constructor(buf: Uint8Array, start = 0, end = buf.length) {
    this.buf = buf;
    this.end = end;
    this.view = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);
    this.pos = start;
  }

  get done(): boolean {
    return this.pos >= this.end;
  }

  private need(count: number, what: string): void {
    if (this.pos + count > this.end)
      throw new RangeError(
        `${what}: needs ${String(count)} bytes at offset ${String(this.pos)}, only ${String(this.end - this.pos)} left`,
      );
  }

  u8(): number {
    this.need(1, 'u8');
    return this.view.getUint8(this.pos++);
  }

  u16(): number {
    this.need(2, 'u16');
    const value = this.view.getUint16(this.pos, true);
    this.pos += 2;
    return value;
  }

  u32(): number {
    this.need(4, 'u32');
    const value = this.view.getUint32(this.pos, true);
    this.pos += 4;
    return value;
  }

  f32(): number {
    this.need(4, 'f32');
    const value = this.view.getFloat32(this.pos, true);
    this.pos += 4;
    return value;
  }

  /** Unsigned LEB128 (at most 8 bytes, i.e. below 2^56; larger values throw). */
  varint(): number {
    let result = 0;
    let scale = 1;
    for (let i = 0; i < 8; i++) {
      const byte = this.u8();
      result += (byte & 0x7f) * scale;
      if (byte < 0x80) return result;
      scale *= 0x80;
    }
    throw new RangeError(`varint longer than 8 bytes at offset ${String(this.pos)}`);
  }

  zigzag(): number {
    return unzigzag(this.varint());
  }

  bytes(count: number): Uint8Array {
    this.need(count, 'bytes');
    const out = this.buf.subarray(this.pos, this.pos + count);
    this.pos += count;
    return out;
  }
}
