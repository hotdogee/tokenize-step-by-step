/**
 * Long-input tiers (AD-27, binding; 05 §6), pure:
 *
 * | code points        | tier          | tokenization                       | trace                  | board                         |
 * | ------------------ | ------------- | ---------------------------------- | ---------------------- | ----------------------------- |
 * | ≤ 2,000            | `live`        | every edit (40 ms debounce)        | `true`                 | full, full replay             |
 * | 2,001–20,000       | `virtualized` | every edit                         | `true`                 | virtualized, scoped replay    |
 * | 20,001–100,000     | `on-demand`   | the banner's button, WHOLE text    | `{ maxSteps: 50_000 }` | 2,000-byte window of the run  |
 * | 100,001–200,000    | `on-demand`   | the banner's button, WHOLE text    | `false`                | window; stops 5–6 final tokens |
 * | > 200,000          | `capped`      | the first 200,000 code points only | `false`                | window; cap banner            |
 *
 * Code points are counted as `TextEncoder` and `analyzeText` count them (a lone surrogate is one code point, U+FFFD).
 */
import type { EncodeOptions, TokenizationResult } from '@tsbs/core';

/** Last code point count of the full-board tier. */
export const LIVE_MAX = 2000;
/** Last code point count that still tokenizes on every edit. */
export const VIRTUALIZED_MAX = 20_000;
/** Last code point count whose on-demand run records a (capped) merge timeline. */
export const TRACED_MAX = 100_000;
/** Code points analysed at most; beyond, the text stays in the textarea but is not analysed. */
export const ANALYSED_MAX = 200_000;
/** The merge-timeline cap of an on-demand run (`trace: { maxSteps }`). */
export const ON_DEMAND_MAX_STEPS = 50_000;
/** Bytes of the board's window into an on-demand result (05 §6). */
export const WINDOW_BYTES = 2000;
/** A result larger than this replaces the previous one only after that one is released, and never crossfades. */
export const RELEASE_ABOVE_BYTES = 8 * 1024 * 1024;

export type LongInputMode = 'live' | 'virtualized' | 'on-demand' | 'capped';

/** True for a UTF-16 high surrogate. */
const isHigh = (unit: number): boolean => unit >= 0xd800 && unit <= 0xdbff;
/** True for a UTF-16 low surrogate. */
const isLow = (unit: number): boolean => unit >= 0xdc00 && unit <= 0xdfff;

/** Code points of `text` (a surrogate pair is one; a lone surrogate is one, as U+FFFD). */
export function countCodePoints(text: string): number {
  let count = 0;
  for (let i = 0; i < text.length; i++) {
    if (isHigh(text.charCodeAt(i)) && i + 1 < text.length && isLow(text.charCodeAt(i + 1))) i++;
    count++;
  }
  return count;
}

/** UTF-8 bytes of `text` with `TextEncoder` semantics (a lone surrogate is U+FFFD, 3 bytes), without encoding it. */
export function utf8ByteLength(text: string): number {
  let bytes = 0;
  for (let i = 0; i < text.length; i++) {
    const unit = text.charCodeAt(i);
    if (unit < 0x80) bytes += 1;
    else if (unit < 0x800) bytes += 2;
    else if (isHigh(unit) && i + 1 < text.length && isLow(text.charCodeAt(i + 1))) {
      bytes += 4;
      i++;
    } else bytes += 3;
  }
  return bytes;
}

/** The tier of a text with `codePoints` code points. */
export function longInputMode(codePoints: number): LongInputMode {
  if (codePoints <= LIVE_MAX) return 'live';
  if (codePoints <= VIRTUALIZED_MAX) return 'virtualized';
  if (codePoints <= ANALYSED_MAX) return 'on-demand';
  return 'capped';
}

/** Tiers that tokenize only when asked (the banner's button). */
export function isOnDemand(mode: LongInputMode): boolean {
  return mode === 'on-demand' || mode === 'capped';
}

/** The `trace` option for a run over `codePoints` code points (the 03 §B.1 UI policy). */
export function traceFor(codePoints: number): EncodeOptions['trace'] {
  if (codePoints <= VIRTUALIZED_MAX) return true;
  if (codePoints <= TRACED_MAX) return { maxSteps: ON_DEMAND_MAX_STEPS };
  return false;
}

/** Bytes a result holds (its typed arrays and its two strings), for the 8 MB release rule. */
export function resultBytes(result: TokenizationResult): number {
  let bytes = (result.text.length + result.input.text.length) * 2;
  const add = (table: object | null): void => {
    if (table === null) return;
    for (const value of Object.values(table)) if (ArrayBuffer.isView(value)) bytes += value.byteLength;
  };
  add(result);
  add(result.chars);
  add(result.graphemes);
  add(result.chunks);
  add(result.tokens);
  add(result.timeline);
  return bytes;
}

/** A conservative estimate of `resultBytes` for a run over `utf8Bytes` bytes, before it is posted. */
export function estimatedResultBytes(utf8Bytes: number, trace: EncodeOptions['trace']): number {
  return utf8Bytes * (trace === false ? 24 : 34);
}

/** The analysed part of `text`: all of it, or its first `max` code points (a surrogate pair is never split). */
export function analysedText(text: string, max: number = ANALYSED_MAX): string {
  if (text.length <= max) return text;
  let count = 0;
  for (let i = 0; i < text.length; i++) {
    if (count === max) return text.slice(0, i);
    if (isHigh(text.charCodeAt(i)) && i + 1 < text.length && isLow(text.charCodeAt(i + 1))) i++;
    count++;
  }
  return text;
}
