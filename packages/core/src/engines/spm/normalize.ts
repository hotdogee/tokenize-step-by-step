/**
 * Step 2 of the SentencePiece encode (04 §3.2): the identity normalizer with whitespace escaping and the dummy prefix,
 * producing the engine's working buffer `norm` and the monotone map `normToOrig` back to the original UTF-8 bytes.
 *
 * - Every 0x20 becomes `▁` (E2 96 81); its three working bytes map to the one original byte: `[o, o, o, o + 1]`.
 * - A literal U+2581 keeps its three bytes and maps one to one.
 * - The dummy prefix (`addDummyPrefix` and non-empty text) is three working bytes mapping to original offset 0, so the part
 *   it starts is zero-width in the original byte space (03 §B.3). It is prepended unconditionally, never by testing for a
 *   space at the cursor.
 *
 * The identity normalizer is asserted at build time (empty `precompiled_charsmap`, no whitespace folding), so nothing
 * else is rewritten.
 */

/** The working buffer and its byte map. */
export interface NormalizedText {
  /** UTF-8 of the normalized text (escaped spaces, dummy prefix). */
  readonly norm: Uint8Array;
  /** `norm.length + 1` entries: original byte offset of each working byte (and of the end). Monotone. */
  readonly normToOrig: Uint32Array;
  /** Working bytes of the dummy prefix at offset 0: 3, or 0 when there is none. */
  readonly dummyBytes: number;
}

const SPACE = 0x20;
/** UTF-8 of U+2581 LOWER ONE EIGHTH BLOCK (`▁`). */
export const META_SYMBOL: readonly [number, number, number] = [0xe2, 0x96, 0x81];

/** Escapes `utf8` into the working buffer (see the module comment). */
export function normalizeSpm(utf8: Uint8Array, escapeWhitespace: boolean, addDummyPrefix: boolean): NormalizedText {
  const n = utf8.length;
  let spaces = 0;
  if (escapeWhitespace) for (let i = 0; i < n; i++) if (utf8[i] === SPACE) spaces++;
  const dummyBytes = addDummyPrefix && n > 0 ? 3 : 0;
  const size = n + 2 * spaces + dummyBytes;
  const norm = new Uint8Array(size);
  const normToOrig = new Uint32Array(size + 1);
  let w = 0;
  if (dummyBytes > 0) {
    norm.set(META_SYMBOL, 0);
    w = 3; // normToOrig[0..2] = 0 already
  }
  for (let o = 0; o < n; o++) {
    const byte = utf8[o] ?? 0;
    if (escapeWhitespace && byte === SPACE) {
      norm[w] = 0xe2;
      norm[w + 1] = 0x96;
      norm[w + 2] = 0x81;
      normToOrig[w] = o;
      normToOrig[w + 1] = o;
      normToOrig[w + 2] = o;
      w += 3;
    } else {
      norm[w] = byte;
      normToOrig[w] = o;
      w++;
    }
  }
  normToOrig[size] = n;
  return { norm, normToOrig, dummyBytes };
}

/** Byte length of the UTF-8 sequence led by `lead` (the working buffer is always valid UTF-8). */
export function sequenceLength(lead: number): number {
  return lead < 0x80 ? 1 : lead < 0xe0 ? 2 : lead < 0xf0 ? 3 : 4;
}
