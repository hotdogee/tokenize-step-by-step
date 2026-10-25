# ADR 0001 — Architecture: client-only Svelte 5 + Vite MPA, own engines in a Worker, assets-only Cloudflare deploy

- **Status:** Accepted (2026-10-25). Stub written by WP00; the full rationale lives in the design documents cited below.
- **Deciders:** owner (OD-1…OD-5), planner (PD-1…PD-8, PA-1…PA-6), lead architect (AD-1…AD-39).

## Context

The product is a step-by-step tokenization visualizer (text → code points → UTF-8 bytes → pre-tokenizer chunks → BPE
merges → tokens) for nine tokenizers, in zh-TW, ja and en, on phones and desktops. No library exposes merge steps or byte
offsets, the site must run without a backend, and the vocabularies must be served within Cloudflare's static-asset
limits. See `docs/research/01-tokenizers-and-platform.md` and `docs/design/00-decisions.md`.

## Decision

- **UI:** Svelte 5 (runes only) + Vite multi-page app (`/`, `/about/`, `404.html`), no SvelteKit (PD-1).
- **Engines:** our own byte-level BPE (tiktoken semantics) and SentencePiece BPE, sharing one agenda merge loop, producing
  struct-of-arrays results with a replayable merge timeline; validated against committed golden fixtures (PD-2, AD-5,
  AD-9, AD-20).
- **Runtime:** engines run in a Web Worker that loads one compact, pre-gzipped `TSBV1` vocabulary at a time
  (PD-7, AD-10, AD-19); the main thread renders precomputed examples before any vocabulary byte arrives (AD-16).
- **Workspace:** pnpm monorepo — `@tsbs/core` (pure, DOM- and Node-free), `@tsbs/worker`, `@tsbs/registry`,
  `@tsbs/vocab-tools` (Node only), `@tsbs/conformance`, `@tsbs/ui-tokens`, `@tsbs/web`, `@tsbs/e2e`; dependency
  direction enforced by ESLint (`docs/design/02-architecture.md` §2).
- **Delivery:** GitHub Actions is the only CI/CD; an assets-only Cloudflare Worker on workers.dev serves `dist/` with a
  strict CSP from `_headers` (PD-8, AD-3, AD-15).
- **Toolchain:** Node 26.12.1 and pnpm 12.14.0, exact pins (PA-1).

## Consequences

- FROZEN v1 contracts (`docs/design/07-implementation-plan.md` §1) are committed by WP00; changing one needs a new ADR
  and one PR that updates every dependent.
- Work packages proceed in parallel against the frozen contracts (PA-3).
