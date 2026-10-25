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

**Where:** AMD Ryzen 9 7950X (16 cores), Windows 11 Pro for Workstations, Node 26.12.1, Playwright 1.64.1 (chromium 156.0.8078.4).
**What:** the engines and the production bundle of main at `5678a66` (after wave 2; WP12 changes no `apps/web` or
`packages/*/src` code), served by `vite preview`. Harness: the fuzz, bench, opt-in and heap runs at `e2ba3e1`; the perf
spec table at `10fb1ce` (re-run after the WP12 review on 2026-10-26, machine idle at ≈ 14 % CPU). This is a **shared**
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

The classifier tightening of the review (`49fec3f`: shape-checked `hf-vs-spm-tie-break` and `case-fold`) re-ran both
seeds with the same counts below, every divergence still classified. A nightly-sized run used seed 20261026 and 10,000
strings per tokenizer: 90,000 strings in 31.8 s, 0 mismatches,
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

| Metric                                                                                                                                              | Measured                     | 06 §3 budget         |                     |
| --------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------- | -------------------- | ------------------- |
| o200k load, `loaded.ms` (CDP Fast 4G: 9 Mbps, 170 ms RTT; download + verify + gunzip + build)                                                       | 1,186–1,197 ms               | ≤ 2.5 s desktop      | ✓                   |
| o200k load, navigation → live result (Fast 4G; incl. fonts + 2 rAF load trigger)                                                                    | 2.81–2.82 s                  | (recorded)           |                     |
| o200k `.bin` transferred                                                                                                                            | 1,048,023 B                  | (`other` ≤ 1,100 KB) |                     |
| keystroke → board update at 1k chars, p95, keystroke → frame (incl. the 40 ms debounce)                                                             | 54.9–64.9 ms (p50 52.7–53.0) | ≤ 50 ms              | ✗ (soft; finding 2) |
| encode request → board update at 1k chars, p95 (diagnostic)                                                                                         | 13.4–22.7 ms                 | (recorded)           |                     |
| keystroke → board update at 10k CJK, p95, keystroke → frame (incl. the 40 ms debounce)                                                              | 70.9–74.7 ms                 | ≤ 120 ms             | ✓                   |
| encode request → board update at 10k CJK, p95 (diagnostic)                                                                                          | 28.7–29.3 ms                 | (recorded)           |                     |
| longest main-thread task while typing into 10k CJK (trace)                                                                                          | 12.5–18.6 ms; 0 long tasks   | ≤ 50 ms              | ✓                   |
| paste 10k CJK → board update                                                                                                                        | 96–116 ms                    | (recorded)           |                     |
| render 2,004 board cells (K 51, 15 rows of ASCII sized by a calibration render), wall time from the Worker `result` to the updated DOM, median of 5 | 128–133 ms (max 223–298)     | ≤ 50 ms script       | ✗ (soft; finding 1) |
| render 2,004 cells, result → next frame, median                                                                                                     | 160–164 ms                   | (recorded)           |                     |
| render 2,004 cells, longest main-thread task under a trace                                                                                          | 262–296 ms                   | (recorded)           |                     |
| scrub one merge step at stop 5 (`.`, 300 chars), keydown → frame, p95                                                                               | 36.4–38.4 ms                 | (recorded)           |                     |
| longest main-thread task while scrubbing (trace)                                                                                                    | 24.9–31.0 ms                 | ≤ 50 ms              | ✓ (finding 3)       |

The ranges come from three runs at `10fb1ce`. The spec soft-fails: a missed budget is a warning plus an entry in
`e2e/test-results/perf/perf-results.json`. `PERF_STRICT=1` makes a miss fail the spec (checked: it fails on the 1k
keystroke budget). The render number is wall time, an upper bound of the script time the budget names; the trace shows
the same render as one long main-thread task, so the miss is real either way.

### Findings for the owners

1. **The board render is about 2.5 times over budget** (WP08; WP13 owns the long-input tiers). A board of 2,004 cells
   takes 128–133 ms (median; max 223–298 ms) from the Worker result to the updated DOM, which is a single main-thread
   task of 262–296 ms under a trace. The budget is "Render 2,000 cells ≤ 50 ms script; virtualize beyond". The board
   mounts every row up to `VIRTUALIZE_ABOVE = 24` rows (`apps/web/src/board/window.ts`), which is 2,400–3,600 cells at
   K ≈ 50. A CPU profile shows the Svelte runtime and DOM insertion dominate. Each text change also renders the board twice: once as the pending text-only board, once with
   the result. Options: virtualize from about 8 rows, cut the work per cell, or render the pending board without tokens
   lazily.
2. **The keystroke budget and the 40 ms debounce do not fit together** (open). `ENCODE_DEBOUNCE_MS = 40` (05 §6, IME
   pairs) puts 40 ms in front of every encode (41.5–41.7 ms measured). The spec holds the 06 §3 budget to the interval
   06 §3 defines, keystroke → frame: at 1k chars the p95 is 54.9–64.9 ms against "≤ 50 ms" (soft ✗), and even the p50
   (≈ 53 ms) misses. The work after the debounce, encode request → frame, is 13.4–22.7 ms p95 and is recorded as a
   diagnostic only. At 10k CJK the p95 is 70.9–74.7 ms against "≤ 120 ms" (✓). This stays open until a planner
   amendment restates the budget or the debounce is skipped while no IME composition is active (design owner / WP13).
3. **Scrubbing** at stop 5 had one task of 58–63 ms under a trace in two of three runs of the first baseline (at
   `e2ba3e1`, on a busier machine), against the 50 ms long-task rule (soft). The three runs at `10fb1ce` stayed at
   25–31 ms. WP09's rail and scrubber replace this path, so re-measure after wave 3.
4. **Production and edge numbers are recorded at the first deploy** (WP13). These are LHCI on the preview and production
   URLs (06 §3), the 06 §7 item 6 curl smoke (transferred bytes, the loader's `layer` / `contentEncoding`), the Fast 4G
   load on the real edge, and the one mid-range Android run that 07 WP12 requires before launch (owner or WP13; not
   met yet). `E2E_PERF_BASE_URL=<url> pnpm e2e:perf` runs the spec against a deployed URL without a code change.
   `vite preview` serves uncompressed JS and is never a budget target for transfer sizes.

### Under contention (for the record, not baseline)

Two `TSBS_PERF=1 pnpm bench` runs happened while other processes used 45–70 % CPU. Medians went over their ceilings: o200k
`readTsbv1` 25.7 ms and 49.5 ms (ceiling 25), Gemma 4 `readTsbv1` 45.9–51.4 ms (ceiling 40), Llama 4 20k CJK 148 ms,
Grok-1 10k p99 174 ms. The quiet runs above stayed inside every ceiling. This is why the timing runs are serial and the
nightly timing step is soft.

---

## 2026-10-26 — wave 3 integration (development machine)

**Where:** the same machine as the baseline, after the wave 3 merges (WP09 rail and motion, WP10 drawer, WP12, WP11) on
main at `0e974dd` plus the integration fixes; one serial run of each, machine otherwise idle.

| Metric                                                                                                    | Measured                     | 06 §3 budget     |                     |
| --------------------------------------------------------------------------------------------------------- | ---------------------------- | ---------------- | ------------------- |
| o200k load, `loaded.ms` (CDP Fast 4G)                                                                     | 1,178–1,183 ms               | ≤ 2.5 s desktop  | ✓                   |
| keystroke → board update at 1k chars, p95 (incl. the 40 ms debounce)                                      | 55.9–61.4 ms (p50 52.6–53.5) | ≤ 50 ms          | ✗ (soft; finding 2) |
| keystroke → board update at 10k CJK, p95 (incl. the 40 ms debounce)                                       | 70.9–71.0 ms                 | ≤ 120 ms         | ✓                   |
| longest main-thread task while typing into 10k CJK (trace)                                                | 13.0–13.1 ms; 0 long tasks   | ≤ 50 ms          | ✓                   |
| render 2,004 board cells, wall time result → DOM, median of 5                                             | 125–130 ms (max 218–226)     | ≤ 50 ms script   | ✗ (soft; finding 1) |
| scrub one merge step at stop 5 (`.`, 300 chars, WP09 rail), keydown → frame, p95                          | 42.9 ms                      | (recorded)       |                     |
| longest main-thread task while scrubbing (trace, WP09 rail)                                               | 34.7 ms                      | ≤ 50 ms          | ✓ (finding 3)       |
| stop 2→3 morph at 600 cells, longest main-thread task (`TSBS_PERF=1 pnpm e2e pipeline-trace --workers=1`) | passes                       | ≤ 32 ms per task | ✓                   |

Finding 3 is re-measured on WP09's rail and scrubber: inside the long-task rule. The scrub spec now starts its walk at
step 0 (Home on the scrubber), because `5` pressed at stop 6 lands on the last merge since WP09 (stop 6 ≡ stop 5 at
`step = stepCount`). Findings 1, 2 and 4 stand. Node ceilings in the same session (`TSBS_PERF=1 pnpm test:perf`, serial):
byte-level 10k CJK 8.1–11.2 ms (≤ 15; Llama 4 11.2, Grok-2 9.9), 20k CJK 15.9–24.3 ms (≤ 40), spm 10k CJK 5.2–6.1 ms
(≤ 20), o200k `readTsbv1` 6.7 ms (≤ 25), Gemma 4 `readTsbv1` 21.8 ms (≤ 40), Worker heap growth over 500 keystrokes
−1.66 MB (o200k) / −0.20 MB (Gemma 4) (< 10 MB).

The morph row bounds main-thread tasks (the commit frame 22.2–23.5 ms and the longest later task 19.7–22.5 ms in 3 of 3
serial strict runs, wave 3 review), not presented frames: rAF intervals during the same morph reach 33.5–50 ms in serial
headless chromium, and Playwright WebKit on Windows (WinCairo, not representative of Safari) showed a 42–46 ms commit
frame. 06 §3 now says so; a manual macOS Safari morph check is on the release checklist (item 9).

Wave 3 review re-measure (`pnpm e2e:perf`, same machine): the 2,004-cell render has a median of 133.0 ms (max 225.5) from
the Worker result to the DOM and a 244.3 ms longest main-thread task under a trace; the 1k-character keystroke p95 is
54.5 ms. Both stay soft nightly misses and do not block wave 3. Finding 1 stays with WP08 / WP13 (virtualize from fewer
rows than `VIRTUALIZE_ABOVE = 24` or by cell count, and render once per text change); finding 2 waits on the design
owner's call on whether the debounce counts toward the 1k-character budget.

---

## 2026-10-26 — WP13a integration (development machine)

**Where:** the same machine as the baseline; branch `wp/13a-integration` (from main at `2f826d6`); `vite preview` of the
production bundle; three serial runs of `pnpm e2e:perf`, machine otherwise idle.

**What changed:** PA-11 (rows virtualize above 600 cells or 8 packed rows; a keystroke on a loaded tokenizer renders the
board once, when its result arrives — the last result stays on screen with `data-pending` meanwhile), PA-12 (the
keystroke budget is held from the encode request), the load trigger (06 §3: `DOMContentLoaded` → `document.fonts.ready`
→ the first paint entry → two animation frames) and the PA-7 trim. The render spec now sizes its text from the board's
own `data-cells` (the cells every row would mount), since a 2,000-cell board is virtualized.

| Metric                                                                                      | Measured                     | 06 §3 budget    |     |
| ------------------------------------------------------------------------------------------- | ---------------------------- | --------------- | --- |
| o200k load, `loaded.ms` (CDP Fast 4G)                                                       | 1,173–1,190 ms               | ≤ 2.5 s desktop | ✓   |
| keystroke → board update at 1k chars, p95, encode request → frame (PA-12)                   | 9.0–19.4 ms                  | ≤ 50 ms         | ✓   |
| keystroke → board update at 1k chars, p95, keystroke → frame (incl. the debounce; recorded) | 52.0–73.5 ms (p50 49.0–49.4) | (recorded)      |     |
| keystroke → board update at 10k CJK, p95, encode request → frame (PA-12)                    | 27.3–44.6 ms                 | ≤ 120 ms        | ✓   |
| keystroke → board update at 10k CJK, p95, keystroke → frame (recorded)                      | 69.6–86.4 ms                 | (recorded)      |     |
| longest main-thread task while typing into 10k CJK (trace)                                  | 9.7–11.6 ms; 0 long tasks    | ≤ 50 ms         | ✓   |
| render a 2,000-cell board (K 51, 15 rows), wall time result → DOM, median of 5              | 11.5–13.7 ms (max 13.4–14.9) | ≤ 50 ms script  | ✓   |
| render a 2,000-cell board, result → next frame, median                                      | 30.8–34.5 ms                 | (recorded)      |     |
| render a 2,000-cell board, cells mounted (2560 × 1440: the rows in view plus the overscan)  | 938                          | (recorded)      |     |
| render a 2,000-cell board, longest main-thread task under a trace                           | 15.4–17.6 ms                 | (recorded)      |     |
| paste 10k CJK → board update                                                                | 109–152 ms                   | (recorded)      |     |
| scrub one merge step at stop 5, keydown → frame, p95                                        | 19.3–27.7 ms                 | (recorded)      |     |
| longest main-thread task while scrubbing (trace)                                            | 10.8–15.8 ms                 | ≤ 50 ms         | ✓   |

Findings 1 (render) and 2 (keystroke budget vs debounce) of the baseline are closed: the 2,000-cell render went from
125–133 ms to 11.5–13.7 ms (virtualized, rendered once), and the PA-12 measure is 9–19 ms at 1k characters.

**Startup bundle (`pnpm build`, size-limit, brotli, kB = 1000 B):** Main JS 81.10 kB on main at `2f826d6` → ≈ 74.9 kB
after the PA-7 trim alone (registry fields no page renders, the non-default chips' "why" sentences and the inspector
model moved out of the initial chunks) → **79.38 kB** of 81.92 with all of WP13a (main 41.97 + Header 19.40 + registry
9.37 + i18n 8.63; i18n 8.63 of 9.22). Worker entry + entry-core 11.40 of 12.29, bytelevel + engine-core 15.20 of 16.38,
spm + engine-core 8.75 of 10.24, CSS 11.82 of 20.48. New lazy chunks: window-slice 1.87, LongInputBanner 0.61, inspector
model 3.37, examples (the "why" sentences) 4.96 kB.

**lhci-local** (`pnpm lhci-local --runs 3`; loopback `wrangler dev`, gzip rather than brotli, not budget-authoritative;
`lighthouserc.json`: performance ≥ 0.95, FCP ≤ 1.5 s, LCP ≤ 2.0 s, TBT ≤ 150 ms, script ≤ 112,640 B):

| Run           | Performance | FCP         | LCP         | TBT        | Script transferred |
| ------------- | ----------- | ----------- | ----------- | ---------- | ------------------ |
| before (main) | 0.93–0.95   | 1.81–1.90 s | 1.97–2.14 s | 169–251 ms | 136,534 B          |
| after (WP13a) | 0.93        | 1.81–1.82 s | 1.97–1.98 s | 267–270 ms | 134,394–134,404 B  |

The Worker script, the engine chunk and the `.bin` now start after the observed LCP (client chunk requested at 437 ms
against an observed LCP of 386 ms; before: 370 ms against 381 ms), and the simulated LCP is under 2.0 s in every run.
TBT is the single startup task (evaluate, mount and the first layout). It now starts at the simulated FCP, so all of it
counts; before, FCP fell later and cut part of it off. A trace of that task on this machine (4× CPU, 412 px) shows the
first layout alone is about 75 ms unthrottled (fonts resolved for the first time), a platform cost that the deployed
preview's Lighthouse run (Linux, brotli, real RTT) measures differently. The CI `lighthouse` job on the preview URL stays
the budget-authoritative read (06 §3); the budgets were not raised.

**WP13a review fixes (same machine, same harness).** Main JS 79.79 kB of 81.92 (i18n 8.69 of 9.22; one new catalog
string, the focus and URL fixes). `pnpm lhci-local --runs 3`: performance 0.92–0.93, FCP 1.81–1.83 s, LCP 1.97–2.00 s,
TBT 260–286 ms, script 135,037–135,047 B — the same misses as above (performance, FCP, TBT, script size on loopback
gzip). Lighthouse attributes TBT to one startup task of 336 ms (simulated, starting at FCP; `Header-*.js`, the shared
Svelte/app chunk), and its main-thread breakdown puts style and layout (441 ms) ahead of script evaluation (265 ms).

The budget-authoritative read does not exist yet: the branch has no pull request, so no preview deployment or
`lighthouse` job ran, and the last production deploy of `main` was skipped because `ci` failed on `main` (`deploy` run
40236271760; `ci` run 40243655190). **WP13b precondition:** open the WP13a pull request and read its preview `lighthouse`
job before the launch work starts. If TBT or FCP miss there, mount the non-first-paint UI (the live-check drawer, the
inspector host, the rail's playback controls) after the first paint in a separate task — reserving their space so CLS
stays 0 — or apply the AD-16 static-partial fallback. No first-paint change was made on the loopback numbers alone.

**AD-27 memory (CDP heap probe, `e2e/specs/integration-memory.spec.ts`).** Backing store of the page's ArrayBuffers above
the baseline (270 KB) after a forced GC (kB/MB = 1000 B): 15.8 MB with a 150,000-code-point zh-TW run on screen;
0.39 MB while the next (capped, 200,000-code-point) run is in flight, so the previous result is gone before the new one
arrives (before the fix: 15.8 MB); 0.25 MB after the text goes back to 4 characters (before the fix: about 19.7 MB, the
review's measure).
