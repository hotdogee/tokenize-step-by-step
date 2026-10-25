/**
 * Strict UTF-8 decoding for `@tsbs/core`, whose `lib` is ES2023 only (02 §4): `TextDecoder` is a Web API that every
 * target provides (browsers, Workers, Node), so it is reached through `globalThis` with a minimal local type instead
 * of a global declaration.
 */

/** The part of `TextDecoder` the core uses. */
export interface Utf8Decoder {
  decode(input: Uint8Array): string;
}

type Utf8DecoderConstructor = new (label: 'utf-8', options: { fatal: boolean; ignoreBOM: boolean }) => Utf8Decoder;

/**
 * `new TextDecoder('utf-8', { fatal: true, ignoreBOM: true })`: invalid UTF-8 throws instead of becoming U+FFFD, and a
 * leading BOM stays in the string (9 o200k ranks start with `EF BB BF`, research §4.2).
 */
export function createStrictUtf8Decoder(): Utf8Decoder {
  const Decoder = (globalThis as unknown as { TextDecoder: Utf8DecoderConstructor }).TextDecoder;
  return new Decoder('utf-8', { fatal: true, ignoreBOM: true });
}

/** Decodes `bytes`, or returns `null` when they are not valid UTF-8. */
export function decodeUtf8OrNull(decoder: Utf8Decoder, bytes: Uint8Array): string | null {
  try {
    return decoder.decode(bytes);
  } catch {
    return null;
  }
}
