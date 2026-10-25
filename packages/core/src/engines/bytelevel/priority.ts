/**
 * `RankPriority` (04 §2.1): the byte-level `PairPriority` the shared agenda loop runs on. Merging the parts `[l, m)` and
 * `[m, r)` of the working buffer has priority = the PCES index (= tiktoken rank) of the bytes `[l, r)`, or `NO_MERGE`
 * when they are not a vocabulary entry; lower wins, ties go to the smaller `l` (the agenda's heap key), which is
 * tiktoken's "lowest rank, leftmost" rule (docs/adr/0003-agenda-equivalence.md).
 *
 * - Slices longer than `META.maxPieceBytes` are `NO_MERGE` before any hashing, so long whitespace or punctuation runs never
 *   hash hopeless candidates.
 * - `mergedId` is the TOKEN id `rank + idOffset`; the timeline records it as both `stepRank` and `stepResultId`
 *   (`TimelineRecorder` with `rank: 'resultId'`), which is what the fixtures call "rank" (Grok-2 1128 = index 1000 + 128).
 * - The agenda calls `priority(l, m, r)` (its stale check) immediately before `mergedId(l, m, r)` for the same pair, so the
 *   last lookup is memoised and a merge costs one hash, not two.
 */
import { NO_MERGE, type PairPriority } from '../../agenda/types.ts';
import type { ByteVocab } from '../../format/types.ts';

export class RankPriority implements PairPriority {
  private readonly vocab: ByteVocab;
  private readonly buf: Uint8Array;
  private readonly maxPieceBytes: number;
  private readonly idOffset: number;
  private lastLeft = -1;
  private lastRight = -1;
  private lastIndex = -1;

  /** `buf` is the UTF-8 working buffer the agenda's offsets index into (the whole encoded text). */
  constructor(vocab: ByteVocab, buf: Uint8Array, maxPieceBytes: number, idOffset: number) {
    this.vocab = vocab;
    this.buf = buf;
    this.maxPieceBytes = maxPieceBytes;
    this.idOffset = idOffset;
  }

  priority(l: number, _m: number, r: number): number {
    if (r - l > this.maxPieceBytes) return NO_MERGE;
    const index = this.vocab.indexOf(this.buf, l, r);
    this.lastLeft = l;
    this.lastRight = r;
    this.lastIndex = index;
    return index >= 0 ? index : NO_MERGE;
  }

  mergedId(l: number, _m: number, r: number): number {
    const index = l === this.lastLeft && r === this.lastRight ? this.lastIndex : this.vocab.indexOf(this.buf, l, r);
    return index + this.idOffset;
  }
}
