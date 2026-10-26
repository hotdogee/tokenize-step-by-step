# Tokenize step by step

A client-side visualizer that shows, one step at a time, how a language-model tokenizer turns text into tokens:
**text → code points (with grapheme brackets) → UTF-8 bytes (hex and decimal) → pre-tokenizer chunks → BPE merges, one
at a time → tokens with ids**, including tokens that cover only part of a character. The default example is `台灣台南`.

- **Tokenizers (v1):** OpenAI o200k_base and cl100k_base; Google Gemma 4 (= Gemini 2.0–3.5) and Gemma 1/2; Meta Llama 4 /
  Muse and Llama 3.x; xAI Grok-2 and Grok-1; the legacy Anthropic Claude 1/2 vocabulary (not the Claude 3+ tokenizer),
  plus optional bring-your-own-key live checks against the Anthropic and xAI token-counting APIs.
- **Everything runs in your browser.** There is no backend; vocabularies are static files and the tokenizer engines are
  our own TypeScript implementations, tested against golden fixtures produced by the reference libraries.
- **UI languages:** 繁體中文 (zh-TW), 日本語 (ja), English; light and dark themes; keyboard, mouse and touch; 360 px to 4K.

## Status

The work packages of [`docs/design/07-implementation-plan.md`](docs/design/07-implementation-plan.md) through wave 4's
integration (WP13a) are in place: both engines, the Worker, the board, the pipeline rail and scrubber, the inspector,
the live-check drawer, long-input tiers, URL state, error handling and diagnostics. The launch checklist (WP13b) is
`docs/release.md`.

## Architecture

```text
 build time (Node, CI)                                     run time (the browser only — no server code anywhere)
 ─────────────────────                                     ──────────────────────────────────────────────────────
 tools/oracle (Python)                                     main thread: apps/web (Svelte 5)
   pinned upstream vocabularies → data/vocab/raw             boot.js (lang, theme) → app shell → AppState
   reference tokenizers → fixtures/*.json (golden)           first paint: the precomputed default example
 @tsbs/vocab-tools (tsbs-vocab)                              board · pipeline rail · inspector · live-check drawer
   raw vocab → TSBV1 .bin (gzip) + manifest                    │ postMessage (typed arrays, transferred)
   conformance against the fixtures before any write           ▼
   precomputed example results, licence data               Web Worker: @tsbs/worker
 vite build → apps/web/dist (+ dist/tok/*.bin)               loader: Cache API → fetch /tok/<id>/<sha>.bin → sha256 → gunzip
   → Cloudflare Workers static assets (CI deploys)           engines (lazy chunks): byte-level BPE · SentencePiece BPE
```

- **What runs where.** Everything runs in the visitor's browser. The page (`apps/web`) renders and animates; the
  tokenizer engines run in a Web Worker so long texts never block the page. The only network requests are the site's
  own static files (`/assets`, `/examples`, `/tok`) and, only when the visitor opens the live-check drawer and enters
  their own key, the Anthropic and xAI token-counting APIs.
- **The three core packages.** `@tsbs/core` is the pure TypeScript heart (no DOM, no Node): the struct-of-arrays
  `TokenizationResult`, text analysis (code points, UTF-8, grapheme clusters), the shared agenda merge loop, both engines
  and the merge timeline that makes every BPE step replayable. `@tsbs/worker` hosts the engines behind a small message
  protocol (load, encode with cancellation, lookup) and caches vocabularies in the Cache API. `@tsbs/registry` is the
  data: tokenizers, model mappings with dated evidence, licences and notices, example chips, BYOK endpoints — validated
  by zod at build time, imported as plain JSON at run time.
- **The Worker.** The page posts `load` for the default tokenizer only after its first paint; the Worker downloads the
  vocabulary (or reads it from the Cache API), verifies its sha256, builds the tables, and answers encodes with results
  whose typed arrays are transferred, never copied. A newer keystroke cancels an older encode; a crashed Worker is
  respawned once.
- **The data pipeline.** `tools/oracle` pins every upstream vocabulary by URL and sha256 and generates the golden
  fixtures with the reference libraries (tiktoken, sentencepiece, Hugging Face tokenizers). `tsbs-vocab build` converts
  each vocabulary into a compact `.bin`, refusing to write one whose tables fail its fixture, and emits the precomputed
  example results the page shows before any vocabulary arrives. CI runs the conformance, unit, component, end-to-end
  (three browsers, two devices, three viewports) and Lighthouse checks, then deploys the tested build.

The design documents explain each piece in depth: [`02-architecture.md`](docs/design/02-architecture.md),
[`04-engines.md`](docs/design/04-engines.md), [`05-ui-ux.md`](docs/design/05-ui-ux.md); developer notes, including how the
page is wired, are in [`docs/dev.md`](docs/dev.md).

## Run it

Requirements: Node 26.12.1 (`.node-version`) and pnpm 12.14.0 (`packageManager`); uv ≥ 0.9 only for the Python oracle
tooling.

```sh
pnpm install
pnpm dev                                            # http://localhost:5173
pnpm lint && pnpm typecheck && pnpm format:check && pnpm test
pnpm build                                          # vocab:build (strict conformance) → vite build → check:dist → wrangler deploy --dry-run
pnpm --filter @tsbs/web preview                     # the production bundle with the production headers (CSP)
```

More in [`docs/dev.md`](docs/dev.md) (Windows notes included).

## Layout

| Path                       | What                                                                                   |
| -------------------------- | -------------------------------------------------------------------------------------- |
| `apps/web`                 | `@tsbs/web` — Svelte 5 + Vite multi-page site (`/`, `/about/`, `404.html`)             |
| `packages/core`            | `@tsbs/core` — data model, text analysis, agenda merge loop, engines (no DOM, no Node) |
| `packages/worker`          | `@tsbs/worker` — Web Worker host, vocabulary loader, `TokenizerClient`                 |
| `packages/registry`        | `@tsbs/registry` — tokenizer, model, licence, example and BYOK data with zod schemas   |
| `packages/vocab-tools`     | `@tsbs/vocab-tools` — `tsbs-vocab` converter CLI (Node only)                           |
| `packages/conformance`     | `@tsbs/conformance` — golden-fixture conformance runner                                |
| `packages/ui-tokens`       | `@tsbs/ui-tokens` — design tokens (CSS custom properties)                              |
| `e2e`                      | `@tsbs/e2e` — Playwright suites                                                        |
| `tools/oracle`, `fixtures` | Python reference oracles, pinned vocabulary provenance and the golden fixtures         |

## Documentation

- Design (binding): [`docs/design/`](docs/design/) — decisions ([`00-decisions.md`](docs/design/00-decisions.md)),
  architecture, data model and assets, engines, UI/UX, quality/CI/deploy, implementation plan.
- Research: [`docs/research/01-tokenizers-and-platform.md`](docs/research/01-tokenizers-and-platform.md).
- Architecture decision records: [`docs/adr/`](docs/adr/).
- Oracle tooling and the fixture schema: [`tools/oracle/README.md`](tools/oracle/README.md).
- Third-party licences and notices: [`docs/licenses/`](docs/licenses/) (also shown on the site's About page).

## Licence

Our code is MIT-licensed ([`LICENSE`](LICENSE)). Tokenizer vocabularies are redistributed under their own licences; see
`docs/licenses/` and the About page.
