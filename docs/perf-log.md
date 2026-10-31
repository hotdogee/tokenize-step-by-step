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

## 2026-10-26 — first production deploy (edge, before wave 4)

Production: https://tokenize-step-by-step.hotdogee.workers.dev (CI deploy of main 86a0edf/3a47892; `deploy:smoke`
10/10). LHCI mobile preset, 3 runs, from the deploy job:

| Assertion                           | Found                                  | Budget     | Status                                          |
| ----------------------------------- | -------------------------------------- | ---------- | ----------------------------------------------- |
| first-contentful-paint              | 1,609 ms (runs 1,609 / 2,166 / 2,077)  | ≤ 1,500 ms | ✗ (PA-14: WP13 levers, then AD-15 fallback)     |
| largest-contentful-paint            | passed                                 | ≤ 2,000 ms | ✓                                               |
| total-blocking-time                 | passed                                 | ≤ 150 ms   | ✓                                               |
| cumulative-layout-shift             | passed                                 | ≤ 0.02     | ✓                                               |
| resource-summary script (as served) | 141.4 KB (141,424 / 143,176 / 143,056) | ≤ 110 KB   | ✗ → budget restated as served, ≤ 143 KB (PA-14) |

As served, the edge compresses with **zstd** for Chrome (`content-encoding: zstd`), about 28 % weaker than the brotli-11
`size-limit` numbers: main 47,982 B (brotli-11 39.9 kB), Header 23,002 (19.4), registry 17,459 (13.3), i18n 11,898
(8.3), lazy-client 3,542 (2.3), CSS 11,129 (11.5 → 7,065 + 4,064), index.html 1,380. The brotli-11 sum of everything the
trace loads (main + Header + registry + i18n + client/cancelled/entry/boot + Worker entry-core + bytelevel +
engine-core) is 110.3 kB, i.e. the engineering budget holds. Measured with a Playwright script (412 × 823, 4× CPU) from
this machine; the Worker's own fetches are not visible to the page's CDP session and were taken from the brotli sums.

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

**WP13a second review round (same machine, same harness).** The reviewer's independent `pnpm lhci-local` (1 run):
performance 0.93, FCP 1,814 ms, LCP within budget, TBT 273 ms, script 135,037 B. After this round's fixes (on-demand run
state, quota notice, tier announcement, copy-link and error-recovery copy: three new catalog strings): Main JS 80.21 kB
of 81.92 (i18n 8.84 of 9.22); `pnpm lhci-local --runs 3`: performance 0.93, FCP 1.81–1.83 s, LCP 1.97–1.99 s, TBT
251–259 ms, script 135,538–135,548 B — the same four loopback misses (performance, FCP, TBT, script size); LCP passes.
The budgets were not raised. The WP13 row's "LHCI budgets met on production" stays **open**, and the WP13b precondition
above stands unchanged: the preview `lighthouse` job of the WP13a pull request is read before any launch work, and a
TBT or FCP miss there is answered with the levers above (drawer, inspector host and rail playback mounted after first
paint, or the AD-16 static partial).

**AD-27 memory (CDP heap probe, `e2e/specs/integration-memory.spec.ts`).** Backing store of the page's ArrayBuffers above
the baseline (270 KB) after a forced GC (kB/MB = 1000 B): 15.8 MB with a 150,000-code-point zh-TW run on screen;
0.39 MB while the next (capped, 200,000-code-point) run is in flight, so the previous result is gone before the new one
arrives (before the fix: 15.8 MB); 0.25 MB after the text goes back to 4 characters (before the fix: about 19.7 MB, the
review's measure).

## 2026-10-26 — wave 4a integration (vite preview, pre-launch)

**Where:** the same machine as the baseline; `main` at the WP13a merge `8db8d6b` (WP13a on top of `0babe49`, which
carries the Linux CI fixes and PA-14); `pnpm build`, then one run of `pnpm e2e:perf` against `vite preview` of the
production bundle (chromium 1440 × 900, desktop, no CPU throttling), no other test run in parallel.

| Metric                                                                                      | Measured             | 06 §3 budget    |     |
| ------------------------------------------------------------------------------------------- | -------------------- | --------------- | --- |
| o200k load, `loaded.ms` (CDP Fast 4G; layer gzip, 1,048,023 B transferred)                  | 1,174 ms             | ≤ 2.5 s desktop | ✓   |
| o200k load, navigation → live result (CDP Fast 4G)                                          | 2,839 ms             | (recorded)      |     |
| keystroke → board update at 1k chars, p95, encode request → frame (PA-12)                   | 30.3 ms              | ≤ 50 ms         | ✓   |
| keystroke → board update at 1k chars, p95, keystroke → frame (incl. the debounce; recorded) | 79.7 ms (p50 49.0)   | (recorded)      |     |
| keystroke → encode request (the 40 ms debounce), median                                     | 41.5 ms              | (recorded)      |     |
| keystroke → board update at 10k CJK, p95, encode request → frame (PA-12)                    | 26.5 ms              | ≤ 120 ms        | ✓   |
| keystroke → board update at 10k CJK, p95, keystroke → frame (recorded)                      | 68.1 ms              | (recorded)      |     |
| longest main-thread task while typing into 10k CJK (trace)                                  | 8.2 ms; 0 long tasks | ≤ 50 ms         | ✓   |
| paste 10k CJK → board update                                                                | 102.0 ms             | (recorded)      |     |
| render a 2,000-cell board (K 51, 15 rows), wall time result → DOM, median of 5              | 15.2 ms (max 19.0)   | ≤ 50 ms script  | ✓   |
| render a 2,000-cell board, result → next frame, median                                      | 31.7 ms              | (recorded)      |     |
| render a 2,000-cell board, cells mounted (virtualized, PA-11)                               | 938                  | (recorded)      |     |
| render a 2,000-cell board, longest main-thread task under a trace                           | 15.5 ms              | (recorded)      |     |
| scrub one merge step at stop 5, keydown → frame, p95                                        | 19.7 ms              | (recorded)      |     |
| longest main-thread task while scrubbing (trace)                                            | 11.7 ms              | ≤ 50 ms         | ✓   |

All asserted budgets are met in this single run; the 1k-character PA-12 p95 (30.3 ms) is above the branch's three-run
range (9.0–19.4 ms) and inside the budget.

**Startup bundle (`pnpm build`, size-limit, brotli-11, kB = 1000 B):** Main JS **80.35 kB** of 81.92 (main 42.68 +
Header 19.46 + registry 9.37 + i18n 8.84; i18n 8.84 of 9.22), Worker entry + entry-core 11.40 of 12.29 (entry-core
11.19), bytelevel + engine-core 15.20 of 16.38 (bytelevel 10.39, engine-core 4.81), spm + engine-core 8.75 of 10.24
(spm 3.94), CSS 11.83 of 20.48, font 0.91 of 4.1, boot 0.32 of 0.5, `index.html` 0.33 kB. Lazy chunks: LiveCheckBody
10.19, examples (the "why" sentences) 4.96, registry-details 4.62, choreography 3.70, inspector model 3.37,
examples-client 2.70, PickerDialog 2.45, catalogs 2.35, client 2.33, window-slice 1.87, MergeList 1.21,
SingleKeySetting 0.91, LongInputBanner 0.62, HelpDialog 0.59, Dialog 0.46 kB. No Lighthouse run in this entry: the
budget-authoritative read is the CI `lighthouse` job on a preview or production deploy (PA-14), still open for WP13b.

## 2026-10-26 — pre-launch fixer round 1: first-contentful-paint and the AD-15 bound

**Production LHCI** (the newest deploy whose deploy job ran: run 40248086957, `main` at 3a47892, i.e. before WP13a; the
two later deploy runs skipped their deploy job because CI failed). Mobile preset, 3 runs, optimistic aggregation:

| Assertion                           | Found (runs)                                | Budget      | Status                                    |
| ----------------------------------- | ------------------------------------------- | ----------- | ----------------------------------------- |
| first-contentful-paint              | 1,608.9 ms (1,608.9 / 2,165.8 / 2,076.8)    | ≤ 1,500 ms  | ✗                                         |
| resource-summary script (as served) | 141,424 B (141,424 / 143,176 / 143,056)     | ≤ 112,640 B | ✗ at 3a47892; ≤ 146,432 B since PA-14 → ✓ |
| categories:performance              | 0.95 (0.87 / 0.95 / 0.95)                   | ≥ 0.95      | ✓                                         |
| largest-contentful-paint            | 1,903.9 ms (1,903.9 / 2,264.3 / 2,177.3)    | ≤ 2,000 ms  | ✓                                         |
| total-blocking-time                 | 147 ms (465 / 147 / 151)                    | ≤ 150 ms    | ✓                                         |
| render-blocking savings (FCP)       | 0 ms (Lighthouse's own estimate, every run) | —           |                                           |

**Is critical CSS (AD-15) able to move FCP?** `/` paints nothing before the main JS has run (`<div id="app">` is empty
until Svelte mounts), so FCP waits for main + Header + registry + i18n (≈ 100 KB as served) and their evaluation. Measured
on this machine with the same `lighthouserc.json` (3 runs each, simulated FCP):

| Target                                                                          | FCP (ms)              |
| ------------------------------------------------------------------------------- | --------------------- |
| production, from this machine (3a47892 on the edge)                             | 1,525 / 1,522 / 1,519 |
| HTTPS + HTTP/2 + zstd-3 local server, production files mirrored (3a47892)       | 1,380 / 1,351 / 1,350 |
| same server, `main` with the round-1 fixes                                      | 1,380 / 1,350 / 1,351 |
| same server, `main` with **no stylesheet at all** (the most AD-15 could remove) | 1,380 / 1,380 / 1,380 |
| `pnpm lhci-local` (wrangler dev, HTTP/1.1), `main` with the round-1 fixes       | 1,817 / 1,813 / 1,812 |
| wrangler dev (HTTP/1.1), `main` with no stylesheet at all                       | 1,510 / 1,659 / 1,662 |

On the protocol production serves (HTTP/2 or 3), removing every stylesheet from the critical path changes FCP by 0 ms,
so no critical-CSS split can bring it under 1.5 s; the 150–300 ms that `lhci-local` shows is an HTTP/1.1 artifact
(seven parallel requests on six connections). WP13a did not move FCP either (same server: 3a47892 and `main` agree). The
gap between this machine and the CI runner (1.52 s vs 1.61–2.17 s against the same production files) is CPU time under
the 4× slowdown plus real connection latency. AD-15 was therefore **not** applied; the lever left is the JS on the first
paint path or the AD-16 static partial (contentful HTML before the main JS runs).

## 2026-10-26 — PA-15: the static first paint (first-paint engineer round 1)

**What changed.** `index.html` now carries the server-rendered first state of `/` for each UI locale (header, input
panel with the default text, counts line, rail at stop 6, the precomputed o200k board of 台灣台南 in five width
variants, notices and footer, the live-check drawer); a 345 B classic clone script right after `#app` puts the visitor's
locale and width into `#app` before anything paints; the entry module is an `async`, `fetchpriority="low"` script after
it and hydrates the markup once the browser reports the first paint (PA-15 in 00-decisions.md §E has the design).

**Where:** this machine (Lighthouse `benchmarkIndex` 3,644), `main` at `c1ff708` (before) and the PA-15 commit (after),
`pnpm build` each, mobile preset of `lighthouserc.json` (Lighthouse 12.6.1, simulated Slow 4G, CPU ×4), 3 runs each. Two
servers: `pnpm lhci-local` (wrangler dev, HTTP/1.1, gzip) and the pre-launch fixer's production-like HTTPS + HTTP/2 +
zstd-3 server (`h2/serve.mjs`, the same `_headers` CSP).

| Metric (simulated)            | HTTP/2 before         | HTTP/2 after          | lhci-local before     | lhci-local after          | Budget     |
| ----------------------------- | --------------------- | --------------------- | --------------------- | ------------------------- | ---------- |
| first-contentful-paint        | 1,350 / 1,350 / 1,351 | **949 / 943 / 947**   | 1,809 / 1,810 / 1,810 | **1,414 / 1,414 / 1,413** | ≤ 1,500    |
| largest-contentful-paint      | 1,432 / 1,424 / 1,429 | 1,350 / 1,351 / 1,351 | 1,966 / 1,969 / 1,963 | 1,965 / 1,965 / 1,965     | ≤ 2,000    |
| total-blocking-time           | 114 / 97 / 106        | 18 / 17 / 16          | 264 / 267 / 257       | 21 / 22 / 24              | ≤ 150      |
| cumulative-layout-shift       | 0                     | 0                     | 0                     | 0                         | ≤ 0.02     |
| performance score             | 0.99                  | **1.00**              | 0.93                  | 0.99                      | ≥ 0.95     |
| document transfer (as served) | 821 B                 | 13,179 B (zstd-3)     | 1,227 B               | 20,694 B (gzip)           | ≤ 14,336 B |

FCP moves by **−401 to −407 ms** on HTTP/2 and −396 ms on wrangler dev. The document grows to 241,232 B raw, 9,012 B
brotli-11 (size-limit budget 14 KiB), 12,862 B zstd-3 / 12,202 B zstd-4: the edge served the production JS at about
zstd 3–4 plus ≈ 0.8 KB of headers (run 40248086957: main 48,040 B against 47,468 / 46,317 at zstd 3 / 4), so the LHCI
document assertion (≤ 14 KB as served) should hold with ≈ 0.6–1.3 KB to spare. wrangler dev only gzips (32 KB window,
no reach across the three locale templates): 19,949 B, so **`lhci-local` now fails `resource-summary:document:size`**
(report-only by design; the edge run decides). If the edge ever serves this page gzip-only, or the markup grows, the
lever is to trim the static paint below the fold (the footer, notices and drawer are ≈ 1.7 KB of zstd).

**Real browser, same h2 server** (Playwright chromium, Pixel 5 at 412 × 823 @ 1.75, CPU ×4, 5 runs; loopback, so the JS
arrives at once): FCP = LCP 692 / 648 / 668 / 644 / 680 ms before, 568 / 528 / 532 / 564 / 564 ms after; the app has
hydrated at 686–801 ms; CLS 0 in every run. Most of the remaining time to first paint is the page's first style + layout
(≈ 75–100 ms unthrottled: system-font fallback for the CJK, Japanese, emoji and Ext-G glyphs of the example chips and the
board — measured by removing regions: the chips alone cost ≈ 37 ms, the board ≈ 23 ms).

**Why a separate clone script.** Cloning from boot.js (on `readystatechange`) gave the same observed paint, but Lantern
counted that first style + layout (≈ 100 ms observed, × 2 for a layout task) as a task after FCP, because the page had
already laid out an empty frame while the 241 KB document was parsed: TBT 151–167 ms on HTTP/2 (FCP 900–930, LCP
1,425–1,479). With the clone in a parser-blocking script after `#app`, the layout happens in the task that evaluated a
render-blocking script, which Lantern puts on the FCP path: FCP 943–949, TBT 16–24. The entry module had to leave the
parser's last task too (a deferred module that has already arrived runs there and ties that task to the JS downloads):
it is an `async` script after the clone script, and its modulepreloads are `fetchpriority="low"`.

**Startup bundle (size-limit, brotli-11, kB = 1000 B):** Main JS **81.73 kB** of 81.92 (main 43.68 + Header 20.65 +
registry 8.56 + i18n 8.84). `hydrate()` keeps Svelte's hydration paths in the runtime (+1.2 kB Header, +0.3 kB main);
moving the help dialog's shortcut table (`shell/shortcut-groups.ts`) and the `?mock=1` client's feature probe out of the
startup chunks recovered 0.55 kB. `first-paint-[hash].js` 345 B of 512 (new budget), `boot-[hash].js` 320 B (unchanged),
CSS 12.08 kB (the 57 `.k8…k64` column-count classes), `index.html` 9.01 kB of 14.34.

## 2026-10-26 — production, launch (WP13b)

**Where:** production `https://tokenize-step-by-step.hotdogee.workers.dev`, serving `c1ff708` (CI deploy run
40285946585, Worker version `ff444522`), measured from this machine (Windows, Lighthouse `benchmarkIndex` 4,350–4,500)
on 2026-10-26 09:50–09:56 UTC. The release push (PA-15's static first paint and the WP13b fixes) deploys after this entry;
the post-push verification re-runs Lighthouse there. `tokens.hanlin.uk` is attached by that deploy (docs/release.md §
Custom domain) and serves the same Worker.

**Lighthouse** (`pnpm lhci --collect.url=<production>/`, the mobile preset of `lighthouserc.json`: Lighthouse 12.6.1,
simulated Slow 4G 1.6 Mbps / 150 ms, CPU ×4, 3 runs; LHCI asserts the best run):

| Metric / category (3 runs) | Found                    | Budget        | Status                    |
| -------------------------- | ------------------------ | ------------- | ------------------------- |
| Performance                | 99 / 99 / 99             | ≥ 95          | ✓                         |
| Accessibility              | 100 / 100 / 100          | 100           | ✓                         |
| Best Practices             | 100 / 100 / 100          | 100           | ✓                         |
| SEO (not asserted)         | 100                      | —             | —                         |
| first-contentful-paint     | 1,514 / 1,531 / 1,511 ms | ≤ 1,500 ms    | **✗ by 11 ms** (best run) |
| largest-contentful-paint   | 1,572 / 1,605 / 1,567 ms | ≤ 2,000 ms    | ✓                         |
| total-blocking-time        | 67 / 98 / 62 ms          | ≤ 150 ms      | ✓                         |
| cumulative-layout-shift    | 0 / 0 / 0                | ≤ 0.02        | ✓                         |
| speed-index (not asserted) | 1,993 / 1,973 / 1,837 ms | —             | —                         |
| document (as served)       | 1,373 B                  | ≤ 14,336 B    | ✓                         |
| script (as served, zstd)   | 139,945 B                | ≤ 146,432 B   | ✓                         |
| stylesheet                 | 11,242 B                 | ≤ 20,480 B    | ✓                         |
| font                       | 1,773 B                  | ≤ 4,096 B     | ✓                         |
| other (the o200k `.bin`)   | 1,050,145 B              | ≤ 1,126,400 B | ✓                         |
| total                      | 1,204,469 B              | ≤ 1,331,200 B | ✓                         |

The same files from the CI runner (deploy run 40285946585's report-only pass, `benchmarkIndex` 2,628–2,726): FCP
1,490 / 2,063 / 2,069 ms, LCP 1,617 / 2,186 / 2,181, TBT 58 / 197 / 174, performance 99 / 94 / 94 — green only on the
best run. This is the pre-PA-15 page; PA-15 measured −396 to −407 ms of FCP on the same preset (entry above), which is
the margin the launch relies on. The verifier's post-push run is the authoritative one.

**Perf spec** (`E2E_PERF_BASE_URL=<production> pnpm e2e:perf`: chromium 156, 1440 × 900, desktop, load under CDP "Fast
4G" 9 Mbps / 170 ms, the rest unthrottled; all soft budgets met):

| Metric                                                                           | Value          | Budget     |
| -------------------------------------------------------------------------------- | -------------- | ---------- |
| o200k load, `loaded.ms` (Fast 4G, desktop; layer gzip)                           | 1,165 ms       | ≤ 2,500 ms |
| o200k load, navigation → live result (Fast 4G)                                   | 3,031 ms       | —          |
| o200k `.bin` transferred                                                         | 1,049,074 B    | —          |
| keystroke → board, 1k chars, p95 (encode request → frame, PA-12)                 | 18.6 ms        | ≤ 50 ms    |
| keystroke → board, 1k chars, p95 / p50 (keystroke → frame, incl. 40 ms debounce) | 65.0 / 49.2 ms | —          |
| paste 10k CJK → board update                                                     | 128.0 ms       | —          |
| keystroke → board, 10k CJK, p95 (encode request → frame)                         | 26.3 ms        | ≤ 120 ms   |
| longest main-thread task while typing into 10k CJK (trace)                       | 9.8 ms         | ≤ 50 ms    |
| render 2,000 cells, result → DOM, median / max of 5 (938 mounted)                | 14.9 / 16.0 ms | ≤ 50 ms    |
| scrub one merge step, keydown → frame, p95                                       | 27.6 ms        | —          |
| longest main-thread task while scrubbing (trace)                                 | 14.8 ms        | ≤ 50 ms    |

**Largest vocabulary file and loader diagnostics** (06 §7 item 6): `/tok/google-gemma4/95b2821652a7.bin` → `200`,
`Content-Length: 1658262` (= the manifest's `bytesCompressed`), no `Content-Encoding` although the request offered
`zstd, br, gzip`, `Content-Type: application/octet-stream` (one value), `Cache-Control: public, max-age=31536000,
immutable`, `X-Content-Type-Options: nosniff`, `Cross-Origin-Resource-Policy: same-origin`, `CF-Cache-Status: HIT`;
1,658,262 B transferred in 1.23 s (curl, HTTP/1.1, this machine). About › Diagnostics after a first visit in a fresh
chromium profile: "o200k_base (GPT-4o → GPT-5.x): 784 ms, from the network, 1,023 KB transferred, layer gzip, content
encoding none" (navigation → live 2.95 s unthrottled); a revisit loads from the Cache API ("14 ms, from the cache, 0 B
transferred, layer gzip"). Feature probe in chromium: Cache API, `Intl.Segmenter` and Web Crypto available, Brotli
`DecompressionStream` not available (so the loader verifies the gzip layer, as designed).

**Mid-range Android (owner, open):** one run of docs/release.md § Mid-range Android check, to be filled in.

| Phone / Android / Chrome / network | A: board shown | B: LIVE (o200k loaded) | C: typing | D: scrub | E: 2→3 morph | F: About › Diagnostics last load |
| ---------------------------------- | -------------- | ---------------------- | --------- | -------- | ------------ | -------------------------------- |
| _(owner)_                          |                | (≤ 4 s budget)         |           |          |              |                                  |

## 2026-10-31 — PA-19 follow-up: the perf suite on the new page

**Why:** `e2e/perf` ran in no check PA-19's pull request used, and the nightly failed from the first night after the
merge (`no board grid`, four of five tests skipped). The suite now opens Advanced for the board's tests and adds two
tests of the default page. This is the first measurement of the page PA-19 shipped.

**Where:** the development machine at c3f25da, `pnpm build`, three runs of `pnpm e2e:perf` against `vite preview`
(chromium, no CPU throttling), Windows and the Linux image `mcr.microsoft.com/playwright:v1.64.1-noble` limited to 4
CPUs, nothing else running. Board tests: Advanced open, five live rows, held to the later of the board's frame and
the table's, since the board's result comes first and its own frame lands before the other four rows answer (recorded
beside it), in a 1440 × 1700 window. Table tests: Advanced closed, five live rows, 1440 × 900.

| Metric                                                                               | Windows     | Linux, 4 CPUs | 06 §3 budget    |     |
| ------------------------------------------------------------------------------------ | ----------- | ------------- | --------------- | --- |
| o200k load, `loaded.ms` (CDP Fast 4G)                                                | 1,188–1,190 | 1,158–1,164   | ≤ 2.5 s desktop | ✓   |
| keystroke → board, 1k chars, p95, encode request → board's and table's frame (PA-12) | 25.6–27.1   | 27.6–28.6     | ≤ 50 ms         | ✓   |
| keystroke → board, 1k chars, p95, encode request → the board's own frame             | 23.0–23.5   | 12.1–20.5     | (recorded)      |     |
| keystroke → board, 1k chars, p95, keystroke → board's and table's frame              | 69.3–74.1   | 68.9–71.2     | (recorded)      |     |
| keystroke → board, 1k chars, p95, keystroke → the board's own frame                  | 69.3–69.8   | 53.5–61.6     | (recorded)      |     |
| keystroke → board, 10k CJK, p95, encode request → board's and table's frame (PA-12)  | 42.4–52.8   | 52.0–58.3     | ≤ 120 ms        | ✓   |
| keystroke → board, 10k CJK, p95, encode request → the board's own frame              | 36.0–36.6   | 33.7–37.4     | (recorded)      |     |
| keystroke → board, 10k CJK, p95, keystroke → board's and table's frame               | 88.7–97.6   | 94.4–100.9    | (recorded)      |     |
| keystroke → board, 10k CJK, p95, keystroke → the board's own frame                   | 83.3–88.7   | 75.9–79.8     | (recorded)      |     |
| longest main-thread task typing into 10k CJK, board + table (trace)                  | 14.9–19.0   | 16.7–20.1     | ≤ 50 ms         | ✓   |
| keystroke → encode request (the 40 ms debounce), median                              | 46.5–46.8   | 41.4          | (recorded)      |     |
| keystroke → table, 1k chars, p95, input → last row's frame                           | 66.8–78.4   | 65.5–65.7     | (recorded)      |     |
| keystroke → table, 1k chars, p50, input → last row's frame                           | 65.3–65.5   | 64.8–64.9     | (recorded)      |     |
| keystroke → table, 1k chars, p95, encode request → last row's frame (PA-12)          | 24.1–33.9   | 25.1–25.2     | ≤ 50 ms         | ✓   |
| of which encode request → last Worker result, p95                                    | 19.8–21.6   | 14.8–16.8     | (recorded)      |     |
| of which last Worker result → last row's frame, p95                                  | 13.2–13.5   | 12.7–13.0     | (recorded)      |     |
| keystroke → table, 10k CJK, p95, input → last row's frame                            | 73.2–81.5   | 80.5–83.3     | (recorded)      |     |
| keystroke → table, 10k CJK, p95, encode request → last row's frame (PA-12)           | 23.8–34.6   | 39.6–42.4     | ≤ 120 ms        | ✓   |
| longest main-thread task typing into 10k CJK, table only (trace)                     | 12.5–18.6   | 13.2–16.0     | ≤ 50 ms         | ✓   |
| render ≈ 2,000 board cells (1,180 mounted), wall time result → DOM, median           | 16.8–17.3   | 18.8–19.4     | ≤ 50 ms script  | ✓   |
| scrub one merge step at stop 5, keydown → frame, p95                                 | 32.0–33.8   | 32.2–35.1     | (recorded)      |     |
| longest main-thread task while scrubbing (trace)                                     | 16.9–22.2   | 20.7–21.7     | ≤ 50 ms         | ✓   |

All times in ms. **The table is held on PA-12's measure, and a keystroke still takes about 65 ms to show.** From the
`input` event the latency holds the 40 ms debounce (41–47 ms measured), which would leave 3–9 ms of 50 ms for five
Workers and the next frame; even the first thing the page shows after a keystroke, the board's own frame at 1k with five
rows live, takes 54–70 ms from `keydown`. This is finding 2 of the WP12 baseline again, which PA-12 settled for the board
by holding its budget from the encode request and keeping the debounce (IME `compositionend` + `input` pairs, fast
typists), and the table's budget now does the same (PA-19's follow-up in `docs/design/00-decisions.md`). On that measure
the table takes 24–34 ms at 1k and 24–42 ms at 10k. Its own work is small: its longest main-thread task is 13–19 ms.

The scrub numbers read higher than the entries before PA-19 (19.7 ms, longest task 11.7 ms in wave 4a) because the test
now keeps the rail and the board on screen under the table, where the rows take part in the FLIP: with the board below
the fold the same test read 23.2 ms. The render reads higher than before PA-19 (15.2 ms, 938 cells mounted) because it
mounts more: at the top of the window, with no text box above it, 1,180 of the 1,961 cells are in view or overscan.
