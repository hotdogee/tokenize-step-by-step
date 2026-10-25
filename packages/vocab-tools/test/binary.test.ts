import { describe, expect, it } from 'vitest';
import { ByteReader, ByteWriter, unzigzag, zigzag } from '../src/binary.ts';

describe('zigzag', () => {
  it('maps signed to unsigned and back', () => {
    expect([0, -1, 1, -2, 2].map(zigzag)).toEqual([0, 1, 2, 3, 4]);
    for (const n of [0, 1, -1, 63, -64, 64, 2 ** 31, -(2 ** 31), 2 ** 40 + 3, -(2 ** 40) - 7])
      expect(unzigzag(zigzag(n))).toBe(n);
  });
});

describe('ByteWriter / ByteReader', () => {
  it('round-trips varints of every width, little-endian fixed fields and raw bytes', () => {
    const values = [0, 1, 127, 128, 255, 300, 16383, 16384, 2 ** 21, 2 ** 28 + 5, 2 ** 35 - 1, 2 ** 49 + 17];
    const w = new ByteWriter();
    for (const v of values) w.varint(v).zigzag(0 - v);
    w.u8(7)
      .u16(0xbeef)
      .u32(0xdeadbeef)
      .f32(-1.5)
      .bytes(Uint8Array.of(1, 2, 3));
    const r = new ByteReader(w.finish());
    for (const v of values) {
      expect(r.varint()).toBe(v);
      expect(r.zigzag()).toBe(0 - v);
    }
    expect([r.u8(), r.u16(), r.u32(), r.f32()]).toEqual([7, 0xbeef, 0xdeadbeef, -1.5]);
    expect([...r.bytes(3)]).toEqual([1, 2, 3]);
    expect(r.done).toBe(true);
  });

  it('encodes LEB128 exactly as the spec says', () => {
    expect([...new ByteWriter().varint(300).finish()]).toEqual([0xac, 0x02]);
    expect([...new ByteWriter().u32(1).finish()]).toEqual([1, 0, 0, 0]);
  });

  it('grows past its initial capacity and pads with zeros', () => {
    const w = new ByteWriter();
    const big = new Uint8Array(200_000).fill(9);
    w.bytes(big).u8(1).pad(4);
    const out = w.finish();
    expect(out.length).toBe(200_004);
    expect([...out.subarray(200_000)]).toEqual([1, 0, 0, 0]);
  });

  it('rejects out-of-range values and reads past the end', () => {
    expect(() => new ByteWriter().u8(256)).toThrow(RangeError);
    expect(() => new ByteWriter().varint(-1)).toThrow(RangeError);
    expect(() => new ByteWriter().varint(1.5)).toThrow(RangeError);
    expect(() => new ByteReader(Uint8Array.of(0x80)).varint()).toThrow(RangeError);
    expect(() => new ByteReader(Uint8Array.of(1, 2)).u32()).toThrow(RangeError);
  });
});
