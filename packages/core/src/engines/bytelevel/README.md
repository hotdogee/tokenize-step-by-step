# Engine A — byte-level BPE with tiktoken semantics (WP05A)

`createByteLevelTokenizer(tsbv, entry)` (`index.ts`, exported from `@tsbs/core`) turns a decoded `bytelevel-bpe` TSBV1
asset into the FROZEN `Tokenizer` of 03 §B.6 for o200k, cl100k, Llama 3, Llama 4 / Muse, Grok-2 and legacy Claude. The
design is 04 §2; this file records how the code maps onto it and what was measured.

| File             | Role                                                                                                                                                                                                                                                                         |
| ---------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `config.ts`      | `ByteLevelEntryLike` (PA-8, structural, string-typed so a registry `TokenizerEntry`, a generated `engine-config.json` entry and raw JSON all satisfy it), its run-time validation against `META`, `EncodeOptions` resolution (`DEFAULT_OPTIONS` ← entry `defaults` ← caller) |
| `specials.ts`    | `SPCL` alternation in source order (leftmost-first) for `specialTokens: 'match'`                                                                                                                                                                                             |
| `pretokenize.ts` | pattern matches must tile each segment (`PretokenizeError { offset }` otherwise); in-context rule per chunk via `ruleAt` when traced                                                                                                                                         |
| `priority.ts`    | `RankPriority`: heap key = PCES index, `NO_MERGE` above `META.maxPieceBytes` before hashing, `mergedId` = index + `idOffset` (memoised from the stale check)                                                                                                                 |
| `chunk-cache.ts` | LRU bounded by bytes (≤ 2 MiB, chunks ≤ 256 B), latin1 keys ≤ 64 B, two FNV-1a lanes + byte verification above                                                                                                                                                               |
| `engine.ts`      | `ByteLevelTokenizer`: one generator behind `encode` and `encodeIncremental`                                                                                                                                                                                                  |

## Semantics worth knowing

- **Ids.** `id = rank + idOffset` (0 OpenAI/Meta, 128 Grok-2, 5 Claude); the timeline stores the id as both `stepRank` and
  `stepResultId` (`TimelineRecorder` with `rank: 'resultId'`), which is the fixtures' "rank".
- **Direct hits.** A 1-byte chunk, or a chunk whose bytes are one PCES entry, is one token with `TokenFlag.DirectHit`,
  `chunks.directHit = 1`, no steps and inner boundaries born `NEVER`. A multi-byte chunk with no merge (o200k `nel`) has
  `directHit = 0` and zero steps.
- **Specials.** Only under `'match'`; each match is a `SpecialString` chunk with one `Special` token, and the text between
  matches is pre-tokenized on its own (as tiktoken does), so `$` and lookaheads see the slice end.
- **BOS.** `addBos` prepends a zero-width `Bos` token only when the entry has a `bosId` (Llama 3 128000, Llama 4 200000);
  `buildResult` keeps zero-width tokens out of `chars.tokenFirst/tokenLast` and `stats.splitChars`.
- **NFKC.** `normalize: 'NFKC'` runs `nfkcWithSourceMap` (segments cut before ccc = 0 ∧ NFKC_QC = Yes), so
  `chars.sourceRunStart/End` map every code point of `result.text` back to its input run; spans index `result.utf8`.
  `info.supports.nfkc` follows the registry toggle (legacy Claude only); the engine applies NFKC whenever asked.
- **Yielding.** `encodeIncremental(text, options, budgetMs = 4)` yields `{ bytesDone, bytesTotal }` after the analysis,
  after pre-tokenization, after every unfinished `mergeStep` slice, between chunks once the slice is used up (sampled every
  16 chunks) and before the result is built. `encode` never yields. Both run the same code, so results are identical.
  `timings.encodeMs` excludes time spent suspended. The non-merge phases (`analyzeText`, `buildResult`, WP01) are not
  resumable; they cost ≈ 3.4 ms and 2.8 ms on 20k CJK chars, below one slice.
- **Errors.** `PretokenizeError` (`name`, `code = 'pretokenize'`, byte `offset`), `TypeError` from the factory when the
  entry does not match the asset, `Error` after `dispose()`.
- **Seams.** The optional third factory argument (`ByteLevelEngineOptions`) takes `unicodeMode: 'native'` (the parity run
  below), a substitute `pattern` (the `PretokenizeError` tests) and `cacheBytes`. Production passes none.

## Tests (`packages/core/test/engines/bytelevel/`)

They read the BUILT assets (`data/vocab/dist/vocab-manifest.generated.json` → gunzip → `readTsbv1`) and skip with a
message when the manifest is absent. `conformance.test.ts` runs `@tsbs/conformance`'s `runFixture` on every case of the
six fixtures (374 each, plus the 152 `normalizedNFKC` cases of Claude); `engine.test.ts` holds the research anchors and
behaviour tests; `incremental.test.ts` the `encode ≡ encodeIncremental` sweep, 20k-CJK slicing, cancel latency and the
`TSBS_PERF=1` ceilings; `parts.test.ts` the cache, `PretokenizeError`, specials order and `RankPriority`;
`native-parity.test.ts` the `TSBS_NATIVE_UNICODE=1` report.

## Measured (2026-10-25, Windows 11, Node 26.12.1)

`TSBS_PERF=1 pnpm vitest run --project core test/engines/bytelevel/incremental.test.ts` (median of 21 warm runs inside
Vitest; ceilings 15 ms / 40 ms, 06 §3):

| Tokenizer               | 10k single-chunk CJK | 20k single-chunk CJK |
| ----------------------- | -------------------- | -------------------- |
| openai-o200k_base       | 9.35 ms              | 17.84 ms             |
| openai-cl100k_base      | 8.18 ms              | 15.92 ms             |
| meta-llama3             | 8.87 ms              | 17.93 ms             |
| meta-llama4-muse        | 9.48 ms              | 22.44 ms             |
| xai-grok2               | 9.93 ms              | 24.14 ms             |
| anthropic-claude-legacy | 9.44 ms              | 21.09 ms             |

Plain Node (no Vitest module runner, 200 warm runs): o200k 10k CJK median 7.0 ms. Medians move by up to ×2 when the
machine is loaded, which is why the ceilings are opt-in. 20k CJK with the default 4 ms budget: 6 yields; measured merge
slices 4.05–4.08 ms, so a cancel is observed within one slice.

## `TSBS_NATIVE_UNICODE=1` parity report

`TSBS_NATIVE_UNICODE=1 pnpm vitest run --project core test/engines/bytelevel/native-parity.test.ts` builds each engine
with the runtime's native `\p{…}` classes and runs `runFixture`. On Node 26.12.1 (ICU 78.3, Unicode 17.0): **0 divergent
cases** for all six fixtures (374 / 374, Claude 526 / 526 with NFKC), and `String.prototype.normalize('NFKC')` equals the
fixtures' Python `unicodedata` 15.1 form on **152 / 152** cases. The expected divergence outside the corpus is reported
too: `x\u{323B0}y` (CJK Extension J, Unicode 17) chunks as `[0,1) [1,6)` with the pinned 16.0 classes (the ideograph is
unassigned there) and as one chunk `[0,6)` with native classes — the About-page divergence of 04 §8.
