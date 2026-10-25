/**
 * GPT-2 `bytes_to_unicode` and its inverse. HF byte-level BPE stores each byte as one printable code point: bytes
 * `!`..`~`, `¡`..`¬`, `®`..`ÿ` map to themselves, the other 68 bytes to U+0100 + n in byte order. A vocabulary key is
 * therefore decoded one code point = one byte (03 §C.5 `hfByteLevel`).
 */

function printableBytes(): number[] {
  const bytes: number[] = [];
  for (let b = 0x21; b <= 0x7e; b++) bytes.push(b);
  for (let b = 0xa1; b <= 0xac; b++) bytes.push(b);
  for (let b = 0xae; b <= 0xff; b++) bytes.push(b);
  return bytes;
}

/** byte → code point (GPT-2 `bytes_to_unicode`). */
export const BYTE_TO_CODE_POINT: readonly number[] = (() => {
  const table = new Array<number>(256).fill(-1);
  for (const b of printableBytes()) table[b] = b;
  let n = 0;
  for (let b = 0; b < 256; b++) if (table[b] === -1) table[b] = 256 + n++;
  return table;
})();

/** code point → byte (the inverse map). */
export const CODE_POINT_TO_BYTE: ReadonlyMap<number, number> = new Map(BYTE_TO_CODE_POINT.map((cp, b) => [cp, b]));

/** Decodes an HF byte-level vocabulary key into raw bytes; throws on a code point outside the 256-entry map. */
export function decodeByteLevelKey(key: string): Uint8Array {
  const out = new Uint8Array(key.length);
  let n = 0;
  for (const char of key) {
    const byte = CODE_POINT_TO_BYTE.get(char.codePointAt(0) ?? -1);
    if (byte === undefined)
      throw new Error(
        `byte-level key ${JSON.stringify(key)} contains U+${(char.codePointAt(0) ?? 0).toString(16).toUpperCase()}, which is not in the GPT-2 byte map`,
      );
    out[n++] = byte;
  }
  return out.subarray(0, n);
}

/** Encodes raw bytes as an HF byte-level key (tests and cross-checks). */
export function encodeByteLevelKey(bytes: Uint8Array): string {
  return String.fromCodePoint(...Array.from(bytes, (b) => BYTE_TO_CODE_POINT[b] ?? 0));
}
