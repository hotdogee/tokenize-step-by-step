# @tsbs/vocab-tools

Node-only vocabulary converter (`tsbs-vocab`, docs/design/03-data-model-and-assets.md §C.5). Never bundled.

## Commands

- `tsbs-vocab build [--only <id>] [--conformance strict|skip-missing-engine|off] [--missing-raw fail|skip]` — verifies
  every raw file against `tools/oracle/manifest.json`, refuses non-`ship`/withdrawn assets, parses, encodes TSBV1, runs
  the conformance gate, gzips (zlib-9, normalised header) and writes `data/vocab/dist/tok/<id>/<sha12>.bin`,
  `vocab-manifest.generated.json`, `licences.generated.json` and `licenses/<assetId>/MODIFIED-<assetId>.txt`. Nothing
  is written if any asset fails.
- `tsbs-vocab verify` — re-reads every `.bin`, checks both SHA-256s and sizes, and re-parses the raw source for an
  exact round trip.
- `tsbs-vocab inspect <file.bin>` — sections, META, first/last pieces and hashes (gzip file or raw container).
- `tsbs-vocab guard --dist apps/web/dist` — the 03 §C.8 deploy guards (also run by `pnpm check:dist`).
- `tsbs-vocab licences [--out <file>]` — `licences.generated.json` only.
- `tsbs-vocab examples --out <dir>` — `ExamplesWire` files per tokenizer, `examples-default.json` and
  `examples-index.json` (03 §C.7).

`--conformance` defaults to `$CONFORMANCE_MODE`, then `strict`. `--missing-raw` defaults to `fail` (a SHA-256 mismatch
always fails). `SOURCE_DATE_EPOCH` overrides every date written.

The conformance gate reads each container back through WP02's `readTsbv1`, imported from the design's subpath
`@tsbs/core/format/tsbv1` (a root re-export is accepted too; `src/core-reader.ts`). WP02 merged in wave 1, so the
reader is always present: the joint WP02/WP03 test (`test/real-assets.test.ts`) reads every in-memory container and
every `.bin` in `data/vocab/dist` back through it.

## Recorded deviations

- **`--missing-raw skip` is the default under `skip-missing-engine`.** 03 §C.5 says any failure aborts the build. WP00's
  CI build job has no `data/vocab/raw`, and AD-32 rejects a red build job in wave 1. So in that mode only, an asset whose
  raw files are absent is skipped. The build prints a warning per asset and a summary warning, and the site deploys
  without those vocabularies. AD-32 does not cover this. Remove it when WP11 restores `data/vocab/raw` in CI, or at the
  `strict` flip if that comes first.
- **No `vocab:build` cache** keyed on the manifest and tools hash (02 §6). A full build takes about 5 s, so it always
  rebuilds. Its outputs are deterministic either way.

## Layout

Parsers (`src/sources/`): `tiktoken-text` (o200k, cl100k, Llama 3; specials committed in `src/sources/specials/`),
`claude-json`, `grok2-json`, `hf-bytelevel` (Muse Glimmer via the inverse GPT-2 byte map), `spm-proto` (Grok-1,
Gemma 1/2 through a minimal proto2 reader), `hf-spm-json` (Gemma 4: TYPS derived per AD-31, exact MRGS, A2 check).

`@tsbs/vocab-tools/dev` exposes the dev loaders (`loadTiktokenText`, `loadSpmModel`, `loadHfJson`, `loadClaudeJson`,
`loadGrok2Json` → in-memory `VocabTables`; `toContainer()` → TSBV1 bytes for `readTsbv1`; `buildInMemory()` for
`vite dev`). `@tsbs/vocab-tools/vite-support` holds the helpers of the web app's `vocabAssets()`, `licences()` and
`examples()` plugins.
