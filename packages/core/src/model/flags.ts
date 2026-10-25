/**
 * Token flag and kind helpers (03 §B.1, §B.3): which `TokenFlag` bits the result builder derives from the byte spans, and
 * stable words for flags and kinds (inspector chips, `TokenInfo.flagsAsWords`, test messages).
 */
import { TokenFlag, TokenKind } from './result.ts';

/** Bits `buildResult` always recomputes from spans and char boundaries; engines supply only the other four. */
export const DERIVED_FLAGS = TokenFlag.Partial | TokenFlag.ZeroWidth | TokenFlag.StartsMidChar | TokenFlag.EndsMidChar;

/** Bits an engine (or the fixture bridge) supplies: Special, ByteFallback, UserDefined, DirectHit. */
export const SOURCE_FLAGS = 0xff & ~DERIVED_FLAGS;

/** Stable kebab-case word for each flag bit, in bit order. */
export const FLAG_WORDS: ReadonlyArray<readonly [number, string]> = [
  [TokenFlag.Partial, 'partial'],
  [TokenFlag.ZeroWidth, 'zero-width'],
  [TokenFlag.Special, 'special'],
  [TokenFlag.StartsMidChar, 'starts-mid-char'],
  [TokenFlag.EndsMidChar, 'ends-mid-char'],
  [TokenFlag.ByteFallback, 'byte-fallback'],
  [TokenFlag.UserDefined, 'user-defined'],
  [TokenFlag.DirectHit, 'direct-hit'],
];

/** The words of the bits set in `flags`, in bit order. */
export function flagsToWords(flags: number): string[] {
  return FLAG_WORDS.filter(([bit]) => (flags & bit) !== 0).map(([, word]) => word);
}

const KIND_NAMES: Readonly<Record<number, string>> = Object.fromEntries(
  Object.entries(TokenKind).map(([name, value]) => [value, name]),
);

/** `TokenKind` name for a numeric kind ("Normal", "Byte", …); "Unknown" for an out-of-range value. */
export function tokenKindName(kind: number): string {
  return KIND_NAMES[kind] ?? 'Unknown';
}

/** Flag bits implied by a token kind (e.g. Byte → ByteFallback, Bos → Special). */
export function flagsForKind(kind: number): number {
  switch (kind) {
    case TokenKind.Byte:
      return TokenFlag.ByteFallback;
    case TokenKind.UserDefined:
      return TokenFlag.UserDefined;
    case TokenKind.Special:
    case TokenKind.Bos:
      return TokenFlag.Special;
    default:
      return 0;
  }
}
