# 02 — Repository, build and system architecture (area A)

*Binding for WP00 (scaffold) and every package owner. Decisions referenced as AD-n are in `00-decisions.md`.*

## 1. System diagram

```text
                       build time (Node 24, GitHub Actions)                              run time (browser, Safari 16.4+ floor)
 ┌───────────────────────────────────────────────────────────┐      ┌──────────────────────────────────────────────────────────────┐
 │ tools/oracle (Python, unchanged ownership)                 │      │ main thread (apps/web, Svelte 5)                              │
 │  manifest.json ──► fetch_vocab.py ──► data/vocab/raw/**    │      │  boot.js (lang/theme) → app.js (≤45 KB br)                    │
 │  gen_fixtures.py ──► fixtures/*.json (12 × 374 cases)      │      │  ┌ Input (textarea, chips, toggles)                           │
 │  export_unicode_tables.py ──► core/unicode/tables.gen.ts  │      │  ├ Pipeline rail + scrubber                                   │
 └───────────────┬───────────────────────────┬───────────────┘      │  ├ Board (packRows → rows of K byte columns, 3 tiers)          │
                 │ raw vocab + sha256         │ fixtures             │  ├ Inspector (rail ≥1024 / anchored 768–1023 / sheet <768)     │
                 ▼                            ▼                      │  ├ BYOK drawer ──────────────── fetch ──► api.anthropic.com    │
 ┌───────────────────────────┐   ┌───────────────────────────┐      │  │                                       api.x.ai             │
 │ @tsbs/vocab-tools (CLI)    │   │ @tsbs/conformance          │      │  └ TokenizerClient ◄── postMessage (transferables) ──┐         │
 │  6 parsers → TSBV1 writer  │──►│ runFixture() on in-memory  │      └──────────────────────────────────────────────────────┼─────────┘
 │  gzip-9 → /tok/<id>/<sha>  │   │ tables; refuses bad assets │                                                             │
 │  vocab-manifest.gen.json   │   └───────────────────────────┘      ┌──────────────────────────────────────────────────────┼─────────┐
 │  licences.generated.json   │                                      │ Web Worker (@tsbs/worker, ≤12 KB br + lazy engines)   ▼         │
 │  examples/<tok>.<sha>.json │ ◄── fromFixtureCase (core/fixture)   │  loader: Cache API → fetch(/tok/…bin) → sha256 → gunzip → TSBV1 │
 └───────────────────────────┘                                      │  ByteVocab (FNV-1a open addressing over PCES bytes)            │
                 │ dist/tok, dist/assets, index.html, about/        │  engines: import('./bytelevel.js') | import('./spm.js')          │
                 ▼                                                  │  agenda merge loop → TokenizationResult (SoA) + MergeTimeline    │
 ┌───────────────────────────────────────────────────────────┐      └──────────────────────────────────────────────────────────────┘
 │ Cloudflare Workers static assets (assets-only Worker)      │
 │  /            index.html (≤14 KB br, no ETag → keep small) │   /tok/*     application/octet-stream, nosniff, immutable, Content-Length present
 │  /about/      licences & provenance (generated)            │   /assets/*  hashed js/css/json, immutable, edge-compressed (zstd/br/gzip)
 │  /404.html    _headers (CSP, caching)  .assetsignore       │   /licenses/* verbatim texts, max-age 1 day
 └───────────────────────────────────────────────────────────┘
```

No server code runs anywhere. The only network calls at run time are `/tok/*`, `/assets/*`, `/examples/*` on the same origin and the two opt-in BYOK providers.

## 2. Workspace layout (pnpm workspace)

```text
tokenize-step-by-step/
├─ package.json                  # private; "packageManager": "pnpm@10.11.1"; engines.node ">=24.21 <25"; root scripts (§6)
├─ pnpm-workspace.yaml           # packages: apps/*, packages/*, e2e; onlyBuiltDependencies: [esbuild, workerd, @parcel/watcher]
├─ .node-version                 # 24.21.0
├─ .npmrc                        # engine-strict=true  save-exact=true  resolution-mode=highest
├─ tsconfig.base.json            # §4
├─ eslint.config.js  .prettierrc  .editorconfig  knip.json  size-limit.json  lighthouserc.json  budgets.json
├─ wrangler.jsonc                # assets-only Worker (06 §5)
├─ .github/workflows/            # ci.yml (incl. preview + lighthouse jobs)  deploy.yml  nightly-fuzz.yml  oracle.yml  reverify.yml
├─ apps/
│  └─ web/                       # @tsbs/web — Svelte 5 + Vite MPA: index.html, about/index.html, 404.html
│     ├─ public/                 # _headers, .assetsignore, robots.txt, favicon.svg, licenses/ (copied from docs/licenses at build)
│     ├─ src/
│     │  ├─ app/                 # App.svelte, state (app.svelte.ts), url-state.ts, boot.ts (→ boot-[hash].js)
│     │  ├─ shell/               # Header, Picker, Input, Chips, Toggles, Footer, NoticesStrip, HelpDialog
│     │  ├─ board/               # Board, Row, Cell (two-layer), Chip, Fragment, MarkerCell, grid-classes.css (generated)
│     │  ├─ pipeline/            # PipelineRail, Scrubber, playback.ts, replay-cursor.ts
│     │  ├─ inspector/           # InspectorPanel (role=region, non-modal; hosts: SideRail / AnchoredPanel / BottomSheet), sentences.ts
│     │  ├─ motion/              # flip.ts (WAAPI), view-transition.ts, motion-prefs.svelte.ts
│     │  ├─ byok/                # LiveCheckDrawer, anthropic.ts, xai.ts, live-tier.ts
│     │  ├─ about/               # About page components (FidelityTable, LicenceBlock, Diagnostics)
│     │  ├─ i18n/                # en.ts (source of truth), zh-TW.ts, ja.ts, t.ts, text-lang.ts
│     │  ├─ theme/               # theme.svelte.ts (auto/light/dark), imports @tsbs/ui-tokens
│     │  └─ generated/           # examples-default.json, examples-index.json, licences.json, vocab-manifest.json (gitignored)
│     ├─ plugins/                # vite: vocabAssets(), examples(), licences(), gridClasses(), bootScript(), headersMiddleware()
│     └─ vite.config.ts
├─ packages/
│  ├─ core/                      # @tsbs/core — pure TS, lib ES2023 only (no DOM), zero runtime deps
│  │  └─ src/
│  │     ├─ model/               # result.ts (FROZEN), view-types.ts (FROZEN), flags.ts, view.ts, invariants.ts
│  │     ├─ text/                # utf8.ts, analyze.ts (code points, UTF-16 map, graphemes), stand-ins.ts
│  │     ├─ unicode/             # tables.generated.ts (committed), classes.ts, patterns.ts (templates), expand.ts (pattern expander) — WP02 (§8)
│  │     ├─ format/              # tsbv1.ts (reader), varint.ts, byte-vocab.ts (ByteVocab), types.ts (FROZEN)
│  │     ├─ agenda/              # merge-loop.ts (PairPriority, MergeState, mergeStep, mergeAll), part-list.ts, heap.ts — owned by WP01 (AD-33)
│  │     ├─ engines/
│  │     │  ├─ bytelevel/        # pretokenize.ts, specials.ts, engine.ts, chunk-cache.ts (patterns come from ../../unicode/expand.ts)
│  │     │  └─ spm/              # normalize.ts, symbolize.ts, priority.ts (Score/MergeRank), fallback.ts, align.ts, engine.ts
│  │     ├─ timeline/            # timeline.ts (born/died, NEVER/ALIVE), trace-recorder.ts, replay.ts, fixture-steps.ts (Fenwick, tests only) — WP01
│  │     ├─ layout/              # pack-rows.ts (pure; used by web)
│  │     ├─ fixture/             # fixture-types.ts (FROZEN fixture schema), from-fixture-case.ts (fixture/wire case → TokenizationResult; main thread, tests, examples plugin)
│  │     ├─ protocol.ts          # Worker message types (FROZEN)
│  │     └─ index.ts
│  ├─ worker/                    # @tsbs/worker — entry.ts, loader.ts (Cache API, sha256, gunzip), host.ts, client.ts (TokenizerClient)
│  ├─ registry/                  # @tsbs/registry — data/{tokenizers,models,licences,examples,byok}.json, schema.ts (zod), check.ts
│  ├─ vocab-tools/               # @tsbs/vocab-tools — CLI: sources/*, tsbv-writer.ts, build.ts, guard.ts, licences.ts, examples.ts
│  ├─ conformance/               # @tsbs/conformance — run-fixture.ts, position-steps.ts (fixture types come from @tsbs/core/fixture)
│  └─ ui-tokens/                 # @tsbs/ui-tokens — tokens.css, tokens.ts, check-contrast.mjs
├─ e2e/                          # @tsbs/e2e — Playwright projects, axe, visual baselines, perf traces
├─ tools/oracle/                 # existing Python (+ export_unicode_tables.py, new)
├─ fixtures/                     # golden fixtures (+ README.md pointer, new)
├─ data/vocab/raw/               # gitignored upstream files
├─ data/vocab/dist/              # gitignored converter output, copied to apps/web/dist/tok at build
└─ docs/                         # research/, licenses/, design/ (this), adr/ (0001-architecture, 0002-tsbv1, 0003-agenda-equivalence, …)
```

### 2.1 Dependency direction and boundaries (ESLint-enforced)

```text
apps/web ──► @tsbs/worker (client.ts only) ──► @tsbs/core ──► (nothing)
apps/web ──► @tsbs/core/{model,text,layout,timeline,fixture}         (never core/engines/*, core/format/*, core/agenda/*)
apps/web ──► @tsbs/registry (JSON + types), @tsbs/ui-tokens
@tsbs/registry ──► @tsbs/core (types only: TokenizerId, Family, EncodeOptions, TextLangChoice, ResolvedTextLang)
@tsbs/vocab-tools ──► @tsbs/core, @tsbs/conformance, @tsbs/registry      (Node only; never bundled)
@tsbs/conformance ──► @tsbs/core
```

`eslint-plugin-import` `no-restricted-paths` + `no-restricted-imports`: `apps/web` may not import `@tsbs/core/engines/*`, `@tsbs/core/format/*`, `@tsbs/core/agenda/*` (engines cannot leak into the main bundle); `packages/core` may not import from `apps/*` or any Node/DOM API (`lib: ["ES2023"]` enforces it at type level; `eslint-plugin-compat` with the browserslist floor flags APIs outside Safari 16.4).

## 3. Toolchain pins

| Tool | Version policy | Notes |
|---|---|---|
| Node | `24.21.0` (`.node-version`, `engines ">=24.21 <25"`) | Workers Builds default image (§6.2); Node 24 = ICU 77 = Unicode 16 (relevant only to the `TSBS_NATIVE_UNICODE=1` parity run) |
| pnpm | `pnpm@10.11.1` exact in `packageManager` | pnpm 10 blocks lifecycle scripts: `onlyBuiltDependencies` must list `esbuild`, `workerd`, `@parcel/watcher`; local pnpm 12 auto-switches |
| TypeScript | 5.9.x | `erasableSyntaxOnly`, `verbatimModuleSyntax` |
| Vite | 7.x (8 only after a green branch run) | `build.target ['es2022','safari16.4','chrome109','firefox115']` |
| Svelte | 5.x, runes only (`compilerOptions.runes: true`) | `transition:`, `in:`, `out:`, `animate:` directives forbidden by lint in `apps/web` (they inject a runtime `<style>`; AD-15) — own WAAPI FLIP (05 §7) |
| @sveltejs/vite-plugin-svelte | 6.x | Vite 7 requires 6.x |
| Vitest | 4.x (+ `@vitest/coverage-v8`, `@vitest/browser` with the Playwright provider for component tests) | |
| fast-check | 3.x/4.x | property tests |
| Playwright | 1.5x; chromium, firefox, webkit + `Pixel 5`, `iPhone 12` device projects | `@axe-core/playwright` |
| wrangler | exact pin, `4.152.x` today (the floor for `wrangler preview --name` is 4.135, §6.1; AD-3 refers to this same pin) | `pnpm exec wrangler`, never `npx` (§6.4 Windows gotcha); `wrangler dev --assets apps/web/dist` serves `_headers`/`html_handling`/`not_found_handling` locally (06 §4) |
| ESLint | 9 flat config; `typescript-eslint` `strictTypeChecked` + `stylisticTypeChecked`; `eslint-plugin-svelte`; `eslint-plugin-import`; `eslint-plugin-compat`; selected `eslint-plugin-unicorn` rules | |
| Prettier | 3.x + `prettier-plugin-svelte` | |
| svelte-check | latest, `--threshold error` | |
| knip | latest | dead exports |
| size-limit | `@size-limit/file` (brotli) | budgets in 06 §3 |
| @lhci/cli | 0.1x | mobile preset |
| zod | 4.x (dev/build/test only) | registry schemas |
| zopfli (`@gfx/zopfli`) | optional; falls back to `zlib.gzipSync({level: 9})` | deterministic output asserted |
| Python (tools/oracle) | unchanged: uv ≥ 0.9, CPython 3.13, `regex==2026.9.29`, tiktoken 0.14.0, sentencepiece 0.2.2, tokenizers 0.23.3 | `export_unicode_tables.py` probes tiktoken's and tokenizers' classes and cross-checks the venv's `regex` (AD-4) |

Test oracles pinned exactly (dev only, Node only): `tiktoken@1.0.22` (WASM), `gpt-tokenizer@4.1.0`, `@huggingface/tokenizers@0.2.0`, `@sctg/sentencepiece-js@1.3.3`, `llama3-tokenizer-js@1.2.0`.

### 3.1 Runtime dependency list (shipped to the browser) and licences

| Package | Version | Licence | Why |
|---|---|---|---|
| `svelte` | 5.x | MIT | UI runtime (~10–15 KB br) |
| *(nothing else)* | | | No CSS framework, animation, i18n, virtualizer or validation library ships; each is < 150 lines in-house |

Dev/build dependencies (licences): `vite` MIT, `typescript` Apache-2.0, `vitest` MIT, `playwright` Apache-2.0, `@axe-core/playwright` MPL-2.0, `wrangler` MIT/Apache-2.0, `eslint` MIT, `typescript-eslint` MIT, `prettier` MIT, `zod` MIT, `fast-check` MIT, `@lhci/cli` Apache-2.0, `size-limit` MIT, `@gfx/zopfli` Apache-2.0, `knip` ISC; oracles `tiktoken` MIT, `gpt-tokenizer` MIT, `@huggingface/tokenizers` Apache-2.0, `@sctg/sentencepiece-js` Apache-2.0, `llama3-tokenizer-js` MIT. Third-party JS licences are listed on the About page (Svelte MIT is the only runtime entry).

## 4. TypeScript strictness (`tsconfig.base.json`)

```jsonc
{
  "compilerOptions": {
    "target": "ES2022", "module": "ESNext", "moduleResolution": "bundler",
    "lib": ["ES2023", "DOM", "DOM.Iterable", "WebWorker"],
    "strict": true, "exactOptionalPropertyTypes": true, "noUncheckedIndexedAccess": true,
    "noImplicitOverride": true, "noPropertyAccessFromIndexSignature": true, "noFallthroughCasesInSwitch": true,
    "useUnknownInCatchVariables": true, "verbatimModuleSyntax": true, "isolatedModules": true,
    "erasableSyntaxOnly": true, "skipLibCheck": true, "types": []
  }
}
```

`packages/core` overrides `"lib": ["ES2023"]` (no DOM, no WebWorker) to enforce portability (Worker, main thread, Node). `packages/worker` uses `["ES2023", "WebWorker"]`. Lint forbids `any`, non-null assertions outside tests, and `enum` (use `as const` objects; `const enum` is not erasable).

## 5. Vite configuration essentials (`apps/web/vite.config.ts`)

```ts
import { defineConfig } from 'vite';
import { svelte } from '@sveltejs/vite-plugin-svelte';
import { resolve } from 'node:path';
import { vocabAssets } from './plugins/vocab-assets';   // copies data/vocab/dist/tok → dist/tok; emits src/generated/vocab-manifest.json
import { examples } from './plugins/examples';           // fixtures → generated/examples-default.json + dist/examples/<tok>.<sha>.json
import { licences } from './plugins/licences';           // tools/oracle/manifest.json + docs/licenses → generated/licences.json; copies texts
import { gridClasses } from './plugins/grid-classes';    // writes src/board/grid-classes.css (.c1..c64 / .s1..s64)
import { bootScript } from './plugins/boot-script';      // esbuild src/app/boot.ts → IIFE, emitFile boot-[hash].js, inject <script src> first in <head> (transformIndexHtml)
import { headersMiddleware } from './plugins/headers';   // dev/preview only: parses public/_headers and applies the headers (CSP, /tok/* types) so local runs see them

export default defineConfig({
  plugins: [svelte(), vocabAssets(), examples(), licences(), gridClasses(), bootScript(), headersMiddleware()],
  appType: 'mpa',
  build: {
    target: ['es2022', 'safari16.4', 'chrome109', 'firefox115'],
    modulePreload: { polyfill: false },
    cssMinify: 'lightningcss',
    assetsInlineLimit: 0,
    sourcemap: 'hidden',                       // *.map excluded from deploy via .assetsignore
    rollupOptions: {
      input: { main: resolve(__dirname, 'index.html'), about: resolve(__dirname, 'about/index.html'), notFound: resolve(__dirname, '404.html') },   // boot.ts is NOT a Rollup input (it would become a deferred ES module); bootScript() emits it. 404.html is an input so it gets the boot script and the hashed CSS
      output: { manualChunks: { i18n: ['./src/i18n/en.ts', './src/i18n/zh-TW.ts', './src/i18n/ja.ts'] } },
    },
    reportCompressedSize: true,
  },
  worker: { format: 'es' },                    // REQUIRED for the lazy engine import()s inside the Worker; constructed via `import TokWorker from '@tsbs/worker/entry?worker'` (Vite worker import; a bare specifier inside new URL() is NOT resolved by Vite)
  css: { transformer: 'lightningcss' },
  // PD-5 (no inline (?i:) — Safari < 26): esbuild 0.28 (Vite 7) has no 'regexp-modifiers' feature key (transformWithEsbuild rejects it) and never introduces modifiers itself;
  // the guard is the ESLint regex-literal rule (no-restricted-syntax in eslint.config.js) plus WP02's pattern-expansion tests.
  define: { __BUILD_SHA__: JSON.stringify(process.env.GITHUB_SHA ?? 'dev'), __BUILD_DATE__: JSON.stringify(new Date().toISOString().slice(0, 10)) },
});
```

Rules: no top-level `await` in entries. **Boot script**: `bootScript()` runs esbuild on `src/app/boot.ts` with `{ format: 'iife', minify: true, target: 'safari16.4' }`, emits it through `this.emitFile` as `assets/boot-[hash].js`, and injects `<script src="/assets/boot-[hash].js">` (no `type="module"`, no `defer`, so it runs before first paint) at the top of `<head>` of **every** HTML entry (`index.html`, `about/index.html`, `404.html`) via `transformIndexHtml`; it sets `<html lang>` and `data-theme` (AD-15/AD-29) and is on the size-limit list (≤ 0.5 KB). **Worker**: constructed with the Vite worker import `import TokWorker from '@tsbs/worker/entry?worker'` (resolved through the workspace alias; `worker.format: 'es'` so the lazy `import('./engines/bytelevel.js')` inside it works); never a bare specifier inside `new URL(…, import.meta.url)`. Engine families are dynamic imports inside the Worker entry only; `/about/` is its own HTML entry sharing `src/shell` and `src/i18n`; dev mode serves `data/vocab/dist` under `/tok` and falls back to the dev loaders (`loadTiktokenText`, `loadSpmModel`, `loadHfJson` in `@tsbs/vocab-tools/dev`) when `dist` is missing so engine agents never block on the converter; `headersMiddleware()` applies `public/_headers` in `vite dev`/`vite preview` so the strict CSP and `/tok/*` headers are exercised locally too (the authoritative check runs on `wrangler dev` and the deployed preview, 06 §4).

## 6. Root scripts

| Script | Does |
|---|---|
| `pnpm dev` | `vite dev` in `apps/web` (dev loaders if `data/vocab/dist` is missing) |
| `pnpm vocab:fetch` | `uv run --project tools/oracle tools/oracle/fetch_vocab.py` |
| `pnpm vocab:build [--only <id>] [--conformance strict\|skip-missing-engine\|off]` | `tsbs-vocab build` → `data/vocab/dist/tok/**`, `vocab-manifest.generated.json`, `licences.generated.json`, MODIFIED notices; conformance inside (AD-13; `skip-missing-engine` is the CI mode until both engines have merged, AD-32) |
| `pnpm vocab:verify` | re-decode every `.bin`, check sha256, round-trip against raw |
| `pnpm unicode:export` / `pnpm unicode:check` | Python export of the Unicode 16.0 tables → `tools/oracle/unicode_tables.json`, then `scripts/unicode-tables.ts` converts it to TS / Node-only diff gate: `tables.generated.ts` vs the committed JSON (the fresh-export diff is `oracle:check`'s `export_unicode_tables.py --check`) |
| `pnpm registry:check` | zod validation + cross-refs + negative tests |
| `pnpm generate` | `node apps/web/plugins/generate.ts`: writes the gitignored `apps/web/src/generated/{examples-default,examples-index,licences}.json` through `@tsbs/vocab-tools` (the same data the Vite plugins emit); chained before `lint`, `typecheck` and `test` so they see the files without a Vite run (`vocab-manifest.json` is still written by the `vocabAssets()` plugin only) |
| `pnpm test` | `pnpm generate && vitest run` across the workspace (core, conformance, worker, registry, web units/components) |
| `pnpm test:fuzz` | Node fuzz vs npm oracles (nightly; seed printed) |
| `pnpm e2e` | Playwright functional suites (chromium, firefox, webkit, Pixel 5, iPhone 12, 320/360/2560 viewports) against `vite preview` (+ `headersMiddleware`) |
| `pnpm e2e:headers` | header-dependent suites (CSP violations, `/tok/*` `Content-Type`/nosniff/CORP, `404.html`, dotfile guard, `/index.html` → `/`) against `wrangler dev --assets apps/web/dist` (workerd applies `_headers`); in `preview.yml` the same suite runs against the `wrangler preview` URL |
| `pnpm lint` / `pnpm typecheck` / `pnpm format:check` / `pnpm knip` | `pnpm generate &&` eslint · `pnpm generate &&` `tsc -b` + `svelte-check` · prettier · dead code |
| `pnpm build` | `vocab:build` (cached by manifest + tools hash) → `vite build` → `check:dist` → `wrangler deploy --dry-run` |
| `pnpm check:dist` | `size-limit`, 25 MiB / 20,000-file guards, dotfile guard, manifest ↔ files cross-check, `_headers` rule count |
| `pnpm lhci -- --url <preview url>` | `@lhci/cli autorun` (mobile preset) against the **deployed preview URL** (real edge compression, `_headers`, HTTP/3); `vite preview` serves uncompressed bytes and is never a budget target |
| `pnpm deploy` / `pnpm preview:pr -- <n>` | `wrangler deploy` / `wrangler preview --name pr-<n>` (CI only) |
| `pnpm oracle:check` | `fetch_vocab.py` (idempotent) · `make_corpus.py --check` · `gen_fixtures.py --check` · `render_license_docs.py --check` · `export_unicode_tables.py --check` |

## 7. Build graph

```text
tools/oracle/manifest.json ─┬─► vocab:fetch ─► data/vocab/raw/** (sha256-verified)
                            ├─► vocab:build ─► data/vocab/dist/tok/<id>/<sha12>.bin + vocab-manifest.generated.json
                            │                 (conformance against fixtures/<id>.json before any write)
                            └─► licences.generated.json + MODIFIED-<id>.txt + dist/licenses/<id>/*
fixtures/*.json ─► examples plugin (fromFixtureCase) ─► generated/examples-default.json, dist/examples/<tok>.<sha>.json
tools/oracle/export_unicode_tables.py ─► tools/oracle/unicode_tables.json ─► packages/core/src/unicode/tables.generated.ts (both committed; unicode:check)
packages/registry/data/*.json ─► registry:check ─► imported by web + worker
apps/web ─► vite build ─► dist/ ─► check:dist ─► wrangler deploy --dry-run ─► deploy
```

`vocab:build` is hermetic (sha256 of every raw input verified first; deterministic output: sorted sections, fixed gzip parameters, no timestamps beyond `retrievedOn`); two builds are byte-identical, so unchanged vocabularies keep their hashed file names across deploys.

## 8. Module ownership map (who may edit what)

| Area | Package | Owner WP |
|---|---|---|
| Frozen types (`model/result.ts`, `format/types.ts`, `protocol.ts`, registry `schema.ts` types) | core, registry | WP00 commits them verbatim from 03/04; changes need an ADR and a PR touching every dependent |
| Text analysis, model builders, view, invariants, `packRows`, **agenda loop (`core/agenda`: heap, part list, `MergeState`/`mergeStep`/`mergeAll`), `TraceRecorder`, timeline replay**, `fromFixtureCase`, `fixture-types.ts`, conformance runner | core, conformance | WP01 (AD-33: one owner for the loop both engines' correctness rests on) |
| Unicode tables + pattern expander, TSBV1 reader, `ByteVocab` | core/format, core/unicode | WP02 |
| Converter CLI, TSBV1 writer, parsers, guards, licences, examples output | vocab-tools (incl. `tsbv-writer.ts`) | WP03 |
| Registry data + schemas + check | registry | WP04 |
| Engine A | core/engines/bytelevel (consumes the frozen agenda; never edits `core/agenda`) | WP05A |
| Engine B | core/engines/spm (same) | WP05B |
| Worker, loader, client | worker | WP07 |
| Shell, theme, i18n, About | apps/web/{shell,theme,i18n,about}, ui-tokens | WP06 |
| Board, inspector, keyboard, pointer | apps/web/{board,inspector} | WP08 |
| Pipeline rail, scrubber, motion | apps/web/{pipeline,motion} | WP09 |
| BYOK | apps/web/byok | WP10 |
| CI, e2e, budgets, deploy | `.github/**` (WP00 writes only the initial `ci.yml` with check/unit/build stubs; WP11 owns everything under `.github` from then on), e2e, root configs | WP11 |
| Fuzz + perf measurement | core tests, e2e perf | WP12 |
| Integration, long-input modes, URL state, launch | apps/web/app | WP13 |
