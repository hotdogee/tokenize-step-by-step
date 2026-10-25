/**
 * `ByteVocab` on synthetic payloads (AD-8, 03 §C.2): lookups by byte slice, hash collisions (same home slot and same
 * full 32-bit FNV-1a), non-UTF-8 and BOM-prefixed keys, the own copy of the payload, and every rejection path.
 */
import { describe, expect, it } from 'vitest';
import { encodePieces, utf8, varint } from '../../src/format/__tests__/tsbv1-writer.ts';
import { byteVocabFromBuffer, fnv1a32, MAX_PROBE_LENGTH } from '../../src/format/byte-vocab.ts';
import { FormatError } from '../../src/format/format-error.ts';

const key = (n: number, width = 4) => Uint8Array.from({ length: width }, (_, i) => (n >>> (8 * i)) & 0xff);
const lookup = (vocab: ReturnType<typeof byteVocabFromBuffer>, bytes: Uint8Array) =>
  vocab.indexOf(bytes, 0, bytes.length);

describe('ByteVocab', () => {
  const pieces = [
    utf8('a'),
    utf8('b'),
    utf8('ab'),
    utf8('台'),
    Uint8Array.from([0xe7, 0x81]),
    utf8('\ufeffusing'),
    utf8('▁the'),
  ];
  const vocab = byteVocabFromBuffer(encodePieces(pieces));

  it('finds every entry by its bytes and nothing else', () => {
    expect(vocab.count).toBe(pieces.length);
    pieces.forEach((piece, i) => {
      expect(lookup(vocab, piece)).toBe(i);
    });
    expect(lookup(vocab, utf8('abc'))).toBe(-1);
    expect(lookup(vocab, utf8('A'))).toBe(-1);
    expect(lookup(vocab, new Uint8Array(0))).toBe(-1);
  });

  it('looks up a slice of a larger buffer without copying it', () => {
    const buf = utf8('xx台yy');
    expect(vocab.indexOf(buf, 2, 5)).toBe(3);
    expect(vocab.indexOf(buf, 0, 1)).toBe(-1);
  });

  it('lays out offsets (count + 1) over a compact copy of the entry bytes', () => {
    expect(vocab.offsets).toHaveLength(pieces.length + 1);
    expect(vocab.offsets[pieces.length]).toBe(vocab.bytes.length);
    expect(vocab.bytes.length).toBe(pieces.reduce((sum, p) => sum + p.length, 0));
    expect(vocab.bytesOf(2)).toEqual(utf8('ab'));
    expect(vocab.bytesOf(2).buffer).toBe(vocab.bytes.buffer);
    expect(() => vocab.bytesOf(pieces.length)).toThrow(RangeError);
    expect(() => vocab.bytesOf(-1)).toThrow(RangeError);
  });

  it('owns its bytes: the payload (and the container it views) can be released or overwritten', () => {
    const payload = encodePieces(pieces);
    const own = byteVocabFromBuffer(payload);
    expect(own.bytes.buffer).not.toBe(payload.buffer);
    payload.fill(0);
    pieces.forEach((piece, i) => {
      expect(own.bytesOf(i)).toEqual(piece);
      expect(lookup(own, piece)).toBe(i);
    });
  });

  it('decodes pieces strictly: null for invalid UTF-8, the BOM kept, memoised', () => {
    expect(vocab.pieceOf(3)).toBe('台');
    expect(vocab.pieceOf(4)).toBeNull();
    expect(vocab.pieceOf(4)).toBeNull();
    expect(vocab.pieceOf(5)).toBe('\ufeffusing');
    expect(vocab.pieceOf(6)).toBe('▁the');
  });

  it('reports its build statistics', () => {
    expect(vocab.maxEntryBytes).toBe(8);
    expect(vocab.tableSize).toBe(16);
    expect(vocab.maxProbe).toBeLessThan(vocab.tableSize);
    expect(vocab.residentBytes).toBe(vocab.bytes.byteLength + vocab.offsets.byteLength + 16 * 4);
  });

  it('resolves keys that share a home slot and keys with an identical 32-bit hash', () => {
    // Two distinct keys with the same full 32-bit FNV-1a (found offline by a birthday search over random a–z strings).
    const pair = [utf8('yqiwsm'), utf8('klwecn')] as const;
    expect(fnv1a32(pair[0], 0, 6)).toBe(fnv1a32(pair[1], 0, 6));
    // Plus 40 keys with the same home slot in a 128-slot table.
    const sameSlot: Uint8Array[] = [];
    for (let n = 0; sameSlot.length < 40; n++) if ((fnv1a32(key(n, 3), 0, 3) & 127) === 5) sameSlot.push(key(n, 3));
    const keys = [pair[0], pair[1], ...sameSlot];
    const colliding = byteVocabFromBuffer(encodePieces(keys));
    expect(colliding.tableSize).toBe(128);
    expect(colliding.maxProbe).toBeGreaterThanOrEqual(39);
    keys.forEach((k, i) => {
      expect(lookup(colliding, k)).toBe(i);
    });
    expect(lookup(colliding, utf8('yqiwsn'))).toBe(-1);
  });

  it(`rejects a table whose probe length would exceed ${String(MAX_PROBE_LENGTH)}`, () => {
    const sameSlot: Uint8Array[] = [];
    for (let n = 0; sameSlot.length < MAX_PROBE_LENGTH + 2; n++)
      if ((fnv1a32(key(n, 3), 0, 3) & 255) === 7) sameSlot.push(key(n, 3));
    expect(() => byteVocabFromBuffer(encodePieces(sameSlot))).toThrow(/hash probe length/);
  });

  it('accepts an empty vocabulary', () => {
    const empty = byteVocabFromBuffer(Uint8Array.from([0]));
    expect(empty.count).toBe(0);
    expect(lookup(empty, utf8('a'))).toBe(-1);
  });

  it.each([
    ['duplicate entries', encodePieces([utf8('ab'), utf8('c'), utf8('ab')]), /entries 0 and 2 have the same bytes/],
    ['an empty entry', Uint8Array.from([2, 1, 0x61, 0, 0x62]), /entry 1 is empty/],
    ['a truncated entry', Uint8Array.from([1, 3, 0x61]), /truncated entry 0/],
    ['trailing bytes', Uint8Array.from([1, 1, 0x61, 0x62]), /1 trailing bytes/],
    ['a count larger than the payload', Uint8Array.from([...varint(1000), 1, 0x61]), /does not fit/],
    ['an overlong length varint', Uint8Array.from([1, 0x81, 0x00, 0x61]), /overlong varint/],
  ])('rejects %s with a PCES FormatError', (_label, payload, reason) => {
    expect(() => byteVocabFromBuffer(payload, 40)).toThrow(reason);
    try {
      byteVocabFromBuffer(payload, 40);
    } catch (error) {
      expect(error).toBeInstanceOf(FormatError);
      expect((error as FormatError).section).toBe('PCES');
      expect((error as FormatError).offset).toBeGreaterThanOrEqual(40);
    }
  });
});
