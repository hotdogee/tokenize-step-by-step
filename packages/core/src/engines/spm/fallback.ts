/**
 * Step 5 of the SentencePiece encode (04 §3.2) plus the reading of the final parts: every live part of the agenda becomes
 * one token, except a part whose bytes are not a token piece, which falls back to one BYTE token per UTF-8 byte
 * (id = `byteFirstId + byte`, the value taken from the byte, never from the `<0xNN>` string).
 *
 * - SentencePiece order (`after-merge`): the fallback happens here and is recorded as a `StepKind.ByteFallbackSplit` step
 *   over the shattered part (Grok-1 灣 → `<0xE7><0x81><0xA3>`), which gives birth to its inner boundaries (`stepRank` 0:
 *   a split has no priority; `stepResultId` = the first byte's id).
 * - HF order (`before-merge`): the symbolizer already split such code points into `FallbackByte` symbols (boundaries born
 *   at step 0), so they are read as BYTE tokens with no step.
 *
 * Kinds: a pre-matched USER_DEFINED symbol is `UserDefined`, a matched special is `Special`, the bare dummy prefix is
 * `DummyPrefix`; any other piece — including one reached by merges whose type would say USER_DEFINED — is `Normal`
 * (AD-31), and BYTE / CONTROL / UNK pieces keep those kinds.
 */
import type { PartList, TraceRecorder } from '../../agenda/types.ts';
import { PieceType } from '../../format/tsbv1.ts';
import type { ByteVocab } from '../../format/types.ts';
import { StepKind, TokenKind } from '../../model/result.ts';
import { isTokenPiece, SymbolKind, type Symbols } from './symbolize.ts';

/** The tokens of the text, in working-buffer coordinates. */
export interface PartTokens {
  readonly count: number;
  readonly normStart: Int32Array;
  readonly normEnd: Int32Array;
  readonly id: Int32Array;
  readonly kind: Uint8Array;
  /** ByteFallbackSplit steps recorded (or that would have been, without a recorder). */
  readonly splits: number;
}

export interface ReadTokensInput {
  readonly norm: Uint8Array;
  readonly parts: PartList;
  readonly symbols: Symbols;
  readonly vocab: ByteVocab;
  readonly types: Uint8Array;
  readonly byteFirstId: number;
  /** Working bytes of the dummy prefix (0 or 3). */
  readonly dummyBytes: number;
  readonly trace: TraceRecorder | null;
}

/** `TokenKind` of a piece reached by merges (AD-31: never UserDefined). */
function mergedKind(type: number | undefined): number {
  switch (type) {
    case PieceType.Byte:
      return TokenKind.Byte;
    case PieceType.Control:
      return TokenKind.Control;
    case PieceType.Unk:
      return TokenKind.Unk;
    default:
      return TokenKind.Normal;
  }
}

/** Reads the live parts into tokens, applying the byte fallback (see the module comment). */
export function readTokens(input: ReadTokensInput): PartTokens {
  const { norm, parts, symbols, vocab, types, byteFirstId, dummyBytes, trace } = input;
  const n = norm.length;
  // A part that is not a piece is one unmerged symbol (≤ 4 bytes); merged and frozen parts are one token each.
  const capacity = Math.min(n, 4 * parts.count);
  const normStart = new Int32Array(capacity);
  const normEnd = new Int32Array(capacity);
  const id = new Int32Array(capacity);
  const kind = new Uint8Array(capacity);
  let count = 0;
  let splits = 0;
  const emit = (l: number, r: number, token: number, k: number): void => {
    normStart[count] = l;
    normEnd[count] = r;
    id[count] = token;
    kind[count++] = k;
  };
  const { start, end, next, frozen } = parts;
  for (let a = parts.head; a !== -1; a = next[a] ?? -1) {
    const l = start[a] ?? 0;
    const r = end[a] ?? 0;
    const symbolEnd = a + 1 < symbols.count ? (symbols.start[a + 1] ?? n) : n;
    if (frozen[a]) {
      const k = symbols.kind[a] === SymbolKind.UserDefined ? TokenKind.UserDefined : TokenKind.Special;
      emit(l, r, symbols.id[a] ?? -1, k);
      continue;
    }
    const index = vocab.indexOf(norm, l, r);
    if (r !== symbolEnd) {
      if (index < 0) throw new Error(`spm: merged part [${String(l)}, ${String(r)}) is not a piece`);
      emit(l, r, index, mergedKind(types[index]));
    } else if (isTokenPiece(types, index)) {
      emit(l, r, index, l === 0 && r === dummyBytes ? TokenKind.DummyPrefix : TokenKind.Normal);
    } else {
      if (symbols.kind[a] !== SymbolKind.FallbackByte) {
        trace?.record(StepKind.ByteFallbackSplit, l, l, r, 0, byteFirstId + (norm[l] ?? 0), 0);
        splits++;
      }
      for (let b = l; b < r; b++) emit(b, b + 1, byteFirstId + (norm[b] ?? 0), TokenKind.Byte);
    }
  }
  return { count, normStart, normEnd, id, kind, splits };
}
