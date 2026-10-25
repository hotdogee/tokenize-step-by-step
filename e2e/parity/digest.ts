/**
 * Pure helpers shared by the parity harness (browser, bundled by esbuild) and the parity spec (Node), so both sides
 * compute byte offsets and table digests with the same code.
 */

/** UTF-8 offset of every UTF-16 index of `text` (length + 1 entries; a lone surrogate counts 3 bytes, as `TextEncoder`). */
export function utf8Offsets(text: string): Uint32Array {
  const offsets = new Uint32Array(text.length + 1);
  let bytes = 0;
  for (let i = 0; i < text.length; i += 1) {
    offsets[i] = bytes;
    const unit = text.charCodeAt(i);
    const next = text.charCodeAt(i + 1);
    if (unit >= 0xd800 && unit <= 0xdbff && next >= 0xdc00 && next <= 0xdfff) {
      offsets[i + 1] = bytes;
      bytes += 4;
      i += 1;
    } else bytes += unit < 0x80 ? 1 : unit < 0x800 ? 2 : 3;
  }
  offsets[text.length] = bytes;
  return offsets;
}

/** FNV-1a 32 over each piece prefixed by its length (mod 256), as 8 hex digits: one value for a whole piece table. */
export function pieceDigest(count: number, bytesOf: (index: number) => Uint8Array): string {
  let hash = 0x811c9dc5;
  const mix = (byte: number): void => {
    hash = Math.imul(hash ^ byte, 0x01000193) >>> 0;
  };
  for (let index = 0; index < count; index += 1) {
    const piece = bytesOf(index);
    mix(piece.length & 0xff);
    for (const byte of piece) mix(byte);
  }
  return hash.toString(16).padStart(8, '0');
}
