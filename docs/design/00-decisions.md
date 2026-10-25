# 00 — Decision log (ADR style)

*Final design, 2026-10-25. Lead architect synthesis of three proposals (correctness, experience, performance) and three judge reports. Every decision below is binding for the implementation work packages in `07-implementation-plan.md`. Research citations refer to `docs/research/01-tokenizers-and-platform.md` sections.*

Status legend: **OD** = owner decision (given in the brief, not revisitable here); **PD** = planner decision (given, recorded with consequences); **AD** = architect decision taken in this design (with the alternatives rejected and why).

Repo facts verified today, which several proposals got wrong and which every work package must assume:

- All **12** fixtures exist (`fixtures/*.json`) and every one holds the same cases, **374** today (70 core + 4 paragraphs + 300 fuzz). `fixtures/google-gemma2.json` exists (sentencepiece 0.2.2 oracle, `spm_bpe_ref.py` cross-check). No `experimental` gating is needed for Gemma 2. WP00's oracle lane added 16 core cases to the earlier 358 (ten whitespace/contraction discriminators and one special-string case per shipped tokenizer, 04 §2.2/§2.4) and regenerated all fixtures; every "358" in this design means "all cases of the committed fixtures" (374 today).
- `fixtures/google-gemma4.json` takes `tokens[].type` from the **Gemma 3 proto** (Gemma 4 has no `.model`): 347 tokens over 8 ids (`\n`, `\n\n`, `▁` runs, `\t`, `\t\t`) are labelled `USER_DEFINED` although the HF oracle that produced the ids has no USER_DEFINED pieces — see AD-31.
- `fixtures/README.md` does **not** exist; the fixture schema lives in `tools/oracle/README.md` § "Golden fixtures". WP00 adds a one-paragraph pointer file.
- `tools/oracle/manifest.json` lists 12 assets; 8 are `shipIntent: ship` (o200k, cl100k, muse-glimmer, gemma4, gemma2, grok2, grok1, claude-legacy), `meta-llama4-model` and `google-gemma3-spiece` are `oracle-only`, `anthropic-ctok` is `phase-2`, and **`meta-llama3-model` is `oracle-only` although the brief ships Llama 3.x** — WP00 flips it to `ship` (making the nine shipped assets of OD-4) and adds the Llama 3 attribution package (AD-26).

---

## A. Owner decisions (OD)

| Id | Decision | Consequences for this design |
|---|---|---|
| OD-1 | Product: client-side-only step-by-step tokenization visualizer; text → code points (grapheme brackets) → UTF-8 bytes (hex and dec) → pre-tokenizer chunks → BPE merges one at a time → tokens with ids. Default example 台灣台南. | Six-stop pipeline rail (05 §2); merge steps are first-class data (03 §B.6); no backend anywhere; BYOK calls go browser → provider. |
| OD-2 | UI languages zh-TW, ja, en. | Three catalogs, typed keys, CJK font stacks, text-language chip separate from UI locale (05 §9). |
| OD-3 | Smooth, performant transitions; responsive 360 px → 4K; keyboard + mouse + touch first-class; dark and light; visualize char ↔ UTF-8 (hex, dec) ↔ token alignment including partial-character tokens. | Transform/opacity-only animation on atomic grid cells (05 §11); APG layout-grid keyboard model (05 §12); hatched partial edges and per-byte sliced char backgrounds (05 §6). |
| OD-4 | Tokenizer set: OpenAI o200k_base (primary) + cl100k_base; Anthropic legacy Claude 1/2 65k ("not the Claude 3+ tokenizer") + opt-in BYOK `count_tokens`; ctok out of v1; Google Gemma 4 262k (primary; = Gemini 2.0–3.5; Gemini 4 inferred) + Gemma 1/2 256k (Gemini 1.x, Gemma Terms notice); Meta Llama 4 / Muse 202k from Muse Glimmer (primary; Muse Wonder inferred) + Llama 3.x 128k ("Built with Llama" notice); xAI Grok-2 131k (primary; xAI Community License: Agreement copy, exact notice, prominent "Powered by xAI") + Grok-1 (historical). | Nine `TokenizerId`s (03 §B.1); `requiredNotices` per tokenizer rendered while selected (05 §15); `fidelity` = `reconstruction` reserved for Phase 2 ctok. |
| OD-5 | BYOK live-check panels: Anthropic `count_tokens` (totals; `anthropic-dangerous-direct-browser-access: true`) and xAI `/v1/tokenize-text` (real token bytes). Keys stay in memory only. | 05 §14; CSP `connect-src` limited to the two hosts; header names/versions are data in `byok.json` (AD-24). |

## B. Planner decisions (PD)

| Id | Decision | Rationale (research) | Consequences |
|---|---|---|---|
| PD-1 | Svelte 5 + Vite + TypeScript. | §8.9 recommended default; small runtime; plain assets-only deploy. | Runes only; no SvelteKit (router/`__data.json` not needed for two pages). |
| PD-2 | Own tokenizer engines: byte-level BPE with tiktoken semantics **and** SentencePiece BPE with byte fallback, so merge steps and byte spans are first-class; validated against committed golden fixtures and in CI. | §4.2: no library exposes merge steps or byte offsets; two independent 45-line cores reproduced tiktoken/HF ids after the `\s` and `(?i:)` fixes. | 04 §1–4; `@tsbs/conformance` runs on every PR and inside `vocab:build` (AD-14). |
| PD-3 | Plain-text semantics for special-token strings by default, toggle to match them. | §5.2 semantics policy; fixtures use `encode_ordinary` / `add_special_tokens=False` / `encode_special_tokens=True`. | `EncodeOptions.specialTokens: 'as-text' \| 'match'`; `idsWithSpecials` fixtures test the toggle. |
| PD-4 | Character tier = code points with grapheme-cluster brackets (`Intl.Segmenter`). | §7.2; `Intl.Segmenter` Baseline widely available since 2026-10-16. | `CharTable` is per code point; `GraphemeTable` with `source: 'segmenter' \| 'fallback'`; fallback = one grapheme per code point (every array stays well-formed, `count` is never −1) and the UI hides the brackets because `source === 'fallback'`, not because of a magic value. |
| PD-5 | Browser floor Safari/iOS 16.4+; no inline regex modifiers; no WASM in the critical path. | §8.10; `(?i:)` lands in Safari 26; `DecompressionStream('gzip')` is in Safari 16.4. | Expanded `(?i:)` alternations (04 §2.2); `esbuild.supported['regexp-modifiers'] = false`; `<dialog>` not Popover; View Transitions and CSS anchor positioning are progressive. |
| PD-6 | `confirmed / inferred / legacy` fidelity badges per model mapping, data-driven. | §8.11. | `models.json` rows with `evidenceUrl` + `checkedOn`; `reconstruction` added as a reserved fourth status (AD-23). |
| PD-7 | One tokenizer resident at a time by default; lazy, cached loading in a Web Worker. | §9 mobile memory risk; §6.5 item 5. | Strict unload-before-build (AD-19); Cache API LRU (03 §C.6). |
| PD-8 | workers.dev first; Cloudflare Workers static assets (not Pages); per-file assets < 25 MiB; compact derived vocab assets; licence/provenance page generated from `tools/oracle/manifest.json`. | §6.1–6.3, §6.5. | `wrangler.jsonc` per §6.1 (06 §5); `tsbs-vocab guard` (03 §C.8); About page generated (05 §15). |

## C. Architect decisions (AD)

Each entry: **Decision** / Alternatives rejected / Rationale / Consequences.

### AD-1 Base document and grafting policy
**Decision.** The experience proposal is the backbone (UX, SoA data model, precomputed examples, `packRows`, two-layer FLIP cells, waves). The correctness proposal's engine and governance spine is grafted wholesale. The performance proposal's runtime data structures, budgets and CSP discipline are grafted as mandatory.
*Rejected:* any single proposal as-is. *Rationale:* all three judges ranked experience first and named the same grafts. *Consequences:* the sections below record every grafted contradiction explicitly.

### AD-2 Toolchain pins: Node 24.21.0, pnpm 10.11.1 (exact)
**Decision.** `.node-version` = `24.21.0`, `packageManager` = `pnpm@10.11.1`, `engines.node ">=24.21 <25"`.
*Rejected:* experience's Node 24.11.0 / pnpm 10.20.0 (diverges from the Workers Builds defaults in §6.2 for no benefit). *Rationale:* parity with the platform image keeps a Workers Builds fallback free. *Consequences:* `onlyBuiltDependencies` lists `esbuild`, `workerd`, `@parcel/watcher`; developers on pnpm 12 are auto-switched by `manage-package-manager-versions`.

### AD-3 CI/CD on GitHub Actions only; Workers Builds not connected
**Decision.** All gates (lint, typecheck, conformance, three-browser Playwright + axe, header-dependent E2E on `wrangler dev`, Lighthouse CI against the deployed preview, size guards) run in Actions; `cloudflare/wrangler-action` deploys the `dist` artifact that `ci` tested, triggered **only** by `workflow_run` of `ci` on `main` (never also on `push`, which would double-deploy); PR previews via `wrangler preview --name pr-<n>` (needs wrangler ≥ 4.135, §6.1; the repo pins one exact wrangler version, `4.152.x` today, in 02 §3).
*Rejected:* Workers Builds (1 concurrent build, 20-min cap, no browsers; would create an ungated second deploy path). *Consequences:* one-time account setup (register the `workers.dev` subdomain, create a Workers Scripts: Edit token) documented in `docs/release.md` (06 §7); repo secrets `CLOUDFLARE_API_TOKEN` and `CLOUDFLARE_ACCOUNT_ID`; repository variable `CONFORMANCE_MODE` (AD-32); branch protection on `main` requires `ci`.

### AD-4 Unicode pinned to 16.0 with tables exported from the id oracles' class probe
**Decision.** `tools/oracle/export_unicode_tables.py` enumerates `\p{L} \p{N} \p{Lu} \p{Lt} \p{Lm} \p{Lo} \p{Ll} \p{M} White_Space` with the tiktoken 0.14.0 / HF tokenizers 0.23.3 class probe (Unicode 16.0), cross-checked against the regex module (Unicode 18.0 per its metadata), and writes `tools/oracle/unicode_tables.json` (committed; 677 `L` / 144 `N` / 10 `White_Space` ranges, plus the `ccc` and `NFKC_QC` tables of 03 §B.4). WP02 converts it to `packages/core/src/unicode/tables.generated.ts` (committed; 5.7 KB brotli was measured for all nine classes on an earlier 694-range `regex` export, so the probe tables are smaller). `pnpm unicode:check` fails CI if the export drifts. Patterns never use native `\p{…}` at runtime.
*Rejected:* performance's native `\p{…}` (contradicts the fact that the fixtures' chunks come from Unicode 16 tables while Node 26 and current Chrome are Unicode 17 — §3.1, §9; its 20–40 KB cost claim is contradicted by the 5.7 KB measurement); experience's `@unicode/unicode-16.0.0` npm tables (a second source of truth). *Consequences:* browser chunking is provably the oracle's; `TSBS_NATIVE_UNICODE=1` test flag reports parity against native classes; the About page shows "pre-tokenizer Unicode 16.0" and, informationally, the browser's detected level.

### AD-5 One shared agenda merge loop behind `PairPriority`
**Decision.** Both engines reduce to a doubly-linked part list plus a binary min-heap keyed `(priority, leftOffset)` with lazy invalidation (04 §1). `docs/adr/0003-agenda-equivalence.md` argues equivalence with tiktoken's linear "lowest rank, leftmost" scan; a fast-check property test compares `mergeAll` with a literal port of tiktoken's quadratic loop.
*Rejected:* per-engine loops. *Rationale:* a 10k-ideograph run is one regex chunk (`\p{Lo}+`), so O(m²) is 10⁸–10⁹ operations; one loop = one set of invariants. *Consequences:* `RankPriority`, `ScorePriority`, `MergeRankPriority` are the three providers.

### AD-6 Two literal SentencePiece priority providers; exact Gemma 4 merge table shipped
**Decision.** `ScorePriority` (Grok-1, Gemma 1/2: float32 piece scores from the `.model`) and `MergeRankPriority` (Gemma 4: HF `merges` ranks). The Gemma 4 asset ships the exact 514,906-merge list as section `MRGS` (per merge: zigzag-delta result id + `u8` split offset in UTF-16 units; measured 1,007 KB raw → 206 KB gzip), decoded at load into a CSR indexed by result piece. Both byte-fallback orders are implemented literally (HF before merging; SentencePiece after).
*Rejected:* performance's derived heap key `(scoreClass, −len(left), −len(right), id, pos)` with zero merge table as the primary path (one build-time assertion away from silent divergence; cannot show real HF ranks in the inspector; code-point vs byte length ambiguity); correctness's 20 MiB `Map<leftId·2^18+rightId, rank>` on the client. *Kept as guards:* performance's A2 regeneration check runs at build time and is recorded in `META.hfMergesRegenerable` (informational). *Consequences:* +206 KB gz for Gemma 4; `MergeRankPriority.priority(l,m,r)` = `csrLookup(idOf(norm[l..r)), m−l)`.

### AD-7 Scores are shipped, not derived
**Decision.** `PRIO` (zigzag-delta integer scores) is always written for score-priority models; `SCRF` (float32) replaces it if any score is non-integral. A1 ("NORMAL scores strictly decreasing with id") is asserted and recorded in `META.normalScoresMonotone` but the engine never relies on it.
*Rejected:* judges' suggestion to omit `PRIO` when A1 holds. *Rationale:* delta-coded consecutive scores gzip to < 5 KiB (experience measured "≈ 0" for Grok-1), so there is no payoff for a derived path and a literal provider is simpler to prove.

### AD-8 `ByteVocab`: byte-keyed open-addressing hash over the raw asset buffer
**Decision.** Both families look up byte slices with FNV-1a + linear probing over the decompressed `PCES` payload (offsets recomputed at load; subarray views; no strings). Targets: o200k ≤ 8 MB resident, ≤ 25 ms init in Node (×4 phone margin) — measured 5.2 MB / 7.8 ms vs 25 MB / 99 ms for `Map<latin1,rank>`.
*Rejected:* `Map<latin1 string, rank>` (correctness, experience). *Consequences:* the BOM gotcha (§4.2: 9 o200k ranks start `EF BB BF`) disappears because keys are bytes; `pieceOf(id)` decodes lazily with `TextDecoder({fatal:true, ignoreBOM:true})`.

### AD-9 Merge timeline = boundary born/died arrays + per-step arrays
**Decision.** `MergeTimeline` carries `boundaryBorn/boundaryDied` (O(bytes) scrub to any step, no replay; spm byte-fallback splits are boundary births) **and** per-step `stepLeft/stepMid/stepEnd/stepRank/stepResultId/stepChunk/stepKind` for the inspector sentence and the FLIP choreography. The fixture-native `[position, rank]` form is computed only in the test harness (Fenwick tree).
*Rejected:* storing `stepPos` in the shipped result. *Consequences:* zero-width leading part (Grok-1 dummy `▁`) uses boundary index 0, which is otherwise permanent (04 §1.4).

### AD-10 Vocab container `TSBV1`, pre-gzipped, opaque `.bin`
**Decision.** One self-describing little-endian section container (`META PCES TYPS PRIO|SCRF MRGS SPCL`), gzip-9 (zopfli when available) at build, served as `/tok/<id>/<sha12>.bin` with `Content-Type: application/octet-stream`, `nosniff`, `immutable`; decoded with `DecompressionStream('gzip')` in the Worker.
*Rejected:* edge compression of a text/JSON/protobuf asset (no `Content-Length` on compressed responses, §6.4; edge zstd-3/br-4 measured within 2–3 % of gzip-9 anyway); `.br` siblings in v1 (`DecompressionStream('brotli')` is Firefox 147 / Safari 18.4 only and absent in Chrome). *Consequences:* exact progress from `Content-Length`; SHA-256 over the exact wire bytes; manifest field `encoding` allows `.br` siblings in v1.1 without a protocol change; first-deploy curl check (06 §7).

### AD-11 Vocab manifest is bundled at build time
**Decision.** `vocab-manifest.generated.json` is imported by the Worker chunk (its hash becomes part of the JS hash); no runtime manifest fetch. The main bundle does **not** import it: the Worker's `ready` message carries an `AssetSummary` (`path`, `bytesCompressed`, `bytesRaw` per tokenizer, 04 §6) for the picker's wire-size column. Manifest `path`s are root-relative (`/tok/...`) and the loader resolves them against `self.location.origin` (03 §B.8/C.6).
*Rejected:* runtime `tok-manifest.json` with `must-revalidate`; a second manifest copy in the main bundle (≈ 1.5 KB br for data the Worker already has). *Consequences:* a 404 on a vocab fetch after a deploy means a stale client → "new version available, reload" (also wired to `vite:preloadError`).

### AD-12 Specials live in the asset (`SPCL`), in source order
**Decision.** Special-token tables (o200k 2, cl100k 5, Llama 3 256, Llama 4/Muse 2,048 Glimmer names, Grok-2 128, Claude 5, Gemma 4 24 CONTROL added tokens, Grok-1/Gemma 2 CONTROL pieces) are written to the asset from the upstream file in source order (leftmost-first alternation like Rust `regex`); the registry only names the BOS/EOS ids.
*Rejected:* hand-copied specials in registry JSON (a second source of truth that can drift).

### AD-13 Conformance inside the converter
**Decision.** `@tsbs/conformance` (`runFixture(fixture, tokenizer)`) is shared by engine tests and `tsbs-vocab build`; the converter refuses to write an asset whose in-memory tables fail the matching fixture. Modes: `--conformance strict` (the end state), `skip-missing-engine` (CI until both engines have merged, AD-32) and `off` (local-dev only, never in CI).

### AD-14 Registry = data, governed
**Decision.** `tokenizers.json`, `models.json`, `licences.json` (hand-written display strings), `licences.generated.json` (from the oracle manifest), `examples.json`, `byok.json`; zod schemas; `registry:check` with negative tests (missing evidence/date/locale string fails); `requiredNotices` rendered persistently while a tokenizer is selected; per-asset MODIFIED notices; `withdrawn: true` flag hides a tokenizer and makes the converter skip it (xAI revocability); a monthly workflow opens a "re-verify inferred mappings" issue for rows whose `checkedOn` is > 90 days old.

### AD-15 Strict CSP, no inline styles or scripts
**Decision.** `default-src 'none'; script-src 'self'; style-src 'self'; …` (06 §6). Grid placement uses 128 generated classes `.c1…c64` / `.s1…s64` (`grid-column: n / span m`; marker columns are full columns, AD-25, so no per-row template is ever needed); per-cell dynamic values (`--hue`) are set through the CSSOM (Svelte `style:` directives → `element.style.setProperty`, which `style-src` does not block). Svelte's `transition:`, `in:`, `out:` and `animate:` directives inject a runtime `<style>` element for keyframes and **would** violate the CSP, so an ESLint rule (`eslint-plugin-svelte` restricted directives / a 20-line custom rule) forbids them in `apps/web`; all motion is WAAPI (`flip.ts`). The 300-byte theme/locale bootstrap is compiled by a `bootScript()` Vite plugin into an IIFE `boot-[hash].js` injected as the first classic `<script src>` in `<head>` (02 §5; a Rollup input would become a deferred ES module and flash); the stylesheet is external. `fixture-types.ts` lives in `packages/core/src/fixture/` so `apps/web`'s import path is real.
*Rejected:* experience's `style-src 'unsafe-inline'`; performance's CSP hash pipeline for inline boot/hydration scripts (build complexity on the critical path). *Fallback:* if LHCI mobile LCP exceeds 2.0 s, inline the critical CSS with a build-time `sha256-` hash written into `_headers` (06 §6). *Verification:* `_headers` is a Cloudflare feature, so CSP tests run on `wrangler dev` and the preview URL (06 §4), with a dev-only `headersMiddleware()` replaying it in `vite dev`/`vite preview` as a convenience.

### AD-16 No SSR prerender in v1; precomputed examples carry first paint
**Decision.** Every example chip's result for every tokenizer is precomputed from the fixtures at build time and shipped as a compact fixture subset (`ExamplesWire`, 03 §C.7) that `fromFixtureCase` (shared with tests, pure, runs on the main thread) expands into a `TokenizationResult`. The default example on o200k is inlined in the main bundle (≤ 4 KB gz); the rest ship as lazy `examples/<tokenizer>.<hash>.json` (≤ 16 KB gz each; paragraph chips omit their merge timeline, which arrives with the live engine). Chips are the verbatim corpus texts (`chip.text === case.text`, enforced). The board reserves its height from the precomputed layout, so CLS ≈ 0 and the headline view is visible before any vocabulary byte arrives.
*Rejected:* performance's Vite SSR + per-locale prerendered routes + client redirect (critical-path complexity; extra first-visit RTT for the zh-TW/ja audience; the proposal itself lists it as a risk). *Fallback:* a build-time static HTML partial of the default board, only if WP13's LHCI run misses LCP ≤ 2.0 s with the budgets in 06 §3.

### AD-17 Byte-stable grid; the stage 2→3 morph is transform-only
**Decision.** Rows are packed **once** per `(result, K)` by code-point-safe `packRows` on byte columns, at every stage. At stops 1–2 each char cell's visual box is translated/scaled to a uniform `--cell` width and left-packed within its row (transforms only); at stop 3 the boxes expand to their byte spans and the byte tier unfolds beneath. Two-layer cells (`.cell-box` translate+scale, `.cell-glyph` translate only) keep glyphs undistorted.
*Rejected:* experience's stage-dependent column model (code-point columns before stage 3) — judged to complicate layout, keyboard anchors and virtualization; correctness's `scaleX` on a one-layer cell (distorts the id label). *Consequences:* keyboard anchors are always byte offsets; fixed row heights per breakpoint; `contain-intrinsic-size` known before paint.

### AD-18 Phone layout numbers
**Decision.** On `pointer: coarse` `--cell` is floored at 36 px (S → 36, M 36, L 40); fine pointers use ×0.9 / 1 / 1.15 of the breakpoint cell. K always comes from `clamp(8, floor((boardWidth − 2·gutter) / cell), 64)` (9 at 360 px). Row height 106 px below 480 px (bracket 6 · char 40 · byte 24 · token 28 · gaps 8; U+ labels, chunk brackets and 1–2-column ids move into the sheet), so every tappable cell is ≥ 24 px tall (WCAG 2.5.8: char 36 × 40, byte 36 × 24, chip 36 × 28, marker 36 × 28); 40 px / 44 px targets for example chips and the scrubber thumb; hex **and** dec rows at ≥ 1024 px, toggle below.
*Rejected:* performance's 26 px cells (contradicts its own ≥ 28×44 coarse-pointer rule); experience's 150/128 px rows (too few rows visible on a 360 px phone); the earlier 22 px byte tier and the `--cell/2` marker column (both below the 24 px minimum on coarse pointers).

### AD-19 Memory policy: strict one-resident
**Decision.** Switching tokenizers posts `unload` first (tables nulled), then `load`; the UI keeps the last result on screen until the new engine answers. `RangeError` during build is reported as `error.code = 'oom'` with a retry/back action; a Worker **crash** (hard OOM) is respawned and the `load` replayed **once per tokenizer** — a second crash on the same tokenizer surfaces `oom` with the back action instead of looping. `heapHint` is `null` in browsers (no API without cross-origin isolation) and measured only in the Node bench; WP07's acceptance is "tables nulled before `load` is posted" (test hook) plus the Node heap delta. Idle `prefetch` (download + cache, no build) of the lab's secondary tokenizer runs when `navigator.connection` is **undefined** (Firefox, Safari — otherwise prefetch would never run there) **or** `effectiveType === '4g'`, and never when `saveData` is set.
*Rejected:* experience's build-before-release (two residents momentarily; OOM risk on 3 GB phones); unbounded respawn.

### AD-20 Transport of results: struct-of-arrays, transferred
**Decision.** `TokenizationResult` is typed arrays (03 §B), transferred (not cloned) from the Worker; `TokenizationView` wraps it on the main thread with lazy per-cell accessors.

### AD-21 Worker cancellation and coalescing
**Decision.** `TokenizerClient` stamps a monotonically increasing `seq`; one encode in flight and one pending per client, intermediate keystrokes dropped; superseded or cancelled requests settle with the single name `cancelled` (wire and client); `cancel` carries `target` (the encode's reqId); an encode arriving during a load is queued and runs after `loaded`. **The agenda loop is resumable** (`MergeState` + `mergeStep(state, budgetMs)`, 04 §1.1): a void `mergeAll` could not yield inside a chunk and for the primary audience a whole paragraph is one chunk, so cancellation is observed at every ≈ 4 ms slice regardless of input shape (`performance.now()` sampled every 256 pops); each slice posts `progress`, which the watchdog counts as liveness (two missed pongs while idle → respawn). The per-chunk result cache is bounded by **bytes** (≤ 2 MiB total, chunks ≤ 256 B only, hash keys) because a CJK paragraph is one chunk that never repeats — for CJK the per-keystroke cost is the whole-paragraph re-merge, which is why AD-27's tiers exist. Engine families are `import()`ed lazily inside the Worker.
*Rejected:* the earlier entry-count LRU (4,096 entries × unbounded chunk size ≈ GBs on CJK input) and `yieldEvery` as a step count on a void function.

### AD-22 Keyboard scheme
**Decision.** `[`/`]` previous/next stop, `,`/`.` previous/next merge step (`Shift` ×10), `1`–`6` jump to a stop, `Space` play/pause **only while the scrubber has focus** (the Play `<button>` takes Space natively; stops are radios in a `radiogroup`), `Home/End` first/last step, `h` hex/dec, `g` grapheme brackets, `t` picker, `/` focus textarea, `?` help, `i` focus the inspector panel, `c` copy; board = APG layout grid (05 §8). **WCAG 2.1.4**: a persisted "Single-key shortcuts: on/off" setting (default on; in the `?` dialog and About › Keyboard) disables every global single-key shortcut; component-scoped keys (arrows, Enter, Space, Esc, Home/End, PageUp/Down, `i`, `c`) are unaffected. **Key matching**: letters via `event.key` case-insensitively; punctuation and digits via `event.code` (`BracketLeft`/`BracketRight`/`Comma`/`Period`/`Digit1`–`6`/`Slash`), so `Shift+,` (whose `event.key` is `<`) and JIS layouts work.
*Rejected:* performance's `Alt+1…6` (Firefox tab-switch collision on Windows/Linux) and `Ctrl/⌘+K` (reserved by browsers/extensions in several locales); "ignored while focus is in an editable" as the 2.1.4 mechanism (speech-input users still trigger them).

### AD-23 Fidelity statuses
**Decision.** `confirmed | inferred | legacy | reconstruction`; `reconstruction` is reserved for the Phase-2 ctok lane and has no rows in v1.

### AD-24 BYOK facts are data with `checkedOn`
**Decision.** `byok.json` holds endpoint URLs, header names, `anthropic-version: 2026-10-21`, auth scheme default `Authorization: Bearer` with `x-api-key` as a selectable option (§3.2: Bearer is primary, x-api-key legacy), `anthropic-dangerous-direct-browser-access: true`, optional `anthropic-workspace-id` (400 explanation), the ZDR-CORS message, the model lists (Anthropic: Opus 5.5, Sonnet 5.5, Haiku 5.5, Opus 4.6, Sonnet 4.6; xAI default `grok-4.7`, also 4.6/4.5/4.3 — `grok-3`, `grok-4-0709`, `grok-4-fast-*` were retired 2026-05-15, §3.5) and the frame-token note (7/11/6, +2 on 5.5).
*Rejected:* correctness's `x-api-key` + `anthropic-version: 2023-06-01` defaults and its retired xAI slugs.

### AD-25 Zero-width tokens get a full marker column
**Decision.** A zero-width token (BOS, Grok-1 dummy `▁`) occupies a real **full-width** grid column (`--cell`, never `--cell/2`) rendered as a chip with an inline-SVG marker and an `aria-label` ("dummy prefix, 0 bytes"); it is a focusable grid cell with no negative margins, ≥ 36 × 28 on coarse pointers. Markers pack with the code point that follows them (`packRows` counts `markersBefore(i)`, which is 2 when BOS and the Grok-1 dummy both precede code point 0; a trailing marker on empty text gets the last column).
*Rejected:* the half-width column (below the 24 px WCAG 2.5.8 minimum on phones; incompatible with a uniform `repeat(K, var(--cell))` template and the generated `.c<n>` classes under strict CSP; made packing units ≠ layout columns).

### AD-26 Llama 3 ships; manifest flip is a WP00 task
**Decision.** WP00 sets `meta-llama3-model.shipIntent = "ship"`, rewrites its obligations from "if shipped" to active, adds the attribution package (`docs/licenses/meta-llama3-model/LICENSE` copy, "Built with Meta Llama 3" required notice, `Notice` text "Meta Llama 3 is licensed under the Meta Llama 3 Community License, Copyright © Meta Platforms, Inc. All Rights Reserved."), regenerates `docs/licenses/README.md`, and the converter's "refuse non-`ship` assets" rule then admits it. The oracle-only Xenova JSON remains a cross-check only.

### AD-27 Long input tiers
**Decision.** ≤ 2,000 code points: full board, full replay, `trace: true`. 2,001–20,000: rows virtualized (fixed heights, arithmetic windowing + `content-visibility: auto`), replay scoped to the focused chunk / a 2,000-byte window, `trace: true`. 20,001–100,000: live tokenization pauses behind a "Long input — tokenize on demand" banner; the counts line keeps **code points, graphemes and bytes live** (from `analyzeText`, no tokenizer needed) while **tokens and partial counts** show the last on-demand values with a "stale" badge once the text changes; the on-demand run tokenizes the **whole** text with `trace: { maxSteps: 50_000 }` and the board shows a **window (slice) of that full result** — 2,000 bytes around the caret — never a tokenization of the windowed substring (wrong for byte-level unless snapped to chunk edges, always wrong for SentencePiece's single global agenda); the scrubber covers the recorded prefix and the rail says "merge replay limited to the first 50,000 steps". 100,001–200,000: the same with `trace: false` (counts + windowed token strip). Beyond 200,000 code points the text is kept in the textarea but not analysed (`longInput: 'capped'`, banner); pasted text is never truncated. **Memory**: a result at the cap with `trace: false` is ≤ 25 MB (03 §B.0); the main thread releases the previous result before accepting one larger than 8 MB (no crossfade above that). `truncated` semantics (boundaries removed after `maxSteps` have `died = stepCount`, so `replay(timeline, stepCount)` still equals the final tokens) are FROZEN in 03 §B.2.
*Rejected:* "counts still live" for token counts (impossible without tokenizing); tokenizing the window substring.

### AD-28 Validation library
**Decision.** zod (dev/build/test only; never in the browser bundle). Registry JSON is imported as plain JSON with `satisfies` types at runtime.

### AD-29 Locale handling
**Decision.** Runtime switching; all three catalogs bundled (≈ 180 strings each, ≈ 7 KB br total); `<html lang>` and `data-theme` set by `boot.js` before first paint from `?lang`/`localStorage`/`navigator.languages`; no per-locale routes, no redirects.

### AD-30 Phase-2 boundaries (not in v1)
ctok reconstruction (fixtures `anthropic-ctok-*` are not consumed), `.br` siblings, custom domain, o200k_harmony specials, Gemma 3 `.spiece.model` shipping (Gemma Terms applicability unresolved; Gemma 4 JSON is the Apache-2.0 source, §3.3).

### AD-31 Gemma 4 piece types follow the HF JSON; the fixture's USER_DEFINED labels are provenance only
**Decision.** `fixtures/google-gemma4.json` labels 347 tokens (ids 107 `\n`, 108 `\n\n`, 138–144 `▁` runs, 255968 `\t`, 255969 `\t\t`) `USER_DEFINED` because its `type` field comes from the Gemma 3 proto, while the ids come from HF tokenizers, which has no USER_DEFINED pieces and reaches those tokens by ordinary merges. The converter derives Gemma 4 `TYPS` from the JSON (BYTE / CONTROL / UNK / NORMAL, never USER_DEFINED); conformance compares `type` for gemma4 only on the BYTE/CONTROL/UNK/other axis; the engine and `fromFixtureCase` both show these tokens as `TokenKind.Normal` (plain chip, no lock glyph); a negative test pins `tab-only`, `newline-pair`, `three-spaces`; About › Engine states the divergence (04 §8).
*Rejected:* regenerating the fixture with HF-derived types (loses the Gemma 3 cross-reference the oracle README documents, and would still need the rule for the Gemma 3 secondary oracle); reading the Gemma 3 `.model` in the converter to reproduce the labels (would make the engine pre-match pieces HF does not pre-match and break id conformance). *Consequences:* without this rule AD-13 would refuse to build the Gemma 4 asset and `vocab:build` could never pass.

### AD-32 Interim conformance gate until both engines exist
**Decision.** `vocab:build --conformance strict|skip-missing-engine|off`; CI uses the repository variable `CONFORMANCE_MODE`, set to `skip-missing-engine` from WP00 (conformance is skipped only for a family whose engine factory `@tsbs/core` does not export, with a visible warning) and flipped to `strict` by the PR that lands the second engine (WP05A or WP05B, whichever merges last); WP11 adds a check that fails CI if both factories exist and the mode is not `strict`; `off` is local-only.
*Rejected:* a red `vocab`/`build` job for the whole of wave 1 (contradicts "main deployable from wave 1" and WP00's acceptance); decoupling `build` from `vocab` (would ship a `/tok` directory the manifest does not describe).

### AD-33 One owner for the agenda loop: WP01
**Decision.** `core/agenda` (heap, part list, `MergeState`/`mergeStep`/`mergeAll`) and the `TraceRecorder` move to WP01 (wave 1): they are pure, need no vocabulary, and are proved by the fast-check "quadratic reference" property. Both engines consume the merged, frozen loop in wave 2 and never edit it.
*Rejected:* co-ownership by WP05A and WP05B (two parallel agents editing the one module both correctness proofs rest on).

### AD-34 Inspector surface by viewport width only; non-modal region everywhere
**Decision.** ≥ 1024 px: a panel in the side rail; 768–1023 px: an anchored panel beside the active cell; < 768 px: a bottom sheet (collapsed 56 px / expanded 40 vh with an `aria-expanded` button; dragging optional). Pointer type never selects the surface. In every surface the inspector is `role="region"` with `aria-labelledby`, non-modal, never `inert` on the board; content follows keyboard focus (immediately) and hover (120 ms, stays open while hovered, Esc closes — WCAG 1.4.13); Enter/Space pins and announces; `i` moves focus into the panel, Esc returns, second Esc unpins. The board's scroll container uses `scroll-padding-block-end: var(--sheet-height)` and `scrollIntoView({ block: 'nearest' })` on every focus move so the focused row is never under the sheet (WCAG 2.4.11).
*Rejected:* the three contradictory thresholds of the previous draft (1024 / 768 / pointer-based); `role="tooltip"` (forbids the interactive copy / "show this step" controls) and `role="dialog"` with `inert` (makes arrowing through the grid while pinned impossible).

### AD-35 Non-colour cues are the border and the hatch, with measured 3:1
**Decision.** The 1 px `--border` (light L ≤ 0.50, dark L ≥ 0.72) is the WCAG 1.4.1/1.4.11 conformance cue and must be ≥ 3:1 against all 16 tints and 4 surfaces; the partial hatch is two-tone (`--fg` stripe + chip hue, so ≥ 3:1 on its tint by construction); the focus indicator is a double ring (2 px `--bg` halo + 2 px `--accent`, accent light L 0.50 / dark 0.75, painted above neighbours); adjacent tints differing by ≥ 45° hue and ≥ 0.07 L is informational only. `check-contrast.mjs` asserts exactly these pairs in CI (05 §11).
*Rejected:* the previous draft's "adjacent chips ≥ 3:1 lightness" claim (tints at L 0.90/0.83 give ≈ 1.25:1; L 0.30/0.38 ≈ 1.36:1) and borders at L 0.75/0.40 (≈ 1.1–1.7:1 against the tints).

### AD-36 Semantic markers are inline SVG with text alternatives; stand-ins use a bundled subset font
**Decision.** Continuation marks, the zero-width marker, the split hatch mark, the lock, the Byte icon and the merged star are inline SVG (`aria-hidden`) with visually hidden localized labels or cell `aria-label`s (05 §4, §10); whitespace/control stand-ins (`␠ ⇥ ⏎ ␍ ⍽ ⟨⟩`) render in a ≤ 4 KB subset WOFF2 served from `'self'` and listed first in the stand-in font stack, also with text alternatives; combining marks render on an `aria-hidden` U+25CC dotted-circle base.
*Rejected:* raw text glyphs from Supplemental Arrows-B / Control Pictures / Block Elements (tofu on Android and many Windows configurations; read literally by screen readers).

### AD-37 Loader trusts bytes, not headers; manifest carries both hashes
**Decision.** After download the loader sniffs the payload: `1F 8B` → gunzip and verify `sha256` (of the compressed file); `TSBV` → use as-is and verify `sha256Raw` (of the container); anything else → `format` error. `Content-Encoding` is only logged (`loaded.contentEncoding`, `loaded.layer`) and only means "no `Content-Length`" for the progress denominator. Manifest `path`s are root-relative and resolved against `self.location.origin`; the absolute URL is the Cache API key. When `crypto.subtle` is absent (insecure context) verification is skipped and `features.subtleCrypto = false` is shown on About.
*Rejected:* the previous draft's "skip DecompressionStream when `Content-Encoding` is present" (inverted: if the edge adds its own layer the browser strips only that and the bytes are still our gzip; skipping would feed `1F 8B` to the reader) and the alternative "always gunzip" (fails the transparently-decoded case and the sha256 mirror case).

### AD-38 Registry types that the data actually needs
**Decision.** `ModelRow.tokenizer: TokenizerId | null` with `byok` required and `fidelity: 'unavailable'` when null (Claude 3+ rows); `ExampleChip` carries `fixtureCase`, a `text` that must equal the case text byte-for-byte, an optional `label` for paragraphs and `lang: TextLangChoice`; `TextLangChoice` (`auto | zh-Hant | ja | en`, what the chip offers) is split from `ResolvedTextLang` (`zh-Hant-TW | ja | en | ko | und`, what goes into `lang` attributes); `registry:check` enforces each rule.

### AD-39 Performance numbers have one home
**Decision.** 06 §3 holds every CI-asserted ceiling; 03 C.2, 04 §2.1/§3.2 and the WP rows quote those exact values (phone init o200k ≤ 100 ms / Gemma 4 ≤ 160 ms; 10k-CJK encode ≤ 15 ms bytelevel / ≤ 20 ms spm in Node; Lighthouse "Slow 4G" for LCP; Playwright CDP "Fast 4G" 9 Mbps / 170 ms for the 4 s load budget). Budget sums are consistent: document 14 + script 85 + stylesheet 20 + font 4 = 123 KB excluding the vocabulary, `other ≤ 1,100 KB` for the `.bin`.

## C.2 Reviewer notes (findings applied differently or not applied)

- **Loader `Content-Encoding` (two findings disagreed).** One asked for content sniffing + `sha256Raw`, the other for "always gunzip, verify the exact bytes". Adopted the first (AD-37): it is the only rule that loads correctly in all three cases (plain, edge-recompressed, transparently decoded) and keeps integrity on whichever layer arrived.
- **`byteToChar` removal / float32 `stepRank`.** Adopted `Float32Array` for `stepRank` (ranks < 2²⁴ and integer scores are exact). Kept `byteToChar`: it is 4 B per input byte, and removing it would push a binary search into every hover/keyboard move on the main thread; the memory figure in 03 §B.0 was corrected instead.
- **Second manifest copy in the main bundle.** Not adopted; the `ready.assets` summary (AD-11) gives the picker what it needs without duplicating data.
- **Gemma 4 fixture regeneration (option b).** Not adopted; AD-31 explains why the HF-derived types with an axis-limited comparison are the truthful choice and need no oracle change.
- **"K = 50 at 2559 px".** Depends on whether the 1600 px board cap includes gutters; the design defines the cap as the board container width (gutters inside), so K = 49 once the cap binds. The formula, not the number, is normative.
- **WP13 split.** Kept as one L package with an explicit note to split into integration/launch if a second agent is available, rather than pre-splitting with an artificial interface.
- **Examples budget.** The 12 KB gz figure was unmeetable as the finding showed; rather than only re-budgeting, the wire format was changed to the compact fixture subset (03 §C.7), which is what `fromFixtureCase` needs anyway, and paragraph timelines were dropped from the precomputed set. 16 KB is a ceiling to be replaced by WP03's measurement.

---

## E. Planner review amendments (2026-10-25, after reading the final design)

These override the matching text elsewhere in `docs/design/` and are binding for every work package.

- **PA-1 Toolchain pins (supersedes AD-2's version numbers).** Node `26.12.1` (`.node-version`; `engines.node ">=26 <27"`), pnpm `12.14.0` exact in `packageManager`; CI uses `actions/setup-node` with `node-version-file: .node-version`. Rationale: Workers Builds is not connected (AD-3), so parity with its image buys nothing; the development machine runs Node 26.12.1 / pnpm 12.14.0; Node 26 is the active LTS. `onlyBuiltDependencies` and the rest of AD-2 stand. Node 26 = Unicode 17 ICU, irrelevant because production never uses native `\p{…}` (AD-4).
- **PA-2 CSP and Svelte, two gotchas.** (a) Svelte 5 instantiates static markup by cloning template HTML, so a static `style="…"` attribute is an inline style that `style-src 'self'` blocks: the `apps/web` lint config also forbids static `style` attributes (`svelte/no-inline-styles`); dynamic values go through `style:` directives (CSSOM) or classes. (b) `headersMiddleware()` applies the CSP only in `vite preview` (production bundle); in `vite dev` Vite/Svelte HMR inject `<style>` elements and would be blocked, so dev replays every `_headers` line except `Content-Security-Policy`.
- **PA-3 Parallel implementation process.** Each work package is implemented by one Opus agent in its own git worktree on a branch `wp/<id>-<slug>` cut from the current `main`, committing there (conventional commit messages). A reviewer agent verifies the package's acceptance criteria on that branch before merge. An integrator merges a wave's branches into `main` in dependency order, resolves conflicts (`pnpm-lock.yaml` conflicts are resolved by re-running `pnpm install`), and runs `pnpm lint && pnpm typecheck && pnpm test && pnpm build` after every merge; `main` must be green at the end of every wave. Agents edit only the paths in the ownership map (02 §8) plus the root `package.json` scripts and lockfile entries their own package needs.
- **PA-4 Phase 0 cleanup (folded into WP00's oracle lane).** Delete `docs/licenses/google-gemma2/gemma-terms-of-use.html` (raw page HTML carrying third-party analytics ids and feature flags); keep the extracted `gemma-terms-of-use.txt` as the evidence, keep the HTML's recorded sha256 and retrieval date in the manifest with `snapshot: false`, and teach `fetch_vocab.py` not to require a snapshot for such an entry.
- **PA-5 CI ramp.** The 06 §4 matrix (three browsers × shards, devices, LHCI) is the target state. WP11's first version may run chromium-only functional E2E plus `e2e-headers`; firefox/webkit, device projects and LHCI are added in WP11's wave-3 pass. `main` stays green throughout.
- **PA-6 Repository documents.** WP00 adds a root `README.md` (what the site is, how to run, architecture pointer) and the project `LICENSE` once the owner picks it (07 §6 question 6); third-party notices stay in `docs/licenses/` and on the About page.

## D. Owner answers to the open questions (2026-10-25)

All five questions in `07-implementation-plan.md` §6 were answered by the owner on 2026-10-25; the design's defaults stand:

| # | Question | Answer |
|---|---|---|
| 1 | xAI notice year / commercial status | "Copyright © xAI 2026"; the site is non-commercial. |
| 2 | Gemma Terms pass-through for Gemma 1/2 | Keep Gemma 1/2; a visitor-facing Terms section on About (Notice sentence, §3.2 restrictions statement, Prohibited Use Policy link, Terms copy) is the mechanism. |
| 3 | OpenAI `.tiktoken` rank files | Redistributed on the basis of tiktoken's MIT licence, with the disclosure on About. |
| 4 | `@anthropic-ai/tokenizer` licence metadata conflict | Ship both the MIT and the Apache-2.0 text plus the modification notice. |
| 5 | Native-speaker review | The owner reviews the zh-TW catalog at the launch checkpoint; ja ships as drafted with an invitation for corrections on About. |
| 6 | Project licence and repository | Our own code is MIT (`LICENSE`, © 2026 Han Lin); public GitHub repository `hotdogee/tokenize-step-by-step`; GitHub Actions is the CI/CD (AD-3). Git commits and `wp/` branches are authorised (PA-3). |

Everything else raised in the review round was decidable by the architect and is recorded in AD-31 … AD-39, the reviewer notes above and the planner amendments in §E.
