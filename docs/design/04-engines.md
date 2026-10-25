# 04 — Engines (area D)

*Binding for WP01 (agenda loop, timeline recorder — AD-33), WP02 (Unicode tables, ByteVocab, patterns), WP05A (byte-level BPE), WP05B (SentencePiece BPE), WP07 (Worker), WP12 (fuzz). Both engines live in `@tsbs/core`, share `analyzeText`, the agenda loop, the timeline recorder and the result builder; neither touches the DOM; both run in the Worker (production) and in Node (tests). Research citations are to `docs/research/01-tokenizers-and-platform.md`. Performance numbers quoted here are the same values as the CI-asserted ceilings in 06 §3 (the single source).*

## 1. Shared agenda merge loop (`core/agenda`, owned by WP01) — AD-5

### 1.1 Interface

```ts
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
export function createMergeState(parts: PartList, prio: PairPriority, chunk: number, trace: TraceRecorder | null): MergeState;  // seeds the heap
/** Pops until the heap is empty or `budgetMs` has elapsed (performance.now() sampled every 256 pops). Returns state.done. */
export function mergeStep(state: MergeState, budgetMs: number): boolean;
/** = createMergeState + mergeStep(state, Infinity). Used by encode(), the conformance runner and the benches. */
export function mergeAll(parts: PartList, prio: PairPriority, chunk: number, trace: TraceRecorder | null): void;
```

### 1.2 Algorithm (pseudo-code)

```text
createMergeState(parts, prio, chunk, trace):
  heap ← empty binary min-heap of (priority: f64, l: i32, m: i32, r: i32)  // packed in Float64Array + Int32Array×3, lazy deletion
  for each adjacent live pair (a, b) with !frozen[a] && !frozen[b]:
      p ← prio.priority(start[a], start[b], end[b]); if p ≠ NO_MERGE: push(p, start[a], start[b], end[b])
mergeStep(state, budgetMs):
  t0 ← performance.now()
  while heap not empty:
      if (++state.pops & 255) = 0 and performance.now() − t0 ≥ budgetMs: return false      // time slice over; resume later
      (p, l, m, r) ← pop()
      a ← partAt(l); if a dead or start[a] ≠ l or end[a] ≠ m: continue        // stale
      b ← next[a];   if b = −1 or end[b] ≠ r: continue                           // stale
      if prio.priority(l, m, r) ≠ p: continue                                     // stale (neighbour changed; defensive)
      // merge: a absorbs b
      end[a] ← r; unlink(b); trace?.record(Merge, l, m, r, p, prio.mergedId(l, m, r), chunk)
      if prev[a] ≠ −1 and !frozen[prev[a]]: q ← prio.priority(start[prev[a]], l, r); if q ≠ NO_MERGE: push(q, start[prev[a]], l, r)
      if next[a] ≠ −1 and !frozen[next[a]]: q ← prio.priority(l, r, end[next[a]]); if q ≠ NO_MERGE: push(q, l, r, end[next[a]])
  state.done ← true; return true
```

Complexity: O(m log m) for m initial parts (≤ 2m pushes). Heap key comparison is `(priority, l)`; equal priorities with equal `l` cannot occur for two live candidates. Stale detection uses the stored `(l, m, r)` triple against the current list, so a re-pushed pair after a merge has the same `(priority, l)` as any stale twin and cannot be ordered differently — this is the equivalence argument with tiktoken's linear "minimum rank, leftmost wins" scan (`docs/adr/0003-agenda-equivalence.md`). It is also literally SentencePiece's `bpe_model.cc` agenda (`score desc, then leftmost`) and HF `Word::merge_all` (`(rank, pos)` heap).

Property test (fast-check, 10⁵ runs nightly / 1,000 per PR): random byte strings over a 2–4 symbol alphabet with random ranks; `mergeAll` must produce the same merge sequence as a literal port of tiktoken's quadratic `_byte_pair_merge`. Trace recording pushes 7 numbers per step into growable typed arrays; disabled with `trace: false`.

### 1.3 Cooperative yielding (AD-21)

A void `mergeAll` cannot yield inside a chunk, and for the primary audience the whole text **is** one chunk (a zh-TW/ja paragraph matches the `\p{Lo}+`-style alternative once), so the agenda is resumable: `encodeIncremental(text, opts, budgetMs = 4)` runs `mergeStep(state, budgetMs)` in a loop and `yield`s `{ bytesDone, bytesTotal }` after every `false` return **and** between chunks (engine A) / between the symbolize, merge and fallback phases (engine B). The Worker's cancel check happens exactly at those yields, so cancellation latency is ≤ one budget (≈ 4 ms Node, ≈ 16 ms on a slow phone) regardless of input shape; a 200,000-code-point on-demand run is a sequence of 4 ms slices, each of which also posts `progress` (phase `encode`), which the client's watchdog counts as liveness (§6). `encode()` (no yielding) is used by the conformance runner, benches and `fromFixtureCase` tests; both paths share `mergeStep`, so they produce identical results by construction (asserted on every fixture case).

### 1.4 Timeline recording (`core/timeline`)

The recorder writes `stepKind/stepLeft/stepMid/stepEnd/stepRank/stepResultId/stepChunk` and maintains `boundaryBorn/boundaryDied` over **original** byte offsets: a merge at `(l, m, r)` sets `boundaryDied[m] = stepIndex`; a byte-fallback split of part `[l, r)` sets `boundaryBorn[b] = stepIndex` for every `b` in `(l, r)`; boundaries inside a direct-hit chunk are born `NEVER` (`0x7fffffff`, 03 §B.2 — `born === NEVER ⇒ never live`, so the live test is `born !== NEVER && born <= k && (died === ALIVE || died > k)`); chunk edges and every boundary bordering or inside a `SpecialString` chunk are permanent (born 0, died `ALIVE`). Byte tokens produced by a split get `stepFormed = the split step`. Under `trace: { maxSteps }` the recorder stops writing step arrays at `maxSteps` but keeps updating born/died with the value `stepCount` (= `maxSteps`) so `replay(timeline, stepCount)` still equals the final tokens. For spm the recorder maps working-buffer offsets through `normToOrig` (§3.2) before writing. Grok-1's zero-width dummy prefix is a part `[0,0)`; when it merges with the following symbol (`▁` + `H…` → `▁H…`) the removed boundary is the virtual one at index 0 (`leadingZeroWidthPart = true`), and `stepLeft = stepMid = 0`. `replay(timeline, k)` returns the live boundaries after `k` steps in O(bytes); the view keeps a cursor so ±1 is O(1) amortised. `fixture-steps.ts` (tests only) converts a step to the fixture's `[position, rank]` via a Fenwick tree over alive boundaries.

## 2. Engine A — byte-level BPE with tiktoken semantics (`core/engines/bytelevel`)

### 2.1 Encode algorithm

```text
encode(text, opts):
  1. text' ← opts.normalize = 'NFKC' ? text.normalize('NFKC') : text          (only anthropic-claude-legacy declares nfkc support)
     analysis ← analyzeText(text')  → utf8, chars (cp, utf16Start, byteStart), graphemes (Intl.Segmenter | fallback), utf16→byte map
  2. segments ← opts.specialTokens = 'match' ? splitOnSpecials(text', specialsRegex) : [whole text']
       specialsRegex = alternation of escaped SPCL strings in SOURCE ORDER (leftmost-first, like Rust regex; tiktoken encode(allowed_special='all'))
       each special match → one chunk { kind: SpecialString } holding one token { kind: Special, flags: Special }; its boundaries are permanent (03 §B.2)
  3. for each ordinary segment: chunks ← pattern.matchAll(segment)  (flags 'gu'; UTF-16 index → byte offset through the running cursor)
       assert chunks tile the segment, else throw PretokenizeError { offset }   (patterns end in \s+ / [^…]+ alternatives, so every code point matches)
       rule[c] (trace on only): each alternative is ALSO compiled alone with flags 'uy'; set alt.lastIndex = chunkStartUtf16 on the FULL segment
         and take the first alternative that matches IN CONTEXT (leftmost-first semantics guarantee its match ends at the chunk end; assert, else 255).
         Never test the isolated chunk string: a lone ' ' before a letter is matched in context by the final \s+ (because \s+(?!\S) fails), while
         the isolated string ' ' would satisfy the earlier alternative.
  4. for each chunk [s, e):
       if e − s = 1 → token = single-byte rank; flags DirectHit; chunks.directHit[c] = 1                       (no steps)
       else if (e − s ≤ 256 and cache.has(hash(bytes))) → emit cached ids/steps (chunk-result cache, §2.5)
       else if (r ← vocab.indexOf(utf8, s, e)) ≥ 0 → one token, flags DirectHit, chunks.directHit[c] = 1, no steps   (ignore_merges semantics; fixture directHit)
       else parts ← one per byte; mergeAll(parts, RankPriority, c, trace) (encodeIncremental: createMergeState + mergeStep slices);
            tokens ← surviving parts; chunks.directHit[c] = 0 (also when zero merges happened, e.g. the 2-byte NEL chunk); cache.put when e − s ≤ 256
  5. flags per token: Partial (UTF-8 validation of the bytes), StartsMidChar/EndsMidChar (compare with chars.byteStart via byteToChar),
     charFirst/charLast (binary search / byteToChar), stepFormed (last step whose [left,end) equals the token span)
  6. opts.addBos && config.bosId ≠ null → prepend zero-width token { kind: Bos, flags: ZeroWidth|Special, id: bosId }
  7. build byteToChar / byteToToken / byteToChunk, chars.tokenFirst/tokenLast (non-zero-width tokens only, 03 §B.3), stats; return result
RankPriority.priority(l, m, r):  if r − l > meta.maxPieceBytes → NO_MERGE            (no hashing of hopeless slices on long whitespace/punctuation runs)
                                 idx ← vocab.indexOf(utf8, l, r); return idx ≥ 0 ? idx : NO_MERGE        // heap key = PCES index (rank)
RankPriority.mergedId(l, m, r) = idx + idOffset                                       // the TOKEN ID; the trace records stepRank = stepResultId = mergedId
```

The heap orders by PCES index (= tiktoken rank) but the timeline records the merged **token id** (`rank + idOffset`), which is what the fixtures call `rank` (Grok-2 `policy.notes`: "rank = token id", e.g. `zh-tw-tainan` step `[0, 1128]`; Claude ranks start at 5). `maxPieceBytes` comes from the asset META (o200k 128, Grok-2 256, Glimmer 113), never from the registry.

Complexity: O(n) pre-tokenize + Σ O(mᵢ log mᵢ). Targets (Node, = 06 §3): 10,000 CJK chars in one chunk ≤ 15 ms with trace; 20k-char single-chunk CJK ≤ 40 ms (prototype: 10,416 mixed chars in 9.8 ms). Byte-level ids: `id = rank + idOffset` (0 OpenAI/Meta; 128 Grok-2; 5 Claude). `tokenBytes(id)` = `vocab.bytesOf(id − idOffset)` or the SPCL entry. The inspector's text field decodes only complete-UTF-8 tokens; otherwise `null` → rendered `⟨E7 81⟩`. Keys are bytes, never decoded strings (BOM rule, §4.2).

### 2.2 Pre-tokenizer patterns: porting rules (Rust/Python `regex` → JavaScript `u` mode)

Templates live in `patterns.ts` with class placeholders; `expand.ts` substitutes the generated Unicode 16.0 classes at module load and compiles once per tokenizer (≈ 1–2 ms).

1. `\s` → `[{WS}]`, `\S` → `[^{WS}]` where `{WS}` = `White_Space` ranges. JS `\s` differs from Unicode `White_Space` on exactly U+0085 (NEL: White_Space, not JS `\s`) and U+FEFF (JS `\s`, not White_Space) (§3.1). The oracle's `regex` module defines `\s` as White_Space (0 differing code points, measured); tiktoken's Rust regex agrees (U+001C–1F are not whitespace for either). **The current corpus does not discriminate this**: measured with the oracle venv, substituting the JS `\s` set into all five patterns still reproduces the fixture `chunks` on 358/358 cases (in `nel` and `bom-prefix` the differing code point is captured by an earlier alternative or yields the same span under another rule), and no corpus case contains U+001C–1F, `ſ` or an uppercase contraction, so the `(?i:)` expansion and the U+001C rule have zero fixture coverage either. WP00's oracle lane therefore adds the core cases `ws-bom-mid` (`' using ﻿namespace'`, the research §3.1 string), `nel-after-space` (`'a\u0085 b'`), `nel-before-letter` (`'x \u0085y'`), `fs-control` (`'a\u001cb'`), `contraction-upper` (`"HE'S here"`), `contraction-long-s` (`"it'ſ"`), `contraction-dont-upper` (`"DON'T"`) and regenerates all fixtures; WP02's acceptance names them explicitly, and the hand-picked per-alternative unit tests (06 §1) remain the second line.
2. `\p{L} \p{N} \p{Lu} \p{Lt} \p{Lm} \p{Lo} \p{Ll} \p{M}` → explicit range classes from `tables.generated.ts` (AD-4). Never native `\p{…}` in production.
3. `(?i:'s|'t|'re|'ve|'m|'ll|'d)` → `'(?:[sSſ]|[tT]|[rR][eE]|[vV][eE]|[mM]|[lL][lL]|[dD])`; cl100k's `'(?i:[sdmt]|ll|ve|re)` → `'(?:[sSſdDmMtT]|[lL][lL]|[vV][eE]|[rR][eE])`. U+017F ſ is the only non-ASCII code point `(?i:s)` matches under `u` simple case folding (§4.2, verified by enumeration; K U+212A folds to k and never appears). The expander computes closures from the folding table; a unit test re-derives them. No inline modifiers anywhere (PD-5).
4. Possessive quantifiers (`?+ ++ *+`) in the **current** cl100k pattern → greedy. Equivalence holds because each possessive atom is followed only by `$`, the end of its alternative, or a class disjoint from the repeated class, so backtracking cannot produce a different match; `\s++$` ≡ `[{WS}]+$`. The fixture's `chunks` come from the current pattern; the three fuzz cases where the pre-0.8.0 pattern differs (`fuzz-031/062/086`, trailing whitespace) are the discriminating test.
5. Flags `gu`, never `v` (`[\r\n/]` has an unescaped `/`; Safari 16.4 lacks `v`). Iterate with `lastIndex`.

| Key | Used by | Template (before class substitution) |
|---|---|---|
| `o200k` | o200k_base; llama4-muse (byte-identical upstream, §3.4) | `[^\r\n{L}{N}]?[{Lu}{Lt}{Lm}{Lo}{M}]*[{Ll}{Lm}{Lo}{M}]+{CONTR}?\|[^\r\n{L}{N}]?[{Lu}{Lt}{Lm}{Lo}{M}]+[{Ll}{Lm}{Lo}{M}]*{CONTR}?\|[{N}]{1,3}\| ?[^{WS}{L}{N}]+[\r\n/]*\|[{WS}]*[\r\n]+\|[{WS}]+(?![^{WS}])\|[{WS}]+` |
| `cl100k` | cl100k_base (current, possessive upstream) | `'(?:[sSſdDmMtT]\|[lL][lL]\|[vV][eE]\|[rR][eE])\|[^\r\n{L}{N}]?[{L}]+\|[{N}]{1,3}\| ?[^{WS}{L}{N}]+[\r\n]*\|[{WS}]+$\|[{WS}]*[\r\n]\|[{WS}]+(?![^{WS}])\|[{WS}]` |
| `llama3` | llama3 (= pre-0.8.0 cl100k) | `{CONTR}\|[^\r\n{L}{N}]?[{L}]+\|[{N}]{1,3}\| ?[^{WS}{L}{N}]+[\r\n]*\|[{WS}]*[\r\n]+\|[{WS}]+(?![^{WS}])\|[{WS}]+` |
| `grok2-v1` | grok2 (SGLang `V1`, §3.5) | as `llama3` with `[{N}]` (single digit) |
| `claude-legacy` | claude-legacy (`claude.json` pat_str, case-sensitive) | `'s\|'t\|'re\|'ve\|'m\|'ll\|'d\| ?[{L}]+\| ?[{N}]+\| ?[^{WS}{L}{N}]+\|[{WS}]+(?![^{WS}])\|[{WS}]+` |

`{CONTR}` = `'(?:[sSſ]|[tT]|[rR][eE]|[vV][eE]|[mM]|[lL][lL]|[dD])`. Acceptance: the expanded `o200k` regex reproduces every `chunks` span of `fixtures/openai-o200k_base.json` (358/358; measured 0 mismatches, 1.4 ms compile, 38 k chars in 2.5 ms), and likewise for cl100k, llama3, llama4-muse, grok2, claude-legacy. The chunk test also runs **inside all three Playwright browsers** via a tiny harness page, not only in Node.

### 2.3 Unicode-version pinning (AD-4)

`tools/oracle/export_unicode_tables.py` → `tables.generated.ts` (Unicode 16.0; 694 ranges for `L`, 148 for `N`, 10 for `White_Space`; 40,395 source chars; 5.7 KB brotli) with a header recording `regex 2026.9.29`. `pnpm unicode:check` diffs a fresh export. `TokenizerInfo.unicodeVersion = '16.0.0'`; About shows it. A test-only flag `TSBS_NATIVE_UNICODE=1` substitutes native `\p{…}` and the parity suite reports divergences (expected only on code points assigned after 16.0 — Node 26/Chrome are Unicode 17; §9). Known divergence surfaced on About: "Pre-tokenization uses Unicode 16.0 character classes (as tiktoken 0.14.0 and the fixtures). Characters assigned in Unicode 17 (e.g. CJK Extension J) are treated as unassigned."

### 2.4 Special tokens

Tables come from the asset's `SPCL` section (AD-12). Default `'as-text'`: `<|endoftext|>` is text (fixture `ids`). `'match'`: step 2 above; matched ids badge `Special` in the UI. Fixtures carry `idsWithSpecials` where it differs (o200k/cl100k `special-endoftext`, Gemma 4 `special-bos`/`special-think`); for fixtures whose oracle has a specials mode, absence ⇒ both modes equal (03 §B.5 states the exact scoping; `user-defined-atomic` fixtures are handled differently). Coverage today is thin: the corpus contains none of `<|begin_of_text|>`, `<|eos|>`, `<|pad|>`, `<|separator|>`, `<EOT>`, `<SOS>`, `[BOS]`, `<end_of_turn>`, so the source-order `SPCL` tables of Llama 3/4, Grok-2, Claude, Grok-1 and Gemma 2 are not exercised by any golden case — WP00's oracle lane adds one case per shipped tokenizer with that tokenizer's own special strings (`special-llama-bot`, `special-llama4-eos`, `special-grok2-eot`, `special-grok1-bos`, `special-gemma2-end-of-turn`, `special-claude-eot`) and emits `idsWithSpecials` for Gemma 2 / Grok-1 through `spm_bpe_ref.py` extended with CONTROL/UNK pre-matching, labelled an emulation in `policy.notes`.

### 2.5 Chunk-result cache

`chunk-cache.ts`: LRU `Map<key, { ids: Uint32Array; steps: Int32Array /* (l, m, resultId) × n */ }>` bounded by **bytes, not entries**: total payload ≤ 2 MiB, and only chunks ≤ 256 bytes are cached (longer chunks are rare in Latin text and never repeat in CJK). Key = the latin1 string of the chunk bytes when `len ≤ 64`, else a 64-bit FNV-1a of the bytes as a string of two 32-bit halves (collision → recompute; a hit is verified by length). Re-tokenizing Latin text on a keystroke therefore costs only the edited chunks. **For CJK the cache is ineffective by nature**: a zh-TW/ja paragraph without spaces is one `\p{Lo}+`-class chunk, so every keystroke re-merges the whole paragraph and the 10k-CJK encode budget (≤ 15 ms Node / ≤ 60 ms phone, 06 §3) **is** the per-keystroke cost — which is why AD-27 virtualizes beyond 2,000 code points and pauses live tokenization beyond 20,000. WP12's perf spec asserts that 500 keystrokes into a 10k-CJK paragraph grow Worker memory by < 10 MB (`process.memoryUsage()` in the Node harness, `performance.measureUserAgentSpecificMemory` is not available without cross-origin isolation). Cleared on `dispose()`.

## 3. Engine B — SentencePiece BPE with byte fallback (`core/engines/spm`)

Mirrors `tools/oracle/oracles/spm_bpe_ref.py` and HF `BPE::merge_word`, with two literal priority providers and a by-construction byte map.

### 3.1 Configuration facts (data in the registry and asset META; tests assert they agree)

| | Grok-1 | Gemma 1/2 | Gemma 4 |
|---|---|---|---|
| Source / oracle | `.model` / sentencepiece 0.2.2 | `.model` / sentencepiece 0.2.2 | HF `tokenizer.json` / tokenizers 0.23.3 |
| priority | `score` | `score` | `merge-rank` (514,906 merges) |
| fallbackOrder | after-merge | after-merge | before-merge |
| addDummyPrefix | **true** (zero-width `▁` id 130089 when bare) | false | false |
| BYTE ids | 69–324 | 217–472 | 238–493 |
| USER_DEFINED | 65 pieces at 4–68 (digits 0–9, newline/tab/space runs, `<\|separator\|>` 47, `<\|mask\|>` 48, `<\|control1..20\|>`) | 245 (incl. `<start_of_turn>` 106, `<end_of_turn>` 107) | **none in TYPS** (HF has no USER_DEFINED; former Gemma 3 USER_DEFINED strings — `\n` 107, `\n\n` 108, `▁` runs 138–144, `\t` 255968 — are reached by ordinary merges and are `TokenKind.Normal`; the fixture's `type: USER_DEFINED` for them is Gemma 3 proto provenance and is compared only on the BYTE/CONTROL/UNK axis, 03 §B.5 / AD-31; 75 HTML-tag pieces are unreachable by merges and encode as text) |
| CONTROL / specials | `[PAD]`0 `[BOS]`1 `[EOS]`2 `[UNK]`3 | `<pad>`0 `<eos>`1 `<bos>`2 `<unk>`3 | 24 `added_tokens[special=true]` (`<pad>`0 `<eos>`1 `<bos>`2 `<unk>`3 …) |
| Tab | USER_DEFINED runs | BYTE 226 (`<0x09>`; HF JSON keys it as a literal tab) | NORMAL 255968 under HF (fixture `tab-only` labels it USER_DEFINED from the Gemma 3 proto; both the live engine and `fromFixtureCase` show a plain chip) |
| Fixture policy | `as-text` | `user-defined-atomic` | `as-text`; `idsWithSpecials` = `encode_special_tokens=False` |

### 3.2 Algorithm

```text
encode(text, opts):
  1. analysis ← analyzeText(text)                                   (orig byte space: utf8, chars, graphemes)
  2. normalize → working buffer `norm` (Uint8Array) + normToOrig (Uint32Array, norm.length+1, monotone):
       identity normalizer (asserted at build: precompiled_charsmap empty, remove_extra_whitespaces false);
       escapeWhitespace: each 0x20 → E2 96 81 (3 norm bytes map to the 1 orig byte: normToOrig = [o, o, o, o+1]);
       a literal U+2581 keeps its 3 bytes (maps 1:1);
       addDummyPrefix && text ≠ '': prepend E2 96 81 mapping to orig [0,0)  (zero-width symbol; fixture rule: skipped unconditionally)
  3. symbolize → PartList over `norm`:
       pre-match set P (frozen symbols), tried longest-first at each position (lengths descending, as spm_bpe_ref.py / SentencePiece PrefixMatcher):
         score provider:        USER_DEFINED pieces
         merge-rank provider:   added_tokens[special=false] (Gemma 4: none; path unit-tested with a synthetic vocabulary)
         + CONTROL pieces / special:true added tokens when opts.specialTokens = 'match' → frozen, kind Special
       else one part per code point of `norm`
       fallbackOrder = before-merge (HF): a code point whose bytes are not a piece (or are CONTROL/UNK) is replaced by one part per byte
         (kind Byte; these parts may merge if a merge exists — none do in Gemma, the loop handles it anyway)
  4. mergeAll(parts, provider, chunk 0, trace)   — one agenda over the whole text (SentencePiece: the whole text is one "word");
       encodeIncremental runs it as mergeStep slices (§1.3)
       both providers: if r − l > meta.maxPieceBytes → NO_MERGE before any hashing
       ScorePriority.priority(l,m,r):   idx ← vocab.indexOf(norm, l, r); admissible iff idx ≥ 0 and types[idx] ∈ {NORMAL, USER_DEFINED};
                                        UNUSED → NO_MERGE (SentencePiece resegments UNUSED pieces after merging; unsupported here, and the
                                        converter asserts META.unusedCount = 0 so the branch is unreachable on shipped models);
                                        priority = −score[idx]; ties → leftmost (SentencePiece comparator: score <, then left >); mergedId = idx
       MergeRankPriority.priority(l,m,r): idx ← vocab.indexOf(norm, l, r); if idx < 0 → NO_MERGE;
                                        rank ← csrLookup(merges, idx, splitByteOffset = m − l); NO_MERGE if absent (HF: a pair whose exact split
                                        is not in the merge list is not mergeable); ties → leftmost (HF (rank, pos) heap); mergedId = idx
  5. fallbackOrder = after-merge (SentencePiece): any live non-frozen part whose bytes are not a piece (or are CONTROL/UNK) → one Byte token per
       UTF-8 byte (id = byteFirstId + byte; value from the id, never from the <0xNN> string), recorded as StepKind.ByteFallbackSplit
       (the character visibly "shatters": Grok-1 灣 → <0xE7><0x81><0xA3>)
  6. align: token spans = (normToOrig[start], normToOrig[end]) per part; a part covering only dummy bytes is ZeroWidth at 0 (kind DummyPrefix);
       a part covering dummy + text starts at 0 (fused; inspector: "includes the dummy prefix (0 bytes)");
       assert the last span ends at utf8.length and spans are contiguous, else throw AlignmentError { tokenIndex, expected, actual }
  7. opts.addBos → zero-width Special token bosId at [0,0) first (never participates in merging)
  8. flags (Partial by validation; StartsMidChar/EndsMidChar from chars.byteStart), kind from TYPS, stepFormed, maps, stats
```

Why two providers and the exact table (AD-6): the HF merges list is not a pure function of a per-piece order — 87 non-contiguous merge blocks, 29 `(−score, id)` inversions, 2,102 pieces whose split halves overlap (whitespace runs up to 31) — and HF ranks splits of the same piece by `(rank)` while SentencePiece ranks by `(score, position)`. Measured: HF(Gemma 4) ≡ SentencePiece(Gemma 3) on 20,000 fuzz strings and all whitespace runs 1–63, but "never observed" is not "bit-exact"; the oracle for `google-gemma4` is HF, so the engine reproduces HF exactly. The build-time A2 check (regenerating the merge list from pieces with the HF `generate_merges` key reproduced all 514,906 merges today) is recorded as `META.hfMergesRegenerable` and shown on About as a property, not relied upon.

Complexity: O(n·U) pre-match (U = number of distinct USER_DEFINED byte lengths: ~10 Grok-1, ~30 Gemma 2, 0 Gemma 4) + O(n log n) merges. Target (Node, = 06 §3): ≤ 20 ms for 10k CJK chars on every spm tokenizer (prototypes measured Gemma 4 4.7 ms / Grok-1 20 ms with string keys; `ByteVocab` removes the string work).

### 3.3 Family-specific tests (encoded as named cases, all present in the fixtures)

- Gemma 2: `tab-only` → BYTE 226; `<start_of_turn>` atomic (USER_DEFINED) in default mode; `special-bos` (`<bos>`) is 3 tokens `[235322, 14084, 235313]` as text and `[2]` under `'match'` — the fixture carries no `idsWithSpecials` (sentencepiece has no specials mode), so the `'match'` value is asserted against the WP00 emulation (03 §B.5); no dummy prefix; `addBos` → `[2]` at `[0,0)`.
- Gemma 4: BYTE 238–493 (`𰻝` → `[478, 414, 425, 395]`); `special-bos`, `special-think` under `idsWithSpecials`; `literal-sp-space`, `three-spaces`, `tab-only`, `newline-pair` are `TokenKind.Normal` (AD-31); `<b>` encodes as text through merges (divergence from Gemma 3 SentencePiece surfaced on About).
- Grok-1: `zh-tw-tainan` → `[130089, 130876, 300, 198, 232, 130876, 130899]` with the first token `[0,0)` zero-width and `stats.splitChars = 1`; `leading-spaces` (`'   leading'`): first token `▁▁▁▁` id 336 covering `[0,3)` — the dummy fuses with the three escaped spaces, so it is **not** zero-width; the single-space case is `emoji-flag-tw-leading-space` / `literal-sp-space` whose first/second token is `▁▁` id 325; every digit is its own USER_DEFINED token; space-run pieces containing U+0020 can never match.
- All spm: literal U+2581 input; `piece` and `type` fields; both fallback orders produce identical ids on every fixture (asserted so a regression in either is caught).

## 4. Text analysis (`core/text`) shared by both engines and the main thread

`analyzeText(text): TextAnalysis { utf8, chars (cp, utf16Start, byteStart), graphemes, utf16ToByte }` — one pass with `codePointAt`; lone surrogates become U+FFFD exactly as `TextEncoder` does (the char table marks them so the inspector can say "unpaired surrogate"). Graphemes: `new Intl.Segmenter('und', { granularity: 'grapheme' })` (Baseline widely available 2026-10-16, §7.2); if absent, `graphemes.source = 'fallback'` with one cluster per code point (every array stays well-formed; `count = chars.count`) and the UI hides the brackets (PD-4). The main thread calls `analyzeText` directly for instant stops 1–3 and the live cp/grapheme/byte counts while a vocabulary loads (pure arithmetic, < 1 ms for 2,000 code points).

## 5. Errors (never silent)

| Error | Thrown when | Surfaced as |
|---|---|---|
| `PretokenizeError { offset }` | regex matches do not tile a segment | Worker `error.code = 'pretokenize'`, non-retryable; conformance fails |
| `AlignmentError { tokenIndex, expected, actual }` | spm spans do not consume `utf8` exactly | `error.code = 'alignment'` |
| `FormatError { section, offset, reason }` | TSBV1 reader | `error.code = 'format'` (asset rebuild needed) |
| `RangeError` during build | OOM on low-memory devices | `error.code = 'oom'`, retryable with a hint (AD-19) |

## 6. Worker protocol (`core/protocol.ts` — FROZEN v1; implemented in `@tsbs/worker`)

```ts
// packages/core/src/protocol.ts — FROZEN v1 (framework-free; @tsbs/worker depends only on @tsbs/core)
export interface Features { cacheApi: boolean; segmenter: boolean; brotli: boolean; subtleCrypto: boolean; }
export interface Progress { tokenizer: TokenizerId; phase: 'cache' | 'download' | 'verify' | 'decompress' | 'build' | 'encode'; loaded: number; total: number | null; }
export interface LoadedInfo { info: TokenizerInfo; fromCache: boolean; ms: number; bytesTransferred: number; contentEncoding: string | null; layer: 'gzip' | 'raw'; }
export interface LookupEntry { id: number | null; bytes: Uint8Array | null; piece: string | null; }
export type AssetSummary = Readonly<Record<TokenizerId, { path: string; bytesCompressed: number; bytesRaw: number }>>;   // for the picker's wire-size column
export type ErrorCode = 'fetch' | 'integrity' | 'format' | 'decompress' | 'quota' | 'not-loaded' | 'pretokenize' | 'alignment' | 'oom' | 'internal';

export type ToWorker =
  | { type: 'hello'; reqId: number }
  | { type: 'load'; reqId: number; tokenizer: TokenizerId }
  | { type: 'prefetch'; reqId: number; tokenizer: TokenizerId }                       // download + cache only; no-op if that id is loading/resident
  | { type: 'unload'; reqId: number }                                                 // drops the resident engine (strict one-resident)
  | { type: 'encode'; reqId: number; seq: number; text: string; options: EncodeOptions; budgetMs?: number }
  | { type: 'cancel'; reqId: number; target: number }                                 // target = reqId of the encode to cancel (in flight OR pending)
  | { type: 'lookup'; reqId: number; ids?: number[]; bytes?: Uint8Array }             // inspector + BYOK live tier
  | { type: 'ping'; reqId: number };

export type FromWorker =
  | { type: 'ready'; reqId: number; features: Features; assets: AssetSummary }        // assets from the bundled manifest, so the main bundle needs no copy
  | { type: 'progress'; reqId: number; progress: Progress }                           // during load AND during encode (every mergeStep slice, §1.3)
  | { type: 'loaded'; reqId: number; loaded: LoadedInfo }
  | { type: 'result'; reqId: number; seq: number; result: TokenizationResult }         // all typed arrays in the transfer list
  | { type: 'cancelled'; reqId: number }                                               // the ONE name for a superseded/cancelled encode, on the wire and in the client
  | { type: 'lookupResult'; reqId: number; entries: LookupEntry[] }
  | { type: 'unloaded'; reqId: number }
  | { type: 'pong'; reqId: number; resident: TokenizerId | null; loading: TokenizerId | null; encodeInFlight: boolean; heapHint: number | null }
  | { type: 'error'; reqId: number; code: ErrorCode; message: string; retryable: boolean };
```

Rules (all FROZEN):
1. `reqId` strictly increasing per client. The Worker runs **one** encode at a time and keeps **one** pending; a newer `encode` replaces the pending one, which settles as `cancelled`; results whose `seq < latestSeq` are dropped by the client.
2. `cancel.target` names the encode to cancel; if it is pending it is dropped, if it is in flight it stops at the next `mergeStep` yield (≤ one budget), either way exactly one `cancelled` is posted for that reqId. A cancel for an unknown/finished reqId is ignored.
3. An `encode` that arrives while a `load` (or `unload` → `load` pair) is in flight is **queued** as the pending encode and runs after `loaded` (older pending encodes settle as `cancelled`); `not-loaded` is answered only when no engine is resident **and** no load is in flight.
4. A `load` while another `load` is in flight cancels the older (its `loaded` never arrives; the client resolves the newer). `unload` precedes `load` when switching (AD-19). `prefetch` of the id currently loading or resident is a no-op (`unloaded`-style ack: an empty `progress` with phase `cache`).
5. Engine families are loaded with `await import('./engines/bytelevel.js' | './engines/spm.js')` on first use (`worker.format: 'es'`, 02 §5).
6. **Liveness and the watchdog.** Any message from the Worker (`progress` included) counts as liveness. The client pings every 10 s only while a request is outstanding and **no** encode slice has posted `progress` in the last 10 s; two consecutive missed pongs (20 s) → `terminate()`, respawn, replay `load` of the last requested tokenizer, reject every outstanding encode with `cancelled`. Respawn-after-crash (`error` event) is attempted **once per tokenizer**; a second crash while loading the same tokenizer surfaces `error.code = 'oom'` with the AD-19 back action instead of looping.
7. `heapHint` is `null` in browsers (`performance.memory` is Window-only/Chrome-only and `measureUserAgentSpecificMemory` needs cross-origin isolation, which this site does not have); it is populated only in the Node bench harness from `process.memoryUsage().arrayBuffers`.
8. No `SharedArrayBuffer`, so no COOP/COEP requirements.

```ts
// @tsbs/worker/client.ts (main thread) — framework-free; apps/web wraps `onResident` in a rune
export interface TokenizerClientLike {
  readonly features: Promise<Features>;
  readonly assets: Promise<AssetSummary>;
  readonly resident: TokenizerId | null;                      // plain getter
  onResident(cb: (id: TokenizerId | null) => void): () => void;   // returns unsubscribe
  load(id: TokenizerId, onProgress?: (p: Progress) => void, signal?: AbortSignal): Promise<LoadedInfo>;
  prefetch(id: TokenizerId): Promise<void>;
  encode(text: string, options: EncodeOptions, onProgress?: (p: Progress) => void, signal?: AbortSignal): Promise<TokenizationResult>;   // latest text wins; rejects CancelledError ('cancelled')
  lookup(q: { ids?: number[]; bytes?: Uint8Array }): Promise<LookupEntry[]>;
  unload(): Promise<void>;
  terminate(): void;
}
export class TokenizerClient implements TokenizerClientLike { /* real Worker, constructed from the Vite worker import `import TokWorker from '@tsbs/worker/entry?worker'` (02 §5; never a bare specifier inside new URL()) */ }
export class MockTokenizerClient implements TokenizerClientLike { /* returns precomputed fixture results via fromFixtureCase; used by WP06/WP08 before WP07 lands */ }
```

## 7. How fixtures drive the tests (`@tsbs/conformance`, used by engine tests and `vocab:build`)

`runFixture(fixture: Fixture, tokenizer: Tokenizer): ConformanceReport` — for every case in `cases` (and `normalizedNFKC` with `normalize: 'NFKC'`):

| Fixture field | Assertion |
|---|---|
| `ids` | equal with default options |
| `idsWithSpecials` | equal with `specialTokens: 'match'`; when absent: for specials-mode oracles (tiktoken family, gemma4) `'match'` output must equal `'as-text'` output; for `user-defined-atomic` fixtures (gemma2, grok1) equality is required only on cases whose text contains no CONTROL/UNK piece string, and cases that do are checked against the WP00 emulation (03 §B.5) |
| `tokens[].{bytes,start,end,partial,zeroWidth}` (+ `piece`, `type` for spm) | equal per token; `type` → `TokenKind` mapping exact for gemma2/grok1; for gemma4 compared on the BYTE/CONTROL/UNK/other axis only (AD-31), and `tab-only`/`newline-pair`/`three-spaces` must be `Normal` |
| `utf8Len` | `utf8.length` |
| `chunks` | `ChunkTable` byte spans (Regex kind) equal |
| `merges[].{chunk, directHit, steps}` | `directHit` equal; fixture `[position, rank]` replayed on one-part-per-byte → `(left, mid)` offsets must equal `stepLeft/stepMid` in order, and the fixture `rank` must equal `stepResultId` (= `stepRank`; the fixture's "rank" is the token id, so Grok-2/Claude pass only with the `idOffset` applied) |
| `stats` | `splitChars` equals the number of chars with `tokenLast > tokenFirst` computed over non-zero-width tokens (Grok-1 `zh-tw-tainan` = 1) |
| invariants | B.3 invariants on every case; `encode()` ≡ `encodeIncremental()` result |

Suites:
- **Conformance** (every PR): all 9 shipping fixtures × every case (358 today; 358 + the WP00 additions once regenerated — every "358" in this design means "all cases of the committed fixtures"), against (a) tables built from raw files by the dev loaders when `data/vocab/raw` exists, (b) the built `.bin`. ≈ 3,200 assertions, ≈ 2–5 s. Raw vocab comes from the CI cache keyed by the manifest's sha256 list.
- **Research anchors**: the §5.3 table duplicated as literal unit tests so a regression is readable in isolation (e.g. o200k 台灣台南 → `[3735, 133072, 3735, 14609]`; Grok-2 token 4242 case and its `zh-tw-tainan` first step `[0, 1128]` (stepResultId 1128 = PCES index 1000 + idOffset 128); Claude 20094; cl100k 灣 split at step 7 of 7 → 66285).
- **Property** (fast-check; 1,000 runs per PR, 20,000 nightly): random Unicode strings weighted to CJK/emoji/whitespace/controls/unpaired surrogates → B.3 invariants for every tokenizer; agenda ≡ quadratic reference; varint/TSBV1 round trips; alignment on random piece sequences; `packRows` properties; both spm fallback orders agree.
- **Browser parity** (every PR, Playwright): `compilePattern` chunk test on fixture texts in chromium/firefox/webkit; `DecompressionStream` + `readTsbv1` of the o200k `.bin` in webkit.
- **Fuzz vs npm oracles** (`pnpm test:fuzz`, Node only, nightly 10,000 strings/tokenizer, 2,000 with a fixed seed on engine-path changes; failures saved to `fixtures/candidates/*.json` for the oracle lane):

| Our tokenizer | Oracle(s) | Notes |
|---|---|---|
| o200k, cl100k | `tiktoken@1.0.22` WASM (`encode` with `disallowedSpecial = new Set()`), `gpt-tokenizer@4.1.0` second opinion | ids; token bytes via `decode_single_token_bytes` |
| Llama 4/Muse, Llama 3, Grok-2 | `@huggingface/tokenizers@0.2.0` on Glimmer / Xenova-llama3 / alvarobartt-grok-2 JSON (`add_special_tokens:false`) | ids |
| Gemma 4 | `@huggingface/tokenizers@0.2.0` on Gemma 4 JSON (primary) **and** `@sctg/sentencepiece-js@1.3.3` on the Gemma 3 `.spiece.model` (secondary; a disagreement between oracles is logged as `oracle-divergence`, not our failure) | ids |
| Grok-1, Gemma 2 | `@sctg/sentencepiece-js@1.3.3` on the `.model` | ids |
| Claude legacy | `tiktoken@1.0.22` with `claude.json` ranks/specials/pat_str (raw, no NFKC) | ids |

Fuzz alphabet: the corpus alphabet (`tools/oracle/make_corpus.py --export-alphabet` → `tools/oracle/alphabet.json`, WP00) + U+001C–1F, U+0085, U+FEFF, U+2028/9, U+3000, ZWJ, VS16, U+2581, surrogate pairs, mixed-case contractions with `ſ`, and a **repeated-unit generator** (`\n`, space, `\t`, `-`, `=`, `.`, `!`, `─`, 1–64 repeats mixed with letters) targeting the HF-vs-SentencePiece tie-break class. Oracle gotchas encoded (§4.2): `TextDecoder` BOM stripping, specials throwing, `!`-format for js-tiktoken, `tiktoken/lite` vs `tiktoken/lite/init` exclusivity.

## 8. Known divergences and how they are surfaced

| Divergence | Where surfaced |
|---|---|
| Unicode 16.0 classes vs the browser's newer Unicode | About › Engine: "pre-tokenizer Unicode 16.0; your browser reports ≈ Unicode N" (probe U+2FFC 15.1, U+1CC00 16.0, U+1E6C0 17.0); `TSBS_NATIVE_UNICODE=1` parity report in CI logs |
| Gemma 4 (HF JSON) vs Gemma 3 (`.spiece.model`) on literal special strings and the 75 HTML-tag former-USER_DEFINED pieces | Tokenizer `fidelityNote`: "Gemma 4 tokenizer.json semantics (HF tokenizers); identical to Gemini's SentencePiece on all fixture text except literal special-token strings"; `crossCheck.disagreements` from the fixture listed on About |
| `<bos>`/`<eos>`/`<pad>`/`<unk>` literals: HF one token vs SentencePiece three | Default `as-text` everywhere (PD-3); the `specialTokens` toggle badge says "as HF/API would with specials enabled" |
| cl100k current vs pre-0.8.0 pattern | ships current (fixture); note in About › Engine |
| Legacy Claude NFKC | opt-in toggle; normalized-text row; fidelity `legacy`. `String.prototype.normalize` uses the browser's Unicode tables while the fixtures used Python `unicodedata` (Unicode 15.1); About › Engine states it and the parity run (`TSBS_NATIVE_UNICODE=1`) reports any case where the two differ |
| Gemma 4 fixture `type` (Gemma 3 proto) vs HF semantics | `USER_DEFINED` labels on `\n`, `\t`, `▁` runs are provenance only; the engine and the chips show `Normal` (AD-31); About › Engine: "Gemma 4 piece types follow tokenizer.json; the Gemma 3 model file marks some whitespace pieces USER_DEFINED" |
| Inferred model mappings | `inferred` badge + dated evidence; xAI live tier lets users settle Grok 4.x on their own text |
