/**
 * Step 3 of the SentencePiece encode (04 §3.2): the working buffer becomes the initial symbols of the agenda.
 *
 * At each code-point start the pre-matched pieces are tried longest first (SentencePiece's `PrefixMatcher`, the oracle's
 * `spm_bpe_ref.py`): the USER_DEFINED pieces always (fixture policy `user-defined-atomic`; for a merge-rank asset these
 * are its non-special added tokens — none for Gemma 4), plus the specials (CONTROL / UNK pieces, special added tokens)
 * under `specialTokens: 'match'`. A match is one frozen symbol that never merges. Otherwise the symbol is one code point;
 * with `fallbackOrder: 'before-merge'` (HF) a code point that is not a token piece is replaced by one symbol per byte here,
 * before any merge. Specials are matched on the working buffer, i.e. after space escaping (HF matches its added tokens on
 * the raw text): the same thing for every shipped asset, since no special string contains a space or U+2581.
 */
import { PieceType } from '../../format/tsbv1.ts';
import type { ByteVocab, Tsbv1 } from '../../format/types.ts';
import { sequenceLength } from './normalize.ts';

/** What a symbol is; kept per agenda slot (slot i = symbol i) until the final tokens are read. */
export const SymbolKind = { CodePoint: 0, UserDefined: 1, Special: 2, FallbackByte: 3 } as const;

/** Terminal kinds of the prefix trie (a bit mask selects which ones may match). */
export const MatchKind = { UserDefined: 1, Special: 2 } as const;

/** True iff `index` is a piece the agenda may merge into or a symbol may stand for: NORMAL or USER_DEFINED. */
export function isTokenPiece(types: Uint8Array, index: number): boolean {
  if (index < 0) return false;
  const type = types[index];
  return type === PieceType.Normal || type === PieceType.UserDefined;
}

/**
 * Byte trie over the pre-matched pieces. `match` walks it from a position and keeps the longest terminal whose kind is in
 * the mask; when a string is both USER_DEFINED and special, USER_DEFINED wins (as in the oracle).
 */
export class PrefixMatcher {
  /** `node * 256 + byte` → child node. Node 0 is the root. */
  readonly #edges = new Map<number, number>();
  readonly #id: number[] = [-1];
  readonly #kind: number[] = [0];
  /** Id and kind of the last successful `match`. */
  matchId = -1;
  matchKind = 0;

  /** Adds `bytes` as a terminal of `kind` with token id `id` (an existing USER_DEFINED terminal is kept). */
  add(bytes: Uint8Array, id: number, kind: number): void {
    let node = 0;
    for (const byte of bytes) {
      const key = node * 256 + byte;
      let child = this.#edges.get(key);
      if (child === undefined) {
        child = this.#id.length;
        this.#id.push(-1);
        this.#kind.push(0);
        this.#edges.set(key, child);
      }
      node = child;
    }
    if (this.#kind[node] !== MatchKind.UserDefined) {
      this.#id[node] = id;
      this.#kind[node] = kind;
    }
  }

  /** Length of the longest terminal (kind in `mask`) that `buf[pos, end)` starts with, or 0. Sets `matchId/matchKind`. */
  match(buf: Uint8Array, pos: number, end: number, mask: number): number {
    let node = 0;
    let best = 0;
    for (let i = pos; i < end; i++) {
      const child = this.#edges.get(node * 256 + (buf[i] ?? 0));
      if (child === undefined) break;
      node = child;
      const kind = this.#kind[node] ?? 0;
      if ((kind & mask) !== 0) {
        best = i + 1 - pos;
        this.matchId = this.#id[node] ?? -1;
        this.matchKind = kind;
      }
    }
    return best;
  }
}

/** The trie of an asset: its USER_DEFINED pieces and its `SPCL` specials. Null when there is nothing to pre-match. */
export function buildPrefixMatcher(tsbv: Tsbv1): PrefixMatcher | null {
  const { vocab, types, specials } = tsbv;
  if (types === null) return null;
  const matcher = new PrefixMatcher();
  let terminals = 0;
  for (let i = 0; i < types.length; i++) {
    if (types[i] === PieceType.UserDefined) {
      matcher.add(vocab.bytesOf(i), i, MatchKind.UserDefined);
      terminals++;
    }
  }
  for (const special of specials) matcher.add(special.bytes, special.id, MatchKind.Special);
  return terminals + specials.length > 0 ? matcher : null;
}

/** The initial symbols (struct of arrays; `count` used entries). */
export interface Symbols {
  readonly count: number;
  /** Working-buffer start of each symbol; symbol i ends where symbol i + 1 starts (the last at `norm.length`). */
  readonly start: Int32Array;
  readonly kind: Uint8Array;
  /** 1 = frozen (pre-matched). */
  readonly frozen: Uint8Array;
  /** Token id of a pre-matched symbol, else −1. */
  readonly id: Int32Array;
}

export interface SymbolizeOptions {
  readonly vocab: ByteVocab;
  readonly types: Uint8Array;
  readonly matcher: PrefixMatcher | null;
  /** `MatchKind` bits allowed to match: UserDefined always, Special under `specialTokens: 'match'`. */
  readonly mask: number;
  /** HF order: replace a code point that is not a token piece by one symbol per byte. */
  readonly beforeMerge: boolean;
}

/** Splits `norm` into its initial symbols (see the module comment). */
export function symbolize(norm: Uint8Array, options: SymbolizeOptions): Symbols {
  const { vocab, types, matcher, mask, beforeMerge } = options;
  const n = norm.length;
  const start = new Int32Array(n);
  const kind = new Uint8Array(n);
  const frozen = new Uint8Array(n);
  const id = new Int32Array(n).fill(-1);
  let count = 0;
  let p = 0;
  while (p < n) {
    const matched = matcher === null ? 0 : matcher.match(norm, p, n, mask);
    if (matched > 0 && matcher !== null) {
      start[count] = p;
      kind[count] = matcher.matchKind === MatchKind.UserDefined ? SymbolKind.UserDefined : SymbolKind.Special;
      frozen[count] = 1;
      id[count++] = matcher.matchId;
      p += matched;
      continue;
    }
    const len = Math.min(sequenceLength(norm[p] ?? 0), n - p);
    const fallback = beforeMerge && !isTokenPiece(types, vocab.indexOf(norm, p, p + len));
    for (let b = 0; b < (fallback ? len : 1); b++) {
      start[count] = p + b;
      kind[count++] = fallback ? SymbolKind.FallbackByte : SymbolKind.CodePoint;
    }
    p += len;
  }
  return { count, start, kind, frozen, id };
}
