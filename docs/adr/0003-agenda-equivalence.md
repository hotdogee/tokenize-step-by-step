# ADR 0003 — One agenda merge loop is equivalent to tiktoken's "lowest rank, leftmost" scan

- **Status:** Accepted (2026-10-25). Stub written by WP00; argument completed by WP01 together with the fast-check
  property test that compares `mergeAll` with a literal port of tiktoken's quadratic `_byte_pair_merge`
  (`packages/core/test/agenda.test.ts`, reference port in `packages/core/test/helpers/reference-bpe.ts`).
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

## Equivalence argument

Notation: a state is the list of live parts `p_0 … p_{n−1}` (contiguous byte spans) plus, for the heap loop, the heap.
For a pair `(p_i, p_{i+1})` write `key_i = (prio(p_i ∪ p_{i+1}), start(p_i))`; `prio` is a pure function of the
`(l, m, r)` offsets (for byte-level BPE: the rank of the merged bytes, `NO_MERGE` when they are not a vocabulary entry).
tiktoken's loop picks the pair with the smallest rank and, among equal ranks, the smallest index — i.e. the minimum
`key_i` over all live pairs, because start offsets increase with the index. It stops when every rank is `Rank::MAX`.

**Invariant H.** Before every pop, for every live adjacent pair of non-frozen parts with `prio < NO_MERGE`, the heap
contains an entry `(prio, l, m, r)` with exactly that pair's offsets.

- _Initially:_ `createMergeState` pushes every such pair.
- _After a merge of `a = [l, m)` with `b = [m, r)`:_ the only pairs that change are `(prev(a), a)` and `(a, next(a))`
  (all others keep both parts and therefore their offsets and priority); both are pushed with their new offsets. This
  is exactly tiktoken's `get_rank(i − 1)` / `get_rank(i)` refresh.

**Validity test.** An entry `(p, l, m, r)` is _valid_ iff a live part starts at `l` and ends at `m`, its successor ends at
`r` (so the pair is `[l, m) + [m, r)`), and `prio(l, m, r) = p`. A live pair has exactly one offset triple, and `prio` is a
function of the triple, so a valid entry describes a current pair with its current priority; an invalid entry describes
no current pair and is discarded without effect (lazy invalidation).

**Step equivalence.** Suppose both algorithms are in the same part list. Let `P*` be the live pair with minimal key
`(p*, l*)`. By H the heap holds a valid entry for `P*`. Every entry popped before it has key `≤ (p*, l*)`:

- an invalid entry is skipped without changing the state;
- a valid entry with key `< (p*, l*)` would describe a live pair with a smaller key than the minimum — impossible;
- a valid entry with key `= (p*, l*)` describes a live pair whose left part starts at `l*`; only one live part starts at
  `l*`, so that pair is `P*` itself.

Hence the first valid pop is `P*`, the pair tiktoken merges. Merging it produces the same list in both algorithms, and H
is re-established. By induction the two produce the same merge sequence and the same final parts, and both stop when no
live pair has `prio < NO_MERGE` (tiktoken: every rank is `Rank::MAX`; heap loop: every remaining entry is invalid).

**Ties and stale twins.** Equal priorities on different pairs (the same byte string twice) are ordered by `l`, matching
tiktoken's strict `<` scan. A re-pushed pair can share `(priority, l)` with a stale entry for an older pair at the same
`l`; since at most one of them is valid, their relative heap order cannot change which pair merges.

**Frozen parts** (spm USER_DEFINED and matched specials) are never pushed and never re-pushed, so they never merge; this
is the SentencePiece prefix-matcher behaviour and has no tiktoken counterpart.

**Time slices.** `mergeStep(state, budgetMs)` only decides _when_ to stop popping (it checks the clock every 256 pops,
before a pop); all state lives in the heap and the part list, so any sequence of slices performs the same pops in the
same order as one `mergeStep(state, Infinity)` (`mergeStep slices ≡ mergeAll`, property-tested with a zero budget).

The same argument covers SentencePiece's `bpe_model.cc` agenda (`score` descending, then leftmost: `prio = −score`) and HF
`Word::merge_all` (`(rank, pos)` heap: `prio = merge rank`), which differ from tiktoken only in the priority function.

## Consequences

- O(m log m) merging; one set of invariants for both engines; both engines consume the loop frozen in wave 2.
- The property test (1,000 runs per PR, 10⁵ nightly) is the executable form of this ADR.
