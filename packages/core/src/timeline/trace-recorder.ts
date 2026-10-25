/**
 * `TimelineRecorder` — the `TraceRecorder` (04 §1.1) that both engines hand to the agenda loop; it writes the per-step
 * arrays and the boundary born/died arrays of `MergeTimeline` (AD-9, 04 §1.4).
 *
 * Boundaries start permanent (born 0, died ALIVE), which is right for byte 0, `byteCount`, every chunk edge and every
 * boundary bordering or inside a SpecialString chunk (03 §B.2) as well as for byte-level boundaries inside an ordinary
 * chunk (born 0, removed by merges). Engines call `neverBorn` for the boundaries that do not exist at step 0: the inside of a
 * byte-level direct-hit chunk, and spm intra-code-point boundaries in SentencePiece order (born later by a split).
 *
 * Truncation (`trace: { maxSteps }`): steps after `maxSteps` are not stored, but born/died keep being written with the
 * value `maxSteps` (= `stepCount`), so `replay(timeline, stepCount)` still equals the final tokens (03 §B.2, AD-27).
 */
import type { TraceRecorder } from '../agenda/types.ts';
import { ALIVE, NEVER, StepKind, type EncodeOptions, type MergeTimeline } from '../model/result.ts';

export interface TimelineRecorderOptions {
  /** Store at most this many steps (`trace.maxSteps`); default: unlimited. */
  readonly maxSteps?: number;
  /** Working-buffer offset → original byte offset (spm `normToOrig`, 04 §3.2); applied to every recorded offset. */
  readonly offsetMap?: ArrayLike<number>;
  /** What `stepRank` stores: the agenda priority (default; spm −score / HF rank) or the merged id (byte-level, where the
   *  fixtures' "rank" is the token id = PCES index + idOffset, 04 §2.1). */
  readonly rank?: 'priority' | 'resultId';
  /** Grok-1's zero-width dummy part: born[0]/died[0] then describe the virtual boundary after it (04 §1.4). */
  readonly leadingZeroWidthPart?: boolean;
}

/** The step budget an `EncodeOptions.trace` value asks for: `null` = no timeline, `Infinity` = unlimited. */
export function maxStepsOf(trace: EncodeOptions['trace']): number | null {
  if (trace === false) return null;
  if (trace === true) return Number.POSITIVE_INFINITY;
  return trace.maxSteps;
}

/** A recorder for `trace`, or null when `trace === false`. */
export function recorderFor(
  byteCount: number,
  trace: EncodeOptions['trace'],
  options: Omit<TimelineRecorderOptions, 'maxSteps'> = {},
): TimelineRecorder | null {
  const maxSteps = maxStepsOf(trace);
  return maxSteps === null ? null : new TimelineRecorder(byteCount, { ...options, maxSteps });
}

export class TimelineRecorder implements TraceRecorder {
  /** UTF-8 length of the encoded text; born/died have byteCount + 1 entries. */
  readonly byteCount: number;
  private readonly maxSteps: number;
  private readonly offsetMap: ArrayLike<number> | null;
  private readonly rankIsResultId: boolean;
  private readonly leadingZeroWidthPart: boolean;
  private readonly born: Int32Array;
  private readonly died: Int32Array;
  private kind = new Uint8Array(64);
  private left = new Uint32Array(64);
  private mid = new Uint32Array(64);
  private end = new Uint32Array(64);
  private rank = new Float32Array(64);
  private resultId = new Int32Array(64);
  private chunk = new Uint32Array(64);
  private length = 0;
  private truncated = false;

  constructor(byteCount: number, options: TimelineRecorderOptions = {}) {
    const maxSteps = options.maxSteps ?? Number.POSITIVE_INFINITY;
    if (!(maxSteps === Number.POSITIVE_INFINITY || (Number.isInteger(maxSteps) && maxSteps >= 0))) {
      throw new RangeError(`maxSteps must be a non-negative integer, got ${String(maxSteps)}`);
    }
    this.byteCount = byteCount;
    this.maxSteps = maxSteps;
    this.offsetMap = options.offsetMap ?? null;
    this.rankIsResultId = options.rank === 'resultId';
    this.leadingZeroWidthPart = options.leadingZeroWidthPart ?? false;
    this.born = new Int32Array(byteCount + 1);
    this.died = new Int32Array(byteCount + 1).fill(ALIVE);
  }

  /** Steps stored so far. */
  get stepCount(): number {
    return this.length;
  }

  /** Marks the boundaries strictly inside `[from, to)` (original byte offsets) as never existing at step 0 (born NEVER). */
  neverBorn(from: number, to: number): void {
    if (to - from > 1) this.born.fill(NEVER, from + 1, to);
  }

  /** Sets one boundary explicitly (original byte offset). */
  setBoundary(b: number, born: number, died: number): void {
    this.born[b] = born;
    this.died[b] = died;
  }

  private map(offset: number): number {
    return this.offsetMap === null ? offset : (this.offsetMap[offset] ?? offset);
  }

  private grow(): void {
    const capacity = this.kind.length * 2;
    const grown = <T extends Uint8Array | Uint32Array | Int32Array | Float32Array>(src: T, dst: T): T => {
      dst.set(src);
      return dst;
    };
    this.kind = grown(this.kind, new Uint8Array(capacity));
    this.left = grown(this.left, new Uint32Array(capacity));
    this.mid = grown(this.mid, new Uint32Array(capacity));
    this.end = grown(this.end, new Uint32Array(capacity));
    this.rank = grown(this.rank, new Float32Array(capacity));
    this.resultId = grown(this.resultId, new Int32Array(capacity));
    this.chunk = grown(this.chunk, new Uint32Array(capacity));
  }

  /** `TraceRecorder.record` (04 §1.1); offsets are working-buffer offsets, mapped through `offsetMap` when one is set. */
  record(kind: 0 | 1, left: number, mid: number, end: number, rank: number, resultId: number, chunk: number): void {
    const l = this.map(left);
    const m = this.map(mid);
    const e = this.map(end);
    let stamp: number;
    if (this.length < this.maxSteps) {
      if (this.length === this.kind.length) this.grow();
      const i = this.length;
      this.kind[i] = kind;
      this.left[i] = l;
      this.mid[i] = kind === StepKind.Merge ? m : l;
      this.end[i] = e;
      this.rank[i] = this.rankIsResultId ? resultId : rank;
      this.resultId[i] = resultId;
      this.chunk[i] = chunk;
      stamp = ++this.length;
    } else {
      this.truncated = true;
      stamp = this.maxSteps;
    }
    if (kind === StepKind.Merge) this.died[m] = stamp;
    else for (let b = l + 1; b < e; b++) this.born[b] = stamp;
  }

  /** The finished timeline (arrays trimmed to `stepCount`). */
  finish(): MergeTimeline {
    const n = this.length;
    return {
      stepCount: n,
      leadingZeroWidthPart: this.leadingZeroWidthPart,
      boundaryBorn: this.born.slice(),
      boundaryDied: this.died.slice(),
      stepKind: this.kind.slice(0, n),
      stepLeft: this.left.slice(0, n),
      stepMid: this.mid.slice(0, n),
      stepEnd: this.end.slice(0, n),
      stepRank: this.rank.slice(0, n),
      stepResultId: this.resultId.slice(0, n),
      stepChunk: this.chunk.slice(0, n),
      truncated: this.truncated,
    };
  }
}
