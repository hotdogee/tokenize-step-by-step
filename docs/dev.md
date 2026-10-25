# Developer notes

## Toolchain

- Node **26.12.1** (`.node-version`) and pnpm **12.14.0** (`packageManager` in `package.json`), both exact (PA-1).
- pnpm 12 reads install settings from `pnpm-workspace.yaml`, not from `.npmrc`: `allowBuilds` (which dependency
  lifecycle scripts may run: `esbuild`, `workerd`, `@parcel/watcher`), `engineStrict`, `savePrefix: ''` (exact versions)
  and `resolutionMode: highest` live there. `.npmrc` keeps the same three settings for npm-compatible tools.
- The Python oracle tooling (`tools/oracle`) needs uv ≥ 0.9; see `tools/oracle/README.md`.

## Everyday commands

```sh
pnpm install
pnpm dev                       # vite dev on apps/web (CSP omitted so HMR works, PA-2b)
pnpm lint && pnpm typecheck && pnpm format:check && pnpm test   # lint/typecheck/test first run `pnpm generate` (gitignored apps/web/src/generated/*.json)
pnpm build                     # vocab:build (strict conformance) → vite build → check:dist → wrangler deploy --dry-run
pnpm --filter @tsbs/web preview                     # production bundle with every _headers line, CSP included
```

`pnpm build` runs `tsbs-vocab build`, which takes its conformance mode from `--conformance`, then from the
`CONFORMANCE_MODE` environment variable, then defaults to `strict` (AD-32). Both engines exist since wave 2, so every
asset is checked against its fixture before it is written, and CI's repository variable of the same name is `strict`
(`pnpm conformance:gate` fails on anything weaker). `skip-missing-engine` only mattered while an engine factory was
missing from `@tsbs/core`; `--conformance off` is a local-only escape hatch and never allowed in CI.

Package tests live in `packages/<name>/test/` with their own `tsconfig.json` (Node types), so `src/` stays free of DOM and
Node APIs where `docs/design/02-architecture.md` §4 requires it. `tsc -b` writes declaration output for project
references to `node_modules/.cache/tsbuild/`.

## Fuzz and performance (WP12)

```sh
pnpm test:fuzz                                   # 2,000 strings × 9 tokenizers, fixed seed 20261025 (ci.yml fuzz-smoke)
pnpm test:fuzz --seed 20261026 --n 10000         # what nightly-fuzz.yml runs with the date seed
pnpm test:fuzz --tokenizer google-gemma4 --no-write
TSBS_PERF=1 NODE_OPTIONS=--expose-gc pnpm test:perf   # the opt-in Node ceilings + memory checks, one file at a time
TSBS_PERF=1 pnpm bench                           # vitest bench (vocab init, 10k/20k CJK encode) + the 06 §3 ceilings
pnpm build && pnpm e2e:perf                      # Playwright perf spec on vite preview (Fast 4G load, keystrokes, render, scrub)
```

PowerShell: `$env:TSBS_PERF = '1'; $env:NODE_OPTIONS = '--expose-gc'; pnpm test:perf`. Without `--expose-gc` the
Worker heap check fails under `TSBS_PERF=1` instead of skipping, so a green opt-in run always includes it.

- **`pnpm test:fuzz`** (`packages/core/test/fuzz/`) needs `data/vocab/dist` (`pnpm vocab:build`: the engines decode the
  built `.bin` with `readTsbv1`), `data/vocab/raw` (`pnpm vocab:fetch`) and uv. It generates seeded strings (the corpus
  alphabet of `tools/oracle/alphabet.json`, the 04 §7 extras, contractions with `ſ`, repeated-unit runs), asks
  `tools/oracle/fuzz_oracle.py --serve` for ids and byte spans, and compares ids **and** spans with every engine. Second
  opinions (gpt-tokenizer on o200k/cl100k, @huggingface/tokenizers on Gemma 4/Glimmer, and the fixture lane's Python
  cross-checks) are compared with the oracle; a disagreement there is an `oracle-divergence`, classified on its shrunken
  minimal repro (`unicode-version`, `case-fold`, `js-whitespace-class`, `special-string`, `gemma3-literal-special`,
  `hf-vs-spm-tie-break`, `opinion-error`). The run fails on an engine mismatch, an oracle error or an `unclassified`
  divergence; for such a tokenizer every case of its run is written to `fixtures/candidates/<tokenizer>-<seed>.json`
  (fixture case shape + `classification`). Classified divergences alone are only printed (the divergence log: one line
  each with its class and minimal repro); no candidates file is written for them. In a git worktree without its own
  oracle venv, point the run at the main checkout's: `TSBS_ORACLE_PROJECT=<main>/tools/oracle pnpm test:fuzz` (never
  `uv sync` a second venv).
- **Timing runs are serial.** A parallel Vitest run shares the CPU between files and once pushed `readTsbv1` past its
  25 ms ceiling (30.3 ms) while serial runs pass, so `pnpm test:perf` uses `--no-file-parallelism` and the bench config
  (`packages/core/test/bench/vitest.bench.config.ts`) runs one file in one worker. Do the same for any ad-hoc
  `TSBS_PERF=1` command. The Node ceilings live in `packages/core/test/helpers/ceilings.ts` (06 §3; phone = Node × 4).
- **`pnpm bench`** writes `packages/core/node_modules/.cache/tsbs/bench.json` and prints every median against its ceiling
  (`check-bench.ts`); with `TSBS_PERF=1` a median over its ceiling fails. Without it the table is a report.
- **`pnpm e2e:perf`** (`e2e/perf/`, its own Playwright config, chromium, one worker, port `E2E_PERF_PORT` = 4174) is
  soft: a missed budget is a warning and the numbers go to `e2e/test-results/perf/perf-results.json`; `PERF_STRICT=1`
  makes misses fail. `E2E_PERF_BASE_URL=<url>` runs it against a deployed preview or production instead of a local
  `vite preview`. `docs/perf-log.md` keeps the dated results.

## Tokenizer client (`?mock=1`)

The page tokenizes in a Web Worker (`@tsbs/worker`, PA-8): `apps/web/src/app/bootstrap.ts` builds
`new TokenizerClient(() => new TokWorker({ name: WORKER_NAME }))` from the Vite worker import
`@tsbs/worker/entry?worker`, behind `DeferredClient`, so the client code, the Worker's host chunk (`assets/entry-*.js`)
and the first engine chunk (`assets/bytelevel-*.js` or `assets/spm-*.js`, plus the shared `assets/engine-core-*.js`)
load after first paint, followed by the tokenizer's `/tok/<id>/<sha12>.bin`. Typed text is tokenized live.

Append `?mock=1` to the URL (`http://localhost:5173/?mock=1`, or `/?lang=ja&mock=1`) to use the precomputed-examples
client instead (`ExamplesClient` over WP01's `MockTokenizerClient`): no Worker and no vocabulary download; the example
chips answer from the lazy `examples/<id>.<sha8>.json` files (the oracle's results), and any other text shows "waiting
for the tokenizer". E2E specs that need deterministic precomputed results open `/?mock=1`
(`e2e/specs/live-worker.spec.ts` covers both modes); the Worker's generated inputs
(`packages/worker/src/generated/{vocab-manifest,engine-config}.json`) come from `pnpm generate` or any Vite run.

## Windows

- Always run wrangler through the workspace: `pnpm exec wrangler …`, never `npx wrangler` (research §6.4).
- **Long paths and `workerd`.** If `wrangler dev` fails with `spawn …\workerd.exe ENOENT` (or similar) because the
  checkout lives in a deep directory (git worktrees under `.claude/worktrees/…` are a common cause), point Miniflare at a
  short copy of the binary:

  ```powershell
  New-Item -ItemType Directory -Force C:\tools\workerd | Out-Null
  Copy-Item (Resolve-Path node_modules\.pnpm\@cloudflare+workerd-windows-64@*\node_modules\@cloudflare\workerd-windows-64\bin\workerd.exe) C:\tools\workerd\
  $env:MINIFLARE_WORKERD_PATH = 'C:\tools\workerd\workerd.exe'
  pnpm exec wrangler dev
  ```

  Enabling Win32 long paths (`git config --global core.longpaths true` and the `LongPathsEnabled` registry policy) also
  helps. CI runs on Linux and is unaffected. (Not observed during WP00: `wrangler dev` and `wrangler deploy --dry-run`
  both worked from a git-worktree path on Windows 11; the note is kept from the design's risk register, 07 §5 item 12.)

- **Port clashes with stray `workerd`.** A `wrangler dev` killed by a timeout can leave `workerd.exe` listening; a new
  session on the same port then answers from the old process (stale assets, missing headers). Pick another `--port` or
  stop the leftover `workerd.exe`.
