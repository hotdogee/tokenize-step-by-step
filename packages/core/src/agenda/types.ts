// FROZEN v1 — see docs/design/04-engines.md §1.1 (verbatim; the three function declarations are expressed as function types
// because their implementations belong to WP01, AD-33). A change needs an ADR in docs/adr/ and one PR that updates every
// dependent (docs/design/07-implementation-plan.md §1). Excluded from Prettier on purpose.
export const NO_MERGE = Infinity;
export interface PairPriority {
  /** Priority of merging parts [l,m) and [m,r) (byte offsets into the engine's working buffer). Lower wins; ties → smaller l. NO_MERGE = not mergeable. */
  priority(l: number, m: number, r: number): number;
  /** Id of the merged part (valid only when priority !== NO_MERGE). */
  mergedId(l: number, m: number, r: number): number;
}
export interface PartList {            // doubly linked list over Int32Arrays, indexed by part slot
  readonly start: Int32Array; readonly end: Int32Array; readonly next: Int32Array; readonly prev: Int32Array;
  readonly frozen: Uint8Array;         // spm: 1 = never merges (USER_DEFINED / special pre-match)
  head: number; count: number;
}
export interface TraceRecorder { record(kind: 0 | 1, left: number, mid: number, end: number, rank: number, resultId: number, chunk: number): void; }
/** Resumable agenda (AD-21): the heap and part list live in the state object so a long single-chunk text can be merged in time slices. */
export interface MergeState { readonly parts: PartList; readonly prio: PairPriority; readonly chunk: number; pops: number; done: boolean; }
/** Signature of `createMergeState`. */
export type CreateMergeState = (parts: PartList, prio: PairPriority, chunk: number, trace: TraceRecorder | null) => MergeState;  // seeds the heap
/** Pops until the heap is empty or `budgetMs` has elapsed (performance.now() sampled every 256 pops). Returns state.done. */
export type MergeStep = (state: MergeState, budgetMs: number) => boolean;
/** = createMergeState + mergeStep(state, Infinity). Used by encode(), the conformance runner and the benches. */
export type MergeAll = (parts: PartList, prio: PairPriority, chunk: number, trace: TraceRecorder | null) => void;
