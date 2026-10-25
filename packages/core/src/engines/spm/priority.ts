/**
 * The two literal SentencePiece priority providers of the shared agenda (AD-5, AD-6, 04 §3.2 step 4). Both look the merged
 * slice `norm[l, r)` up as bytes in the `ByteVocab` (no strings) and refuse slices longer than `META.maxPieceBytes`
 * before hashing; ties go to the smaller `l` in the agenda itself (SentencePiece: score, then leftmost; HF: (rank, pos)).
 *
 * - `ScorePriority` (Grok-1, Gemma 1/2): admissible iff the slice is a NORMAL or USER_DEFINED piece (SentencePiece keeps
 *   CONTROL / UNK / BYTE pieces out of its merge map; UNUSED pieces would need resegmentation, which the reader rejects, so
 *   that branch cannot be reached); priority = −score.
 * - `MergeRankPriority` (Gemma 4): the HF merge rank of the exact split (result piece + left-half byte length, CSR lookup);
 *   a split that is not in the merge list is not mergeable, whatever the pieces.
 *
 * `mergedId` is the piece id (= token id for spm). Each provider is bound to one working buffer (one encode) and caches
 * the last lookup, because the agenda calls `priority` and then `mergedId` for the same slice.
 */
import { NO_MERGE, type PairPriority } from '../../agenda/types.ts';
import { mergeRankOf } from '../../format/tsbv1.ts';
import type { ByteVocab, Tsbv1 } from '../../format/types.ts';
import { isTokenPiece } from './symbolize.ts';

/** The decoded tables a provider reads. */
export interface PriorityTables {
  readonly vocab: ByteVocab;
  readonly types: Uint8Array;
  readonly maxPieceBytes: number;
}

/** Shared slice lookup with a one-entry cache. */
abstract class SlicePriority implements PairPriority {
  protected readonly vocab: ByteVocab;
  protected readonly types: Uint8Array;
  protected readonly norm: Uint8Array;
  private readonly maxPieceBytes: number;
  private lastL = -1;
  private lastR = -1;
  private lastIndex = -1;

  constructor(tables: PriorityTables, norm: Uint8Array) {
    this.vocab = tables.vocab;
    this.types = tables.types;
    this.maxPieceBytes = tables.maxPieceBytes;
    this.norm = norm;
  }

  /** Piece index of `norm[l, r)`, or −1 (also for slices longer than any piece). */
  protected indexOf(l: number, r: number): number {
    if (l !== this.lastL || r !== this.lastR) {
      this.lastL = l;
      this.lastR = r;
      this.lastIndex = r - l > this.maxPieceBytes ? -1 : this.vocab.indexOf(this.norm, l, r);
    }
    return this.lastIndex;
  }

  abstract priority(l: number, m: number, r: number): number;

  mergedId(l: number, _m: number, r: number): number {
    return this.indexOf(l, r);
  }
}

/** SentencePiece order: −score of the merged piece; NORMAL / USER_DEFINED only. */
export class ScorePriority extends SlicePriority {
  private readonly scores: Int32Array | Float32Array;

  constructor(tables: PriorityTables & { readonly scores: Int32Array | Float32Array }, norm: Uint8Array) {
    super(tables, norm);
    this.scores = tables.scores;
  }

  priority(l: number, _m: number, r: number): number {
    const index = this.indexOf(l, r);
    if (!isTokenPiece(this.types, index)) return NO_MERGE;
    return 0 - (this.scores[index] ?? 0); // 0 − s, so a zero score is +0, not −0
  }
}

/** HF order: the rank of the merge that forms `norm[l, r)` with its left half `m − l` bytes long. */
export class MergeRankPriority extends SlicePriority {
  private readonly merges: NonNullable<Tsbv1['merges']>;

  constructor(tables: PriorityTables & { readonly merges: NonNullable<Tsbv1['merges']> }, norm: Uint8Array) {
    super(tables, norm);
    this.merges = tables.merges;
  }

  priority(l: number, m: number, r: number): number {
    const index = this.indexOf(l, r);
    if (index < 0) return NO_MERGE;
    const rank = mergeRankOf(this.merges, index, m - l);
    return rank < 0 ? NO_MERGE : rank;
  }
}
