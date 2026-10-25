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
