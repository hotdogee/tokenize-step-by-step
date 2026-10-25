/** `ByteReader`: LEB128 / zigzag / u32 / f32 decoding with bounds checks (03 §C.1). */
import { describe, expect, it } from 'vitest';
import { varint, zigzag } from '../../src/format/__tests__/tsbv1-writer.ts';
import { FormatError } from '../../src/format/format-error.ts';
import { ByteReader } from '../../src/format/varint.ts';

const reader = (bytes: readonly number[]) => new ByteReader(Uint8Array.from(bytes), 'TEST');

describe('ByteReader', () => {
  it.each([0, 1, 127, 128, 300, 16383, 16384, 2 ** 21, 2 ** 28, 2 ** 32 - 1])('round-trips varint %d', (value) => {
    const r = reader(varint(value));
    expect(r.varint()).toBe(value);
    expect(r.remaining).toBe(0);
  });

  it.each([0, -1, 1, -2, 63, -64, 1000, -1000, 2 ** 31 - 1, -(2 ** 31)])('round-trips zigzag %d', (value) => {
    expect(reader(zigzag(value)).zigzag()).toBe(value);
  });

  it('encodes zigzag as 0 → 0, -1 → 1, 1 → 2', () => {
    expect([zigzag(0), zigzag(-1), zigzag(1), zigzag(-2)]).toEqual([[0], [1], [2], [3]]);
  });

  it('reads little-endian u32 and f32', () => {
    expect(reader([0x78, 0x56, 0x34, 0x12]).u32()).toBe(0x12345678);
    expect(reader([0xff, 0xff, 0xff, 0xff]).u32()).toBe(0xffffffff);
    const f = new Uint8Array(4);
    new DataView(f.buffer).setFloat32(0, -12.5, true);
    expect(reader([...f]).f32()).toBe(-12.5);
  });

  it.each([
    ['truncated varint', [0x80]],
    ['varint longer than 5 bytes', [0x80, 0x80, 0x80, 0x80, 0x80, 0x01]],
    ['varint exceeds 32 bits', [0xff, 0xff, 0xff, 0xff, 0x7f]],
    ['overlong varint', [0x80, 0x00]],
  ])('rejects a %s', (reason, bytes) => {
    expect(() => reader(bytes).varint()).toThrow(reason);
  });

  it('reports the section and the absolute offset', () => {
    const r = new ByteReader(Uint8Array.from([1, 2, 3]), 'PCES', 1, 3, 100);
    r.u8();
    try {
      r.u32();
      expect.unreachable();
    } catch (error) {
      expect(error).toBeInstanceOf(FormatError);
      expect(error).toMatchObject({ section: 'PCES', offset: 102, name: 'FormatError' });
      expect((error as FormatError).reason).toMatch(/truncated u32/);
    }
  });
});
