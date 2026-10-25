/**
 * A minimal TSBV1 writer for the Worker tests (03 §C.1): a byte-level container with the 256 single bytes, a few
 * multi-byte pieces and one special. `@tsbs/worker` tests may import only `@tsbs/core` (02 §2.1), so the converter's
 * writer is not available here; this one covers just what `readTsbv1` requires.
 */
import type { TokenizerId } from '@tsbs/core';

const encoder = new TextEncoder();

function varint(value: number, out: number[]): void {
  let v = value;
  while (v >= 0x80) {
    out.push((v & 0x7f) | 0x80);
    v = Math.floor(v / 128);
  }
  out.push(v);
}

function section(tag: string, payload: Uint8Array): number[] {
  const out = [...encoder.encode(tag)];
  const n = payload.length;
  out.push(n & 0xff, (n >>> 8) & 0xff, (n >>> 16) & 0xff, (n >>> 24) & 0xff, ...payload);
  while (out.length % 4 !== 0) out.push(0);
  return out;
}

/** Extra pieces after the 256 single bytes (ids 256…): "ab", "台", "灣". */
export const EXTRA_PIECES: readonly string[] = ['ab', '台', '灣'];

/** A valid byte-level TSBV1 container for `tokenizerId` (raw, not gzipped). */
export function buildContainer(tokenizerId: TokenizerId = 'openai-o200k_base'): Uint8Array<ArrayBuffer> {
  const pieces: Uint8Array[] = [];
  for (let b = 0; b < 256; b++) pieces.push(Uint8Array.of(b));
  for (const text of EXTRA_PIECES) pieces.push(encoder.encode(text));
  const special = encoder.encode('<|endoftext|>');
  const meta = {
    tokenizerId,
    family: 'bytelevel-bpe',
    upstream: {
      assetId: tokenizerId,
      file: 'test',
      sha256: '0'.repeat(64),
      url: 'test:',
      revision: 'r',
      retrievedOn: '2026-10-25',
    },
    counts: { pieces: pieces.length, specials: 1 },
    maxPieceBytes: Math.max(...pieces.map((p) => p.length)),
    unusedCount: 0,
    idOffset: 0,
    modificationNotice: 'test container',
    unicodeVersion: '16.0.0',
    generator: 'worker-test',
  };
  const pces: number[] = [];
  varint(pieces.length, pces);
  for (const p of pieces) {
    varint(p.length, pces);
    pces.push(...p);
  }
  const spcl: number[] = [];
  varint(1, spcl);
  varint(pieces.length, spcl);
  varint(special.length, spcl);
  spcl.push(...special);
  const body = [
    ...section('META', encoder.encode(JSON.stringify(meta))),
    ...section('PCES', Uint8Array.from(pces)),
    ...section('SPCL', Uint8Array.from(spcl)),
  ];
  return Uint8Array.from([0x54, 0x53, 0x42, 0x56, 1, 0, 3, 0, ...body]);
}
