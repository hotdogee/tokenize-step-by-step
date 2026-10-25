/** The META reader `registry:check` uses on built `.bin` files (03 §C.1 layout, AD-37 sniffing). */
import { gzipSync } from 'node:zlib';
import { describe, expect, it } from 'vitest';
import { readTsbvMeta } from '../scripts/tsbv-meta.ts';

/** A synthetic TSBV1 container with the given sections (tag, payload), padded to 4 bytes as the format requires. */
function container(sections: ReadonlyArray<readonly [string, Uint8Array]>, version = 1): Uint8Array {
  const parts: number[] = [...Buffer.from('TSBV'), version, 0, sections.length & 0xff, sections.length >> 8];
  for (const [tag, payload] of sections) {
    const length = Buffer.alloc(4);
    length.writeUInt32LE(payload.length);
    parts.push(...Buffer.from(tag), ...length, ...payload);
    while (parts.length % 4 !== 0) parts.push(0);
  }
  return Uint8Array.from(parts);
}

const META = { tokenizerId: 'openai-o200k_base', maxPieceBytes: 128, counts: { pieces: 199998, specials: 2 } };
const metaSection = ['META', Buffer.from(JSON.stringify(META))] as const;
const pces = ['PCES', Uint8Array.of(1, 1, 0x41)] as const; // 3 bytes → exercises the padding

describe('readTsbvMeta', () => {
  it('reads META from a bare container and from the gzip wire file, after other sections', () => {
    const raw = container([pces, metaSection]);
    expect(readTsbvMeta(raw)).toEqual(META);
    expect(readTsbvMeta(new Uint8Array(gzipSync(raw)))).toEqual(META);
  });

  it('rejects bad magic, unknown versions, truncation, a missing META and non-object META', () => {
    expect(() => readTsbvMeta(Buffer.from('PK\u0003\u0004 not a container'))).toThrow('not a TSBV1 container');
    expect(() => readTsbvMeta(container([metaSection], 2))).toThrow('unsupported TSBV version 2');
    expect(() => readTsbvMeta(container([pces, metaSection]).subarray(0, 20))).toThrow('truncated');
    expect(() => readTsbvMeta(container([pces]))).toThrow('no META section');
    expect(() => readTsbvMeta(container([['META', Buffer.from('[1]')]]))).toThrow('not a JSON object');
  });
});
