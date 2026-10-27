# 06 — Quality, CI and deployment (area F)

*Binding for WP11 (quality harness and delivery), WP12 (fuzz and perf) and WP13 (launch). Research citations are to `docs/research/01-tokenizers-and-platform.md`.*

## 1. Test strategy

| Layer | Tool | Scope | Gate |
|---|---|---|---|
| Unit (core) | Vitest, Node env | `analyzeText` (UTF-8/UTF-16/grapheme offsets, lone surrogates, Segmenter fallback `source`); varint + TSBV1 round trips + negative formats (bad magic, truncated, unknown version, UNUSED ≠ 0); `ByteVocab` (collisions, non-UTF-8 keys, the 9 BOM-prefixed o200k keys, all entries round-trip, PCES copied so the container buffer is collectable); pattern expansion per alternative on hand-picked strings (ſ, U+0085, U+FEFF, U+001C, U+2028, U+3000) **and** the new corpus cases (`ws-bom-mid`, `nel-after-space`, `nel-before-letter`, `fs-control`, `contraction-upper`, `contraction-long-s`, `contraction-dont-upper`); in-context `rule[c]` detection (a lone tab before a letter on claude-legacy, a lone space before a digit on o200k → final `\s+`); agenda vs quadratic reference; `mergeStep` slices ≡ `mergeAll`; `NEVER`/`ALIVE` sentinels and `trace.maxSteps` truncation (replay at `stepCount` equals final tokens); alignment walk; prefix matcher; NFKC segment source map on all 152 `normalizedNFKC` cases; timeline replay ↔ fixture `[position, rank]` both ways; `packRows` properties incl. BOS + dummy double marker and trailing marker; `fromFixtureCase` round-trips every fixture case (and its `ExampleCaseWire` form) through the invariants; `tab-only`/`newline-pair`/`three-spaces` on gemma4 are `Normal` (AD-31); Grok-1 `zh-tw-tainan` `splitChars === 1`; chunk cache byte bound (≤ 2 MiB, > 256 B never cached) | every PR; core line coverage ≥ 90 % |
| **Conformance** | `@tsbs/conformance` in Vitest | all 9 shipping fixtures × all cases (374 today) × all assertions (04 §7) against (a) tables from raw files via the dev loaders, (b) the built `.bin`; plus the research-anchor literals | every PR (raw vocab from the CI cache) |
| Property | fast-check | B.3 invariants on random Unicode for every tokenizer; agenda equivalence; both spm fallback orders agree; `packRows` | 1,000 runs per PR; 20,000 nightly |
| Fuzz vs oracles | Node script (`pnpm test:fuzz`) | 04 §7 oracle table; 2,000 strings/tokenizer with a fixed seed when `packages/core/src/{engines,agenda,unicode}/**` change; 10,000 nightly with a date seed; failures saved to `fixtures/candidates/*.json` and an issue opened | path-filtered + nightly |
| Unit (web) | Vitest + happy-dom + `@testing-library/svelte` | state reducer (seq drop, coalescing, focus persistence by byte offset, pending encode across a load, `cancelled` naming); URL serialisation; i18n completeness (3 locales, no unused keys) **and** every template rendered in all three locales with sample params (no leftover `{…}`, named placeholders only); number formatting (ids/ranks/offsets never grouped; counts grouped); registry zod validation incl. negative tests (null-tokenizer rows need `byok`; `chip.text === case.text`); shortcut key matching by `event.code` (`Comma`+Shift, JIS layout fixtures) and the "Single-key shortcuts: off" setting; inspector sentence builder; palette contrast script (05 §11 contract) | every PR |
| Component | Vitest browser mode (chromium via Playwright provider) | board renders the 05 §4.1 hard cases from fixture results with DOM assertions (sliced backgrounds, two-tone hatched edges, full-column marker cell with `aria-label`, SVG continuation marks + `frag-<spanId>` descriptions, combining mark on a dotted-circle base); **K asserted from the §3.3 formula at 360/768/1024/1440/3840 px container widths** (never literals); `aria-rowindex`/`aria-colindex`/`aria-colspan` on mounted rows/cells; virtual window keeps the focused row mounted and focus is restored after remount; keyboard grid state machine on a 3-row fixture (`↑` on top tier / `↓` on bottom tier are no-ops); inspector `role="region"`, `i` moves focus in, Esc returns, second Esc unpins; FLIP cancels on rapid scrub (`document.getAnimations()` empty); reduced-motion switch (incl. `scrollIntoView` behavior `auto`) | every PR |
| Browser parity | Playwright harness page | `compilePattern` chunk test on all fixture texts in chromium/firefox/webkit; `DecompressionStream('gzip')` + `readTsbv1` of the o200k `.bin` in webkit | every PR |
| E2E (functional, against `vite preview` + `headersMiddleware`) | Playwright: chromium, firefox, webkit (1440×900), `Pixel 5` (chromium 393×851), `iPhone 12` (webkit 390×844), plus **320×568** (reflow), 360×780 and 2560×1440@2× viewports on chromium | first paint shows the precomputed default with `/tok/*` blocked; load o200k and type (ids in DOM = fixture); stop 2→3 morph; keyboard scrubbing (`[` `]` `,` `.` `Space` on the scrubber, `Home` `End` `1`–`6`) and the same with "Single-key shortcuts: off" (letters/punctuation inert, arrows/Enter/Esc unaffected); partial token on cl100k 灣 (hatched edge + inspector sentence); Grok-2 4242 crossing case; Grok-1 marker cell (full column, `aria-label`); **Gemma 2 (or Grok-1) `<0xF0>` shatter step at stop 5; Gemma 4 `𰻝` already shattered at stop 4 with four Byte chips**; hex/dec/both; tokenizer switch with phased progress and strict one-resident (`pong.resident`); theme + locale (`lang` attributes change; in zh-TW the UI label and a glyph cell resolve to the same TC `fontFamily` on the `fonts-noto-cjk` image); About notices (Powered by xAI visible iff Grok-2 selected); BYOK with `page.route` mocks (success, 401, 400 workspace, 429, CORS failure → ZDR text; misaligned `token_bytes` → unaligned strip; key absent from `localStorage`/`sessionStorage`/IndexedDB/URL); IME composition via CDP `Input.imeSetComposition` (chromium) **and** Firefox/WebKit event-order sequences (`compositionend` then `input isComposing:false`); long-input tiers (banner at 20,001 code points, "stale" badge after an edit, windowed board is a slice of the full result — ids at the window edge equal the whole-text fixture, `trace: false` above 100,000, cap banner at 200,001); reduced-motion emulation (zero transform animations, `scrollIntoView` with `behavior: 'auto'`, progress bar without transition); **second visit with `/tok/*` blocked at the network layer loads o200k from the Cache API** (chromium; there is no Service Worker, so an offline document reload is out of scope); **focus not obscured**: at 360 px the focused cell's rect never intersects the sheet or the sticky header rects while arrowing through the whole board (WCAG 2.4.11); **reflow**: at 320 px `document.documentElement.scrollWidth <= 320` for the page chrome (`[data-reflow-exempt]` on the board, which claims the 1.4.10 two-dimensional exemption); zh-TW and ja notices strip / inspector / help copy has no horizontal overflow at 360 px; touch targets ≥ 24 × 24 on the Pixel 5 project (every focusable board cell and control) | every PR, 3 shards |
| E2E (headers, against `wrangler dev --assets apps/web/dist`; in the `preview` job against the `wrangler preview` URL) | Playwright chromium | CSP header exactly as §6 and **zero console CSP violations** on `/` and `/about/`; `boot.js` ran before first paint (`lang`/`data-theme` set in the first `DOMContentLoaded` snapshot); `/tok/*.bin` → `Content-Type` exactly `application/octet-stream`, `X-Content-Type-Options: nosniff`, `Cross-Origin-Resource-Policy: same-origin`, `Cache-Control … immutable`, no `Content-Encoding`, `Content-Length` present; `/index.html` → `/`; `/nope` → `404.html` with 404; `/.env` → 404 | every PR (`e2e-headers` job) and every preview |
| Accessibility | `@axe-core/playwright`, WCAG 2.2 AA tags | every page/state above × 3 locales × 2 themes; manual NVDA + Firefox and VoiceOver + Safari script (`docs/a11y-checklist.md`) once per release. The checklist carries the criteria axe/Lighthouse cannot detect as **manual items**: 2.1.4 Character Key Shortcuts (setting works, Esc/arrows unaffected), 2.4.11 Focus Not Obscured (sheet, sticky header), 2.5.7 Dragging Movements (sheet button, scrubber keyboard), 2.5.8 Target Size (coarse-pointer table in 05 §3.3), 1.4.10 Reflow (page chrome at 320 px; board exemption recorded), 1.4.13 Content on Hover (inspector hoverable + Esc-dismissible) | zero violations (axe); release (manual) |
| Visual | Playwright `toHaveScreenshot` (chromium on Linux with `fonts-noto-cjk`) | 4 fixtures × 2 themes × 3 viewports (360/768/1440), `maxDiffPixelRatio 0.002` | every PR |
| Performance | `@lhci/cli` mobile preset + `budgets.json` against the deployed preview URL; Playwright CDP trace while typing 10k chars (no main-thread task > 50 ms); Worker heap check (500 keystrokes into a 10k-CJK paragraph grow the Worker's memory by < 10 MB — Node harness, `process.memoryUsage()`); `vitest bench` for engines/vocab with a ×4 phone margin | §3 budgets | LHCI every PR (after `preview`); traces nightly (soft-fail with trend) |
| Security | CSP enforced in E2E; `pnpm audit --prod`; `knip` | — | every PR |
| Oracle | `pnpm oracle:check` (`fetch_vocab.py`, `make_corpus.py --check`, `gen_fixtures.py --check`, `render_license_docs.py --check`, `export_unicode_tables.py --check`, ruff) | fixtures and licence docs reproducible | on `tools/oracle/**`, `fixtures/**`, `docs/licenses/**` changes |

## 2. Definition of done (whole project)

1. All 9 tokenizers load, encode and pass their fixtures in CI (conformance) and in all three browsers (parity harness); nightly fuzz is green or every divergence is triaged as `oracle-divergence` or a fixture candidate.
2. The default example shows the full pipeline with scrubbing before any vocabulary byte arrives; the chips 灣/cl100k, 👩‍👩‍👧/o200k, 台灣台南/Grok-1, 𰻝/Gemma 4, ー+メ/Grok-2 exercise partial, multi-fragment, zero-width, byte-fallback and crossing rendering.
3. Keyboard-only and screen-reader walkthroughs pass the checklist; touch works on a 360 px device; dark/light; zh-TW/ja/en complete and reviewed.
4. Licence notices and fidelity badges render from data; About lists every shipped asset with verbatim text, sha256 and MODIFIED statements; "Powered by xAI" and "Built with Meta Llama 3" appear per the selection rule.
5. Deployed on workers.dev and the production custom domain (`tokens.hanlin.uk`, §5) with the §7 checklist signed off; budgets in §3 met on production.

## 3. Performance budgets (enforced, not aspirational)

| Metric | Budget | Enforced by |
|---|---|---|
| `dist/index.html` | ≤ 14 KB brotli | `size-limit`; LHCI `document ≤ 14` |
| Main JS (Svelte runtime + app shell + board + inspector + rail + motion ≤ 67; i18n chunk ≤ 9 (PA-10); inlined default rows ≤ 4 (five wires, PA-19; the result hub's Worker side, the client code and `PrecomputedExamples` arrive with the first load or lookup, not at startup); manifest summary ≤ 1 — PA-7; the wave 1 shell alone measured 55.92 KB) | ≤ 81 KB brotli (PA-17 amends PA-7's 80: the token ids' rendering) | `size-limit` |
| Worker core (loader + protocol + host) | ≤ 12 KB brotli | `size-limit` |
| Engine chunks (lazy inside the Worker; the bytelevel chunk **is** fetched during the Lighthouse trace because o200k starts loading after LCP) | bytelevel ≤ 16 KB br (incl. 5.7 KB Unicode tables); spm ≤ 10 KB br — each measured together with the shared `assets/engine-core-[hash].js` chunk that loads with the first engine (PA-8 addendum) | `size-limit` |
| CSS (incl. the stand-in + digits WOFF2 subsets as a separate `font` budget: 908 + 2,360 B, PA-17) | ≤ 20 KB brotli; font ≤ 4 KB of file bytes | `size-limit`; LHCI `stylesheet ≤ 20`, `font ≤ 6` as served (transfer size with response headers: the two WOFF2 responses measured 4,976–4,988 B on PR #1's preview) |
| `boot-[hash].js` | ≤ 0.5 KB | `size-limit` |
| `first-paint-[hash].js` (the static first paint's clone script, `/` only, classic, right after `#app`; PA-15) | ≤ 0.5 KB | `size-limit` |
| **Script total in the trace** (main 81 + worker 12 + bytelevel engine 16 + boot 0.5 + slack; PA-7) | ≤ 110 KB brotli-11 (engineering); LHCI asserts ≤ 143 KB as served by the edge (zstd / fast brotli, PA-14) | `size-limit` sums; LHCI `budgets.json` `script ≤ 143` |
| **Total excluding the vocabulary** (document 14 + script 110 + stylesheet 20 + font 4; PA-7) | ≤ 148 KB brotli-11; LHCI `total ≤ 1,300` as served (PA-14) | LHCI `total ≤ 1,300` with `other ≤ 1,100` (the o200k `.bin` lands in `other`; Lighthouse cannot exclude paths) and a Playwright network assertion that non-`/tok/*` initial transfer ≤ 148 KB |
| Lazy `examples/<tok>.json` | ≤ 16 KB gzip each (ceiling). Measured 2026-10-25 (zlib gzip-9, as `check:dist` computes it): o200k 6.4, cl100k 7.8, claude-legacy 7.9, gemma4 5.7, gemma2 5.6, llama4-muse 6.1, llama3 6.5, grok2 6.3, grok1 9.7 KB (largest) | `check:dist` |
| Default vocab (o200k) | 1,025 KB gzip (`other` bucket); **load trigger**: the client posts `load` after `document.fonts.ready` and two `requestAnimationFrame`s following `DOMContentLoaded`, so the Worker script, engine chunk and `.bin` never compete with the main bundle before LCP. The other rows' vocabularies (PA-19) load only on the first free-text edit, a row switch or the board's need (example texts are precomputed for all nine tokenizers), and an idle prefetch of the other default rows (Cache API only, no engine) starts 10 s after the load trigger unless `navigator.connection.saveData`, so the trace's `other` bucket keeps the o200k `.bin` alone | `check:dist` (per-asset gzip ≤ 1.7 MB unless whitelisted); E2E asserts the `/tok/*` request starts after the LCP entry |
| Vocabulary cache (Cache API, one loader per Worker) | LRU ≤ 9 tokenizers (every local one; PA-19 raises 03 §C.6's 3 so the five table rows never evict one another) or ≤ 12 MiB; the `/__tsbs-index` is advisory across Workers (03 §C.6 step 9) | `loader.test.ts` |
| FCP / LCP (LHCI mobile preset: Moto G Power class, 4× CPU, **Lighthouse "Slow 4G"** 1.6 Mbps / 150 ms RTT) | ≤ 1.5 s / ≤ 2.5 s (PA-18: 2.0 s until PR #1; the simulated LCP of the examples paragraph sits 0.5–0.8 s after FCP while the observed LCP equals the observed FCP) | LHCI assertions against the deployed preview |
| TBT / INP / CLS | ≤ 150 ms / ≤ 200 ms / ≤ 0.02 | LHCI + Playwright trace |
| Lighthouse scores (mobile) | Performance ≥ 95, Accessibility 100 (plus the manual checklist in §1 — axe/Lighthouse do not detect 2.1.4/2.4.11/2.5.7/2.5.8), Best Practices 100 | LHCI |
| Vocab init in the Worker (o200k / Gemma 4) — **single source**; 03 C.2 and the WP rows quote these | ≤ 25 ms / ≤ 40 ms in Node (bench) ⇒ ≤ 100 ms / ≤ 160 ms on the phone | `vitest bench` ×4 margin |
| Encode 10,000 CJK chars (one chunk) — **single source**; 04 §2.1/§3.2 and WP05A/B quote these | ≤ 15 ms (bytelevel), ≤ 20 ms (spm, every spm tokenizer) in Node; 20k single-chunk CJK ≤ 40 ms (bytelevel) | `vitest bench` |
| `encode()` ≡ `encodeIncremental()` | identical results on every fixture case; a 20k-CJK `encodeIncremental` yields ≥ 5 times | `vitest` |
| Keystroke → board update | p95 ≤ 50 ms at 1k chars, ≤ 120 ms at 10k (chromium trace) | nightly perf spec |
| Render 2,000 cells | ≤ 50 ms script; virtualize beyond | Playwright trace |
| Stop 2→3 morph | no main-thread task > 32 ms at ≤ 600 cells: the commit frame (keydown task to the end of the task that paints it) and every later task while the morph plays. The bound is per task; presented frames (compositor cadence) are not bounded — serial headless chromium shows rAF intervals of 33.5–50 ms during the same morph, a headless artefact that says nothing about Safari — so macOS Safari is checked by hand before launch (§7 item 9) | Playwright trace (desktop chromium); Safari Web Inspector timeline (manual) |
| o200k load end-to-end (Playwright CDP `Network.emulateNetworkConditions` **"Fast 4G": 9 Mbps down, 170 ms RTT**) | ≤ 2.5 s desktop / ≤ 4 s mid phone (1,025 KB ≈ 0.9 s on the wire + verify + gunzip + build) | perf spec (`loaded.ms`) |
| Resident memory per tokenizer (Worker) | o200k ≤ 8 MB; Gemma 4 ≤ 12 MB (PCES copy + offsets + hash + CSR; the container is released) | `vitest bench` (Node `process.memoryUsage().arrayBuffers` delta) |
| Worker heap growth while typing | 500 keystrokes into a 10k-CJK paragraph: < 10 MB growth (chunk cache ≤ 2 MiB; results are transferred) | Node harness in the nightly perf spec |
| Dist | any file < 20 MiB (hard; platform 25 MiB), ≤ 2,000 files, `/tok` total ≤ 12 MiB (warn), no dotfiles besides `.assetsignore`, `_headers` ≤ 100 rules | `check:dist` |

## 4. CI pipeline (GitHub Actions; AD-3)

```text
ci.yml  (push to main, pull_request; concurrency group cancels superseded PR runs)
  check      pnpm/action-setup (reads packageManager) · actions/setup-node 24 · pnpm install --frozen-lockfile
             lint · typecheck (tsc -b) · svelte-check --threshold error · format:check · knip · registry:check · unicode:check
  vocab      astral-sh/setup-uv · uv sync --project tools/oracle · restore data/vocab/raw (key = hashFiles('tools/oracle/manifest.json'))
             vocab:fetch (no-op on hit) · vocab:build --conformance ${{ vars.CONFORMANCE_MODE }} (AD-32: `skip-missing-engine` until WP05A and WP05B
             have both merged — the job prints a visible "CONFORMANCE SKIPPED for <family>" warning per skipped asset; the PR that lands the second
             engine flips the repository variable to `strict`, WP11 verifies) · tsbs-vocab guard · upload artifact data/vocab/dist
  unit       needs vocab · vitest (core, conformance on raw + .bin for the families whose engine exists, worker, registry, web units, components, browser-mode) · coverage
  build      needs vocab · vite build · check:dist (size-limit, guards) · wrangler deploy --dry-run · upload dist
  e2e        needs build · matrix [chromium, firefox, webkit] × 3 shards (+ Pixel 5, iPhone 12, 320/360/2560 projects) · playwright install --with-deps
             e2e (functional, vite preview + headersMiddleware) + axe + parity harness + visual · upload traces on failure
  e2e-headers needs build · wrangler dev --assets apps/web/dist (workerd applies _headers / html_handling / not_found_handling) · pnpm e2e:headers
  preview    needs build (pull_request only) · wrangler preview --name pr-<n> · comment the URL · run e2e:headers (E2E_PREVIEW=1) and deploy:smoke --preview against the preview URL
  lighthouse needs preview · lhci autorun --url <preview url> (lighthouserc.json budgets; real edge compression, _headers and HTTP/3)
  fuzz-smoke (only when packages/core/src/{engines,agenda,unicode}/** changed) · test:fuzz --seed fixed --n 2000
preview.yml  folded into ci.yml above (preview + lighthouse are ci jobs on pull_request); preview deleted on PR close by a `pull_request: closed` job
deploy.yml  (workflow_run: ci completed with success on branch main — the ONLY trigger, so a push never double-deploys)
             download the `dist` artifact that ci tested (no rebuild) · wrangler deploy · post-deploy smoke (§7 header checks) · LHCI against production (report only)
nightly-fuzz.yml (cron 03:00 UTC)   test:fuzz 10k × 9 · property 20k runs · perf spec · open an issue with seed + candidates on failure
oracle.yml  (paths: tools/oracle/**, fixtures/**, docs/licenses/**)   pnpm oracle:check
reverify.yml (cron monthly)   open "Re-verify inferred mappings" issue listing models.json rows with checkedOn > 90 days (GPT-6, Gemini 4 Argon, Muse Wonder, Grok 4.x) and the research §9 watch list
```

Caching: pnpm store (`pnpm-lock.yaml`), Playwright browsers (`~/.cache/ms-playwright` keyed on the Playwright version), raw vocab (manifest hash), uv cache. Required status checks on `main`: `check`, `vocab`, `unit`, `build`, `e2e`, `e2e-headers`, `lighthouse`. Target wall time ≤ 15 min. Secrets: `CLOUDFLARE_API_TOKEN` (Account › Workers Scripts: Edit, plus Zone › Zone: Read, Zone › DNS: Edit and Zone › Workers Routes: Edit on `hanlin.uk` for the §5 custom domain), `CLOUDFLARE_ACCOUNT_ID`; repository variable `CONFORMANCE_MODE` (`skip-missing-engine` → `strict`); Dependabot weekly grouped for npm, `pnpm audit` in `check`. **Interim gate (AD-32):** until both engines have merged, `vocab`/`unit`/`build` are green with the skipped-conformance warning, so `main` is deployable from wave 1 (the shell plus precomputed examples ship with whatever `/tok` assets already pass).

## 5. Deployment configuration

`wrangler.jsonc` (validated shape from research §6.1):

```jsonc
{
  "$schema": "./node_modules/wrangler/config-schema.json",
  "name": "tokenize-step-by-step",
  "compatibility_date": "2026-10-01",
  "assets": {
    "directory": "./apps/web/dist",
    "html_handling": "auto-trailing-slash",
    "not_found_handling": "404-page"
  },
  "routes": [{ "pattern": "tokens.hanlin.uk", "custom_domain": true }],
  "workers_dev": true,
  "preview_urls": true,
  "previews": {}
}
```

Custom domain (owner decision 2026-10-26, WP13b): `tokens.hanlin.uk` on the `hanlin.uk` zone of the same account (research §6.2). CI's `wrangler deploy` creates the DNS record and certificate and binds it, which needs the zone permissions of §4's token; `workers_dev` stays `true` for the PR preview URLs and as the fallback. `PRODUCTION_URL` moves to `https://tokens.hanlin.uk` once a CI deploy has attached it (docs/release.md § Custom domain). `.assetsignore`: `*.map`, `.vite/`, `.DS_Store`, `Thumbs.db`. `previews: {}` is what wrangler 4.15x requires before `wrangler preview --name pr-<n>` (the `preview` job) will publish a Preview; the block stays empty, since assets, compatibility settings and routes are read from the top level (found by PR #1, the first pull request).

## 6. `_headers` (`apps/web/public/_headers`; 5 path blocks / 12 header lines, limit 100 rules)

```text
/*
  X-Content-Type-Options: nosniff
  Referrer-Policy: strict-origin-when-cross-origin
  Permissions-Policy: camera=(), microphone=(), geolocation=()
  Cross-Origin-Opener-Policy: same-origin
  X-Frame-Options: DENY
  Content-Security-Policy: default-src 'none'; script-src 'self'; style-src 'self'; img-src 'self' data:; font-src 'self'; connect-src 'self' https://api.anthropic.com https://api.x.ai; worker-src 'self'; manifest-src 'self'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'
/assets/*
  Cache-Control: public, max-age=31536000, immutable
/examples/*
  Cache-Control: public, max-age=31536000, immutable
/tok/*
  Cache-Control: public, max-age=31536000, immutable
  ! Content-Type
  Content-Type: application/octet-stream
  Cross-Origin-Resource-Policy: same-origin
/licenses/*
  Cache-Control: public, max-age=86400
```

The `/tok/*` block removes any `Content-Type` the asset server derived from `.bin` **before** setting ours (`! Header` syntax, research §6.5), so the result is one exact value whether `_headers` appends or overrides — the smoke script and `e2e-headers` assert `Content-Type` equals exactly `application/octet-stream`. `_headers` is a Cloudflare feature: `vite dev`/`vite preview` do not read it (the `headersMiddleware()` plugin replays it locally as a convenience) and the authoritative checks run on `wrangler dev` and the deployed preview (§4). No `'unsafe-inline'` anywhere (AD-15): grid placement uses generated classes, dynamic values go through the CSSOM, the boot script and the stylesheet are external files. HTML stays on the platform default (`max-age=0, must-revalidate`; `/` has no ETag, §6.4 — hence the 14 KB budget). Query strings are ignored for asset lookup (§6.4), so every mutable resource is content-hashed. **Fallback** (only if LHCI mobile LCP > 2.0 s after WP13's tuning): inline the critical CSS and add its `sha256-…` to `style-src` via a build step that re-hashes in `check:dist`.

## 7. Release checklist (`docs/release.md`; signed off before the first production deploy and re-run per release)

**Pre-launch re-verification of inferred mappings** (research §9 watch list; update `models.json` `checkedOn` or flip statuses):
1. OpenAI: `tiktoken/model.py` and issue #608 / PR #616 for a `gpt-6` prefix → GPT-6 Astra / 6.1 Sol stay `inferred` or become `confirmed`.
2. Google: `python-genai/_local_tokenizer_loader.py` for `gemini-3.6/3.8/4-*` entries → Gemini 4 Argon.
3. Meta: Meta Model API docs / HF `meta-models` for a Muse Wonder tokenizer statement.
4. xAI: `xai-org` on HF/GitHub for any Grok 3/4 tokenizer file; `/v1/tokenize-text` docs example still reproduces with Grok-2; current model slugs in `byok.json`.
5. Anthropic: `anthropic-version` current value, `Authorization: Bearer` primary, still-callable v3-reference models (Opus 4.6 / Sonnet 4.6) in `byok.json`.

**One-time account setup** (before the first deploy; `docs/release.md`):
5a. Register the `tokenize-step-by-step.<account>.workers.dev` subdomain in the Cloudflare dashboard (Workers & Pages → account subdomain); create an API token with **Workers Scripts: Edit** (account-scoped; plus the zone permissions of §4 on `hanlin.uk` for the §5 custom domain) and add `CLOUDFLARE_API_TOKEN` + `CLOUDFLARE_ACCOUNT_ID` as repository secrets; set the repository variable `CONFORMANCE_MODE`; confirm `wrangler whoami` with the token in a dry run.

**Deploy verification** (curl against the production URL: `https://tokens.hanlin.uk` once attached, the workers.dev URL before):
6. `curl -sI -H 'Accept-Encoding: zstd, br, gzip' <largest /tok/*.bin>` → `200`, **no** `Content-Encoding`, `Content-Length` = `bytesCompressed`, `Content-Type` **exactly** `application/octet-stream` (one value, §6), `Cache-Control: … immutable`, `X-Content-Type-Options: nosniff` (research §6.5 item 7; record transferred bytes and the loader's `layer`/`contentEncoding` diagnostics in `docs/perf-log.md`).
7. `/assets/*.js` and `/examples/*.json` → `Content-Encoding` present (zstd/br/gzip), strong or weak ETag, `304` on `If-None-Match`.
8. `/` → CSP header exactly as §6; `/index.html` → 307 to `/`; `/nope` → `404.html` with status 404; no dotfile reachable (`/.env` → 404). A Workers Preview (`wrangler preview`) answers `/nope` with a platform "Not found" and status 404 — `not_found_handling` is not applied to Previews (observed on PR #1, 2026-10-27) — so the preview job's `e2e:headers` (`E2E_PREVIEW=1`) and `deploy:smoke --preview` check the status and content type only; production compares the body.
9. Lighthouse on the production URL meets §3; Safari 16.4 / iOS 16.4 smoke on BrowserStack (Playwright WebKit is newer than the floor); one mid-range Android Chrome run timed and recorded; a manual macOS Safari morph check (Web Inspector › Timelines, the stop 2→3 morph at 600 cells = 150 ideographs, longest frame and dropped frames recorded in `docs/perf-log.md`), since the §3 morph bound is measured per main-thread task in chromium only.

**Legal and content**:
10. About renders every `shipIntent: ship` asset; xAI notice sentence exact with the owner-confirmed year; "Powered by xAI" visible with Grok-2 selected; "Built with Meta Llama 3" + Notice; Gemma Notice + Terms copy + Prohibited Use Policy link; MIT texts; MODIFIED statements; owner sign-off on wording (07 §6 open questions resolved or defaults accepted).
11. Native-speaker review of zh-TW and ja copy complete; glossary applied.
12. Manual screen-reader script (NVDA + Firefox, VoiceOver + Safari) and a 360 px touch pass complete.
13. `oracle:check` and `unicode:check` green on the release commit; `vocab-manifest.generated.json` matches the deployed `/tok/*` listing; `CONFORMANCE_MODE` is `strict`.

Rollback = redeploy the previous commit (documented). Asset withdrawal (xAI revocation): set `withdrawn: true` in `tokenizers.json`, rebuild, deploy within one CI run; the About page states the withdrawal.
