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
`@tsbs/worker/entry?worker`, behind `DeferredClient`, so the client code, the Worker's host chunks (`assets/entry-*.js`
and the `assets/entry-core-*.js` it imports) and the first engine chunk (`assets/bytelevel-*.js` or `assets/spm-*.js`,
plus the shared `assets/engine-core-*.js`) load after first paint, followed by the tokenizer's `/tok/<id>/<sha12>.bin`.
Typed text is tokenized live. No chunk may import `entry-*.js` itself: WebKit evaluates a module Worker's top-level
script again when another module imports it (a second host), so `apps/web/vite.config.ts` moves everything the entry
imports into `entry-core` and `check:dist` fails on such an import.

Append `?mock=1` to the URL (`http://localhost:5173/?mock=1`, or `/?lang=ja&mock=1`) to use the precomputed-examples
client instead (`ExamplesClient` over WP01's `MockTokenizerClient`): no Worker and no vocabulary download; the example
chips answer from the lazy `examples/<id>.<sha8>.json` files (the oracle's results), and any other text shows "waiting
for the tokenizer". E2E specs that need deterministic precomputed results open `/?mock=1`
(`e2e/specs/live-worker.spec.ts` covers both modes); the Worker's generated inputs
(`packages/worker/src/generated/{vocab-manifest,engine-config}.json`) come from `pnpm generate` or any Vite run.

## How the page is wired (WP13)

One `AppState` (`apps/web/src/app/app-state.svelte.ts`, 05 §1.1) drives the client, the board, the rail, the inspector
and the drawer:

- **Startup.** The precomputed default example (台灣台南 on o200k, inlined) is on screen at first paint, badge
  "precomputed". The tokenizer client is imported and `load` posted only after `DOMContentLoaded`, `document.fonts.ready`,
  the first paint entry (`largest-contentful-paint`, else `paint`) and two animation frames (`load-trigger.ts`, 06 §3);
  `integration-load.spec.ts` asserts the Worker script and the `.bin` start after the last LCP entry. While a tokenizer
  loads, an example chip answers from the precomputed examples (`precomputed.ts`); the engine's first answer replaces a
  precomputed result inside the board's View Transition (`setResultTransition`, skipped above 8 MB, where the previous
  result is released first) and the badge says "live".
- **Requests.** Every encode carries one sequence number: an older answer is dropped, a superseded encode settles as
  `cancelled` (never an error), keystrokes coalesce in the 40 ms debounce, an encode asked for during a load is sent once
  after `loaded`, a paste (`inputType` `insertFromPaste`) skips the debounce, an IME composition sends nothing until it is
  committed (05 §6).
- **The board's result** is `AppState.board`: `final` (the current result, or its window), `stale` (the last result, kept
  with `data-pending` until its successor arrives — a keystroke on a loaded tokenizer renders once, PA-11; a tokenizer
  switch keeps the last result, AD-19) or `text` (text-only stops 1–3, only while nothing is loaded for the text, an IME
  composition is open or a long input waits). Rows virtualize above 600 cells or 8 packed rows (`board/window.ts`).
- **Long input** (AD-27, `long-input.ts`): ≤ 2,000 code points live; ≤ 20,000 virtualized with scoped replay; above that
  the "Long input — tokenize on demand" banner runs the WHOLE analysed text once (`trace: { maxSteps: 50_000 }` up to
  100,000 code points, `trace: false` beyond) and the board shows a 2,000-byte window of that result around the caret
  (`window-slice.ts` slices the full result; it never tokenizes a substring); above 200,000 code points only the first
  200,000 are analysed. The counts line keeps code points, graphemes and bytes live and marks the last run's tokens
  "stale" after an edit. Each tier change is said once in the always-mounted status region (the banner is lazy-mounted
  and is no live region of its own). A run asked for while the tokenizer loads runs on `loaded`, also after a failed
  load is retried, and is dropped when the text goes back under 20,001 code points (the load then encodes the short
  text live).
- **URL state** (`url-state.ts`): `?t=&q=&s=<stage>.<step>&b=&lang=&tl=` is read once (`bootstrap.ts`), invalid values
  ignored; every change but the text is written with `history.replaceState` 500 ms later; "Copy link" alone puts the text
  in `q` (≤ 2,000 code points) and confirms it.
- **Errors** (`errors.ts`, 05 §12 / 04 §5) surface as one `role="alert"` toast with its action: reload (stale deploy),
  retry (network, integrity after the loader's automatic refetch; in an on-demand tier it runs the whole text again),
  back (a load out of memory: the previous tokenizer, from the cache; an out-of-memory tokenization offers no action and
  suggests a shorter text). `quota` is informational: when the Worker's `ready.features.cacheApi` is false (Safari
  private mode, blocked storage) the toast says once per session that the tokenizer works without the offline cache. A
  short storage quota with a working cache is silent by design: the loader keeps the vocabulary in memory only
  (`packages/worker/src/loader.ts`, `hasRoom`) and the FROZEN protocol has no warning message to tell the page.
- **Vocabulary lookups.** `TokenizationView`'s `idOf` / `pieceOf` go through the Worker's `lookup` (`vocab-lookup.ts`),
  batched and cached per tokenizer; an answered batch bumps `AppState.lookupVersion`, so `viewOf` builds a fresh view.
- **Startup budget (PA-7).** `plugins/registry-trim.ts` keeps registry fields `/` never renders (tokenizer `asset` /
  `fixture`, licence `summary` / `spdx`, the MODIFIED template) and the non-default chips' "why" sentences out of the
  bundle (`app/example-why.svelte.ts` loads those on the first other chip); the inspector model, the window slicer and
  the long-input banner are lazy chunks. `plugins/lazy-chunks.ts` names chunks `lazy-*` on the rendered chunk graph.
- **The merge list** stays in the rail region at every width (WP09's placement) rather than moving into the ≥ 1024 px
  side rail of 05 §1: its toggle, scope and step live in the rail, one DOM position keeps the tab order the same at every
  breakpoint, and the sticky side rail is the inspector's column (moving it would need the rail's replay state to cross
  into the board's layout).

`pnpm e2e integration` runs the WP13 suites (`e2e/specs/integration-*.spec.ts`): the load trigger, precomputed vs live
for every chip × tokenizer, long input, URL state, error toasts, the Cache API second visit, IME and a keyboard tour.

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
