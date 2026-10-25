/**
 * Table equality for the `verify` round trip (decoded `.bin` vs freshly parsed raw source). Returns the first
 * difference as a sentence, or null when the tables are identical.
 */
import type { DecodedContainer } from './inspect.ts';
import { hex, type VocabTables } from './tables.ts';

function bytesEqual(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false;
  return true;
}

function arraysEqual(a: ArrayLike<number> | null, b: ArrayLike<number> | null): boolean {
  if (a === null || b === null) return a === b;
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false; // -0 === 0: PRIO stores integers
  return true;
}

/** First difference between decoded and parsed tables, or null. */
export function firstTableDifference(decoded: DecodedContainer, parsed: VocabTables): string | null {
  if (decoded.pieces.length !== parsed.pieces.length)
    return `piece count ${String(decoded.pieces.length)} != ${String(parsed.pieces.length)}`;
  for (let i = 0; i < decoded.pieces.length; i++) {
    const a = decoded.pieces[i];
    const b = parsed.pieces[i];
    if (a === undefined || b === undefined || !bytesEqual(a, b))
      return `piece ${String(i)}: ${a === undefined ? '-' : hex(a)} != ${b === undefined ? '-' : hex(b)}`;
  }
  if (!arraysEqual(decoded.types, parsed.types)) return 'TYPS differ';
  if (!arraysEqual(decoded.scores, parsed.scores)) return 'scores differ';
  if (!arraysEqual(decoded.merges?.resultId ?? null, parsed.merges?.resultId ?? null)) return 'merge result ids differ';
  if (!arraysEqual(decoded.merges?.splitUtf16 ?? null, parsed.merges?.splitUtf16 ?? null))
    return 'merge split offsets differ';
  if (decoded.specials.length !== parsed.specials.length)
    return `special count ${String(decoded.specials.length)} != ${String(parsed.specials.length)}`;
  for (let i = 0; i < decoded.specials.length; i++) {
    const a = decoded.specials[i];
    const b = parsed.specials[i];
    if (a?.id !== b?.id || a?.text !== b?.text) return `special ${String(i)} differs`;
  }
  return null;
}
