# ADR 0003 — One agenda merge loop is equivalent to tiktoken's "lowest rank, leftmost" scan

- **Status:** Accepted (2026-10-25). Stub written by WP00; WP01 completes the argument together with the fast-check
  property test that compares `mergeAll` with a literal port of tiktoken's quadratic `_byte_pair_merge`.
- **Contract (FROZEN v1):** `packages/core/src/agenda/types.ts` (`docs/design/04-engines.md` §1.1).

## Context

Both engine families reduce to repeatedly merging the adjacent pair with the best priority. tiktoken scans the whole part
list for the lowest rank (leftmost on ties) after every merge, which is O(m²) — 10⁸–10⁹ operations for a 10,000-ideograph
paragraph, which is a single pre-tokenizer chunk. SentencePiece (`bpe_model.cc`) and HF (`Word::merge_all`) use a heap.

## Decision

- One shared loop for both engines: a doubly linked part list plus a binary min-heap keyed `(priority, leftOffset)` with
  lazy invalidation; a popped entry is stale unless its stored `(l, m, r)` triple still matches two adjacent live parts
  and its priority is unchanged (04 §1.2, AD-5).
- Three priority providers: `RankPriority` (byte-level), `ScorePriority` (SentencePiece scores) and `MergeRankPriority`
  (Gemma 4 HF merge ranks) (AD-6).
- The loop is resumable (`MergeState` + `mergeStep(state, budgetMs)`) so the Worker can observe cancellation inside one
  chunk (AD-21), and it has a single owner, WP01 (AD-33).

## Equivalence argument (outline; WP01 completes it)

1. Every candidate pair the linear scan would consider is in the heap with its current priority (seeded at start;
   re-pushed for both new neighbours after each merge).
2. Entries invalidated by a merge fail the `(l, m, r)` check and are skipped, so the first valid pop is the minimum
   `(priority, l)` over live adjacent pairs — exactly tiktoken's choice (lowest rank, leftmost on ties).
3. Two live candidates cannot share `(priority, l)`, so heap order is total on live entries; a re-pushed pair equals any
   stale twin on `(priority, l)` and therefore cannot be ordered differently.

## Consequences

- O(m log m) merging; one set of invariants for both engines; both engines consume the loop frozen in wave 2.
- The property test (1,000 runs per PR, 10⁵ nightly) is the executable form of this ADR.
