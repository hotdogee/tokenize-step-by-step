# Performance log

Dated measurements against the budgets of `docs/design/06-quality-ci-deploy.md` §3 (the single source, AD-39). Each
entry says where it was measured. The Node ceilings are the phone budgets ÷ 4 (06 §3 "×4 margin"); they live in code in
`packages/core/test/helpers/ceilings.ts`.

How to reproduce (docs/dev.md § Fuzz and performance):

```sh
pnpm test:fuzz                                          # fuzz vs oracles, fixed seed
TSBS_PERF=1 NODE_OPTIONS=--expose-gc pnpm test:perf     # opt-in Node ceilings + memory, serial
TSBS_PERF=1 pnpm bench                                  # vitest bench + check-bench.ts, serial
pnpm build && pnpm e2e:perf                             # Playwright perf spec on vite preview
```

The nightly workflow (`nightly-fuzz.yml`) repeats all of it on a GitHub runner. It uploads `perf-trend-<seed>`, which
holds `perf-results.json` and `bench.json`. That artifact is the trend. Runner timings are recorded, not asserted (soft),
because shared runners are slower than the quiet machine the Node ceilings assume.

---

## 2026-10-25 — WP12 baseline (development machine)

**Where:** AMD Ryzen 9 7950X (16 cores), Windows 11 Pro for Workstations, Node 26.12.1, Playwright 1.64.1 (chromium 156.0.8078.4),
`vite preview` of the production bundle at commit `wp/12-fuzz-perf` (main after wave 2 plus WP12). This is a **shared**
machine: other agents' worktrees were building and testing at the same time. The numbers below are from runs while the
machine was quiet. Two runs under contention (other processes at 45–70 % CPU) are listed at the end, to show why timing
runs must be serial and quiet.

### Fuzz vs oracles (`pnpm test:fuzz`, PA-9)

Fixed seed 20261025, 2,000 strings per tokenizer. Our engines decode the built `.bin` with `readTsbv1`. They are compared
with `tools/oracle/fuzz_oracle.py` on ids **and** byte spans:

```text
test:fuzz summary — seed 20261025, 2000 strings × 9 tokenizer(s), 9.9 s
tokenizer                 strings  ids≠ spans≠ errors  second opinions (compared / divergences by class)
openai-o200k_base            2000     0      0      0  gpt-tokenizer 4.1.0: 2000 / 0
openai-cl100k_base           2000     0      0      0  gpt-tokenizer 4.1.0: 2000 / 0
meta-llama3                  2000     0      0      0  tokenizers 0.23.3 (Xenova/llama3-tokenizer): 2000 / 0
meta-llama4-muse             2000     0      0      0  @huggingface/tokenizers 0.2.0 (Muse Glimmer tokenizer.json): 2000 / unicode-version 1, case-fold 1
xai-grok2                    2000     0      0      0  oracles.bpe_reference + regex 2026.9.29: 2000 / unicode-version 2
anthropic-claude-legacy      2000     0      0      0  oracles.bpe_reference + regex 2026.9.29: 2000 / 0
google-gemma4                2000     0      0      0  @huggingface/tokenizers 0.2.0 (Gemma 4 tokenizer.json): 2000 / 0; sentencepiece 0.2.2 (Gemma 3 .spiece.model): 2000 / 0
google-gemma2                2000     0      0      0  oracles.spm_bpe_ref (pure-Python SentencePiece BPE) + protobuf 7.36.2: 2000 / 0
xai-grok1                    2000     0      0      0  oracles.spm_bpe_ref (pure-Python SentencePiece BPE) + protobuf 7.36.2: 2000 / 0
total: 18000 strings, ids + spans vs the Python oracle: 0 mismatch(es), 0 oracle error(s); 4 oracle divergence(s), 0 unclassified
```

A nightly-sized run used seed 20261026 and 10,000 strings per tokenizer: 90,000 strings in 31.8 s, 0 mismatches,
0 oracle errors and 20 oracle divergences, every one classified. The divergences of both runs (24), with their minimal
repros:

| Second opinion vs the oracle           | Class             | Minimal repro                                               | Cause                                                                                                                |
| -------------------------------------- | ----------------- | ----------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------- |
| @huggingface/tokenizers on Glimmer     | `unicode-version` | `"\u{32828}:m"` (6 strings across both runs, all CJK Ext J) | Node's native `\p{L}` is Unicode 17. Ext J is unassigned in Unicode 16.0, the version of tiktoken and of our tables. |
| @huggingface/tokenizers on Glimmer     | `case-fold`       | `" I'ſ"` (11 strings across both runs)                      | The JS port's `(?i:'s…)` does not fold `ſ` → `s` as Rust `regex` does. Our engine matches tiktoken (04 §2.2).        |
| oracles.bpe_reference (Python `regex`) | `unicode-version` | `"\u{332f9}_Z"`, `"\u{1e6c3}\n"`, … (7 strings, Grok-2)     | Python `regex` is Unicode 18 (`unicode_tables.json` › `regexModule.assignedLater`).                                  |

The generator includes a small Unicode 17.0 pool on purpose (CJK Extension J; Tai Yo). It shows that the engines keep
the Unicode 16.0 classes of the id oracles (AD-4), and it exercises the `unicode-version` class. The repeated-unit
generator found no HF-vs-SentencePiece tie-break divergence on Gemma 4 in 12,000 strings (07 §5 risk 2).

### Node benches (`pnpm bench`, serial, `vitest bench` medians)

| Benchmark                                                             | Median                                           | p99       | Node ceiling (phone)           |                    |
| --------------------------------------------------------------------- | ------------------------------------------------ | --------- | ------------------------------ | ------------------ |
| init `readTsbv1` · o200k_base (built `.bin`, decompressed)            | 4.90 ms                                          | 9.13 ms   | ≤ 25 ms (100 ms)               | ok                 |
| init `readTsbv1` + engine factory · o200k_base                        | 5.60 ms                                          | 12.12 ms  | ≤ 25 ms (100 ms)               | ok                 |
| init `readTsbv1` · Gemma 4 (PCES + TYPS + MRGS → CSR)                 | 20.18 ms                                         | 31.88 ms  | ≤ 40 ms (160 ms)               | ok                 |
| init `readTsbv1` + engine factory · Gemma 4                           | 22.08 ms                                         | 27.38 ms  | ≤ 40 ms (160 ms)               | ok                 |
| encode 10k CJK · o200k_base                                           | 8.90 ms                                          | 14.35 ms  | ≤ 15 ms (60 ms)                | ok                 |
| encode 10k CJK · cl100k_base                                          | 8.04 ms                                          | 12.62 ms  | ≤ 15 ms                        | ok                 |
| encode 10k CJK · Llama 3                                              | 9.09 ms                                          | 13.90 ms  | ≤ 15 ms                        | ok                 |
| encode 10k CJK · Llama 4 / Muse                                       | 10.20 ms                                         | 14.78 ms  | ≤ 15 ms                        | ok                 |
| encode 10k CJK · Grok-2                                               | 12.28 ms                                         | 19.41 ms  | ≤ 15 ms                        | ok (≈ 18 % margin) |
| encode 10k CJK · Claude legacy                                        | 10.06 ms                                         | 13.94 ms  | ≤ 15 ms                        | ok                 |
| encode 20k CJK · o200k / cl100k / Llama 3 / Llama 4 / Grok-2 / Claude | 18.39 / 16.23 / 21.78 / 25.32 / 19.90 / 20.40 ms | ≤ 31.2 ms | ≤ 40 ms (160 ms)               | ok                 |
| encode 10k CJK · Gemma 4 / Gemma 2 / Grok-1                           | 6.22 / 6.85 / 8.40 ms                            | ≤ 13.1 ms | ≤ 20 ms (80 ms)                | ok                 |
| encode 20k CJK · Gemma 4 / Gemma 2 / Grok-1                           | 11.62 / 12.13 / 16.52 ms                         | ≤ 21.9 ms | — (no 06 §3 ceiling; recorded) |                    |

### Opt-in tests (`TSBS_PERF=1 NODE_OPTIONS=--expose-gc pnpm test:perf`, serial)

All 16 passed. Encode medians (warm, `time()` helper), 10k / 20k CJK: o200k 8.92 / 17.34, cl100k 7.97 / 15.85, Llama 3
8.99 / 17.80, Llama 4 9.37 / 24.86, Grok-2 12.31 / 25.19, Claude 10.68 / 20.11 ms. spm 10k: Gemma 4 5.95, Gemma 2 5.25,
Grok-1 6.33 ms. o200k `readTsbv1` 5.9 ms and `ByteVocab` init 4.9 ms (4.10 MB resident, max probe 21). Gemma 4
`readTsbv1` with MRGS → CSR 21.1 ms, and 8.91 MB resident (≤ 12 MB). One resident o200k in the Worker host: 4.19 MB
arrayBuffers, 0.09 MB after unload (≤ 8 MB).

**Worker heap check** (06 §3, `packages/worker/test/heap.test.ts`). The real host, loader and engine run on the built
asset. The test sends 500 keystrokes into a 10,000-CJK paragraph and compares `heapUsed + external` after GC with the
value before:

| Tokenizer  | Time per keystroke (encode, awaited) | `heapUsed + external` before → after | Growth   | Budget    |
| ---------- | ------------------------------------ | ------------------------------------ | -------- | --------- |
| o200k_base | 11.9 ms                              | 28.6 → 26.9 MB                       | −1.68 MB | < 10 MB ✓ |
| Gemma 4    | 6.3 ms                               | 33.1 → 32.9 MB                       | −0.18 MB | < 10 MB ✓ |

### Perf spec (`pnpm e2e:perf`: vite preview, chromium 1440×900, desktop, no CPU throttling)

| Metric                                                                                                             | Measured                   | 06 §3 budget         |                                 |
| ------------------------------------------------------------------------------------------------------------------ | -------------------------- | -------------------- | ------------------------------- |
| o200k load, `loaded.ms` (CDP Fast 4G: 9 Mbps, 170 ms RTT; download + verify + gunzip + build)                      | 1,152–1,206 ms             | ≤ 2.5 s desktop      | ✓                               |
| o200k load, navigation → live result (Fast 4G; incl. fonts + 2 rAF load trigger)                                   | 2.82–3.15 s                | (recorded)           |                                 |
| o200k `.bin` transferred                                                                                           | 1,048,023 B                | (`other` ≤ 1,100 KB) |                                 |
| keystroke → board update at 1k chars, p95, from the `encode` request                                               | 18.3–29.7 ms               | ≤ 50 ms              | ✓                               |
| keystroke → board update at 1k chars, p95, from the keystroke (incl. the 40 ms debounce)                           | 63.8–78.6 ms               | (see finding 2)      |                                 |
| keystroke → board update at 10k CJK, p95, from the `encode` request                                                | 34.1–52.7 ms               | ≤ 120 ms             | ✓                               |
| keystroke → board update at 10k CJK, p95, from the keystroke                                                       | 79.0–102.4 ms              | ≤ 120 ms             | ✓                               |
| longest main-thread task while typing into 10k CJK (trace)                                                         | 14.9–24.9 ms; 0 long tasks | ≤ 50 ms              | ✓                               |
| paste 10k CJK → board update                                                                                       | 102–160 ms                 | (recorded)           |                                 |
| render 2,672 board cells (K 51, 20 rows of ASCII), script from the Worker `result` to the updated DOM, median of 5 | 159–370 ms (max 276–544)   | ≤ 50 ms              | ✗ (soft; finding 1)             |
| render 2,672 cells, result → next frame, median                                                                    | 210–439 ms                 | (recorded)           |                                 |
| scrub one merge step at stop 5 (`.`, 300 chars), keydown → frame, p95                                              | 45.2–91.0 ms               | (recorded)           |                                 |
| longest main-thread task while scrubbing (trace)                                                                   | 31.7–62.9 ms               | ≤ 50 ms              | ✗ 2 of 3 runs (soft; finding 3) |

The ranges come from three to four runs on the same evening. The spec soft-fails: a missed budget is a warning plus an
entry in `e2e/test-results/perf/perf-results.json`. `PERF_STRICT=1` makes a miss fail the spec.

### Findings for the owners

1. **The board render is about 3–7 times over budget** (WP08; WP13 owns the long-input tiers). A board of 2,672 cells
   takes 160–370 ms of script, which is a single main-thread task of 150–660 ms under a trace. The budget is "Render
   2,000 cells ≤ 50 ms script; virtualize beyond". The board mounts every row up to `VIRTUALIZE_ABOVE = 24` rows
   (`apps/web/src/board/window.ts`), which is 2,400–3,600 cells at K ≈ 50. A CPU profile shows the Svelte runtime and
   DOM insertion dominate. Each text change also renders the board twice: once as the pending text-only board, once with
   the result. Options: virtualize from about 8 rows, cut the work per cell, or render the pending board without tokens
   lazily.
2. **The keystroke budget and the 40 ms debounce do not fit together.** `ENCODE_DEBOUNCE_MS = 40` (05 §6, IME pairs)
   puts 40 ms in front of every encode. Measured from the keystroke, the 1k-char p95 is 76–79 ms, against "≤ 50 ms".
   The spec holds the 06 §3 budget to the latency from the `encode` request that the debounce releases (24–30 ms), and
   it records the from-keystroke number as well. The design owner or WP13 should decide whether to restate the budget
   that way or to skip the debounce while no IME composition is active.
3. **Scrubbing** at stop 5 had one task of 58–63 ms under a trace in two of three runs (32 ms in the quietest),
   against the 50 ms long-task rule (soft). WP09's rail
   and scrubber replace this path, so re-measure after wave 3.
4. **Production and edge numbers are recorded at the first deploy** (WP13). These are LHCI on the preview and production
   URLs (06 §3), the 06 §7 item 6 curl smoke (transferred bytes, the loader's `layer` / `contentEncoding`), the Fast 4G
   load on the real edge, and the one mid-range Android run that 07 WP12 requires before launch. `vite preview` serves
   uncompressed JS and is never a budget target for transfer sizes.

### Under contention (for the record, not baseline)

Two `TSBS_PERF=1 pnpm bench` runs happened while other processes used 45–70 % CPU. Medians went over their ceilings: o200k
`readTsbv1` 25.7 ms and 49.5 ms (ceiling 25), Gemma 4 `readTsbv1` 45.9–51.4 ms (ceiling 40), Llama 4 20k CJK 148 ms,
Grok-1 10k p99 174 ms. The quiet runs above stayed inside every ceiling. This is why the timing runs are serial and the
nightly timing step is soft.
