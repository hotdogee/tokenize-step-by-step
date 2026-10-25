/**
 * UTF-8 helpers with exact `TextEncoder` / `TextDecoder({ fatal: true, ignoreBOM: true })` semantics.
 *
 * `@tsbs/core` compiles against `lib: ["ES2023"]` only (02 §4), where neither `TextEncoder` nor `TextDecoder` exists, so the
 * few conversions the model needs are written out here. Lone surrogates encode as U+FFFD (`EF BF BD`) exactly as
 * `TextEncoder` does (03 §B.2); decoding follows the WHATWG UTF-8 decoder (no overlongs, no surrogates, ≤ U+10FFFF) and
 * keeps a leading BOM (`ignoreBOM: true`, AD-8).
 */

/** U+FFFD, what an unpaired surrogate becomes in UTF-8. */
export const REPLACEMENT_CHARACTER = 0xfffd;

/** Number of UTF-8 bytes of the scalar value `cp` (1..4). Callers map surrogates to U+FFFD first. */
export function utf8Length(cp: number): number {
  if (cp < 0x80) return 1;
  if (cp < 0x800) return 2;
  if (cp < 0x10000) return 3;
  return 4;
}

/** Writes the UTF-8 of scalar value `cp` into `out` at `offset` and returns the offset after it. */
export function writeUtf8(out: Uint8Array, offset: number, cp: number): number {
  if (cp < 0x80) {
    out[offset] = cp;
    return offset + 1;
  }
  if (cp < 0x800) {
    out[offset] = 0xc0 | (cp >> 6);
    out[offset + 1] = 0x80 | (cp & 0x3f);
    return offset + 2;
  }
  if (cp < 0x10000) {
    out[offset] = 0xe0 | (cp >> 12);
    out[offset + 1] = 0x80 | ((cp >> 6) & 0x3f);
    out[offset + 2] = 0x80 | (cp & 0x3f);
    return offset + 3;
  }
  out[offset] = 0xf0 | (cp >> 18);
  out[offset + 1] = 0x80 | ((cp >> 12) & 0x3f);
  out[offset + 2] = 0x80 | ((cp >> 6) & 0x3f);
  out[offset + 3] = 0x80 | (cp & 0x3f);
  return offset + 4;
}

/**
 * The code point at UTF-16 index `i` of `text` and its length in UTF-16 units, with lone surrogates reported as U+FFFD
 * (length 1), which is what `TextEncoder` writes for them.
 */
export function scalarAt(
  text: string,
  i: number,
): { readonly cp: number; readonly units: 1 | 2; readonly lone: boolean } {
  const cp = text.codePointAt(i) ?? REPLACEMENT_CHARACTER;
  if (cp >= 0x10000) return { cp, units: 2, lone: false };
  if (cp >= 0xd800 && cp <= 0xdfff) return { cp: REPLACEMENT_CHARACTER, units: 1, lone: true };
  return { cp, units: 1, lone: false };
}

/** UTF-8 of `text`, byte-for-byte what `new TextEncoder().encode(text)` returns. */
export function encodeUtf8(text: string): Uint8Array {
  let bytes = 0;
  for (let i = 0; i < text.length;) {
    const { cp, units } = scalarAt(text, i);
    bytes += utf8Length(cp);
    i += units;
  }
  const out = new Uint8Array(bytes);
  let offset = 0;
  for (let i = 0; i < text.length;) {
    const { cp, units } = scalarAt(text, i);
    offset = writeUtf8(out, offset, cp);
    i += units;
  }
  return out;
}

function isContinuation(byte: number | undefined): boolean {
  return byte !== undefined && (byte & 0xc0) === 0x80;
}

/**
 * Length of the well-formed UTF-8 sequence that starts at `start` (and ends at or before `end`), or 0 when the bytes there
 * are not one (WHATWG decoder rules: no overlong forms, no surrogates, nothing above U+10FFFF).
 */
export function utf8SequenceLength(bytes: Uint8Array, start: number, end: number = bytes.length): number {
  const b0 = bytes[start];
  if (b0 === undefined || start >= end) return 0;
  if (b0 < 0x80) return 1;
  let length: number;
  let lo = 0x80;
  let hi = 0xbf;
  if (b0 >= 0xc2 && b0 <= 0xdf) length = 2;
  else if (b0 >= 0xe0 && b0 <= 0xef) {
    length = 3;
    if (b0 === 0xe0) lo = 0xa0;
    else if (b0 === 0xed) hi = 0x9f;
  } else if (b0 >= 0xf0 && b0 <= 0xf4) {
    length = 4;
    if (b0 === 0xf0) lo = 0x90;
    else if (b0 === 0xf4) hi = 0x8f;
  } else return 0;
  if (start + length > end) return 0;
  const b1 = bytes[start + 1] ?? 0;
  if (b1 < lo || b1 > hi) return 0;
  for (let k = 2; k < length; k++) if (!isContinuation(bytes[start + k])) return 0;
  return length;
}

/** True iff `bytes[start, end)` is complete, well-formed UTF-8 (the empty range is). */
export function isValidUtf8(bytes: Uint8Array, start = 0, end: number = bytes.length): boolean {
  for (let i = start; i < end;) {
    const length = utf8SequenceLength(bytes, i, end);
    if (length === 0) return false;
    i += length;
  }
  return true;
}

/** Decodes the scalar value of the well-formed sequence of `length` bytes at `start`. */
function scalarOf(bytes: Uint8Array, start: number, length: number): number {
  const b0 = bytes[start] ?? 0;
  if (length === 1) return b0;
  let cp = b0 & (length === 2 ? 0x1f : length === 3 ? 0x0f : 0x07);
  for (let k = 1; k < length; k++) cp = (cp << 6) | ((bytes[start + k] ?? 0) & 0x3f);
  return cp;
}

/**
 * `new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(bytes.subarray(start, end))`, or `null` where that
 * would throw. A leading BOM is kept.
 */
export function decodeUtf8(bytes: Uint8Array, start = 0, end: number = bytes.length): string | null {
  let out = '';
  const batch: number[] = [];
  for (let i = start; i < end;) {
    const length = utf8SequenceLength(bytes, i, end);
    if (length === 0) return null;
    batch.push(scalarOf(bytes, i, length));
    if (batch.length === 4096) {
      out += String.fromCodePoint(...batch);
      batch.length = 0;
    }
    i += length;
  }
  return out + String.fromCodePoint(...batch);
}

/** Two-digit uppercase hex of a byte ("E5"), the byte-tier and inspector spelling (05 §4). */
export function hexByte(byte: number): string {
  return byte.toString(16).toUpperCase().padStart(2, '0');
}

/** `U+XXXX` (at least four uppercase hex digits). */
export function codePointLabel(cp: number): string {
  return `U+${cp.toString(16).toUpperCase().padStart(4, '0')}`;
}
