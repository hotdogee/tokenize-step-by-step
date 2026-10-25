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

Work package **WP00** (scaffold and frozen contracts) is in place: the pnpm workspace, strict TypeScript, lint/format/test
tooling, the FROZEN v1 interfaces, a placeholder app shell and the CI/deploy configuration. The engines, the board and the
real UI arrive with the later work packages of [`docs/design/07-implementation-plan.md`](docs/design/07-implementation-plan.md).

## Run it

Requirements: Node 26.12.1 (`.node-version`) and pnpm 12.14.0 (`packageManager`); uv ≥ 0.9 only for the Python oracle
tooling.

```sh
pnpm install
pnpm dev                                            # http://localhost:5173
pnpm lint && pnpm typecheck && pnpm format:check && pnpm test
CONFORMANCE_MODE=skip-missing-engine pnpm build    # vocab:build → vite build → check:dist → wrangler deploy --dry-run
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
