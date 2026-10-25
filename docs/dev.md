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
pnpm lint && pnpm typecheck && pnpm format:check && pnpm test
CONFORMANCE_MODE=skip-missing-engine pnpm build   # vocab:build → vite build → check:dist → wrangler deploy --dry-run
pnpm --filter @tsbs/web preview                     # production bundle with every _headers line, CSP included
```

`pnpm build` runs `tsbs-vocab build`, which takes its conformance mode from `--conformance`, then from the
`CONFORMANCE_MODE` environment variable, then defaults to `strict` (AD-32). Until both engines exist, use
`skip-missing-engine` (CI reads the repository variable of the same name). In PowerShell:
`$env:CONFORMANCE_MODE = 'skip-missing-engine'; pnpm build`.

Package tests live in `packages/<name>/test/` with their own `tsconfig.json` (Node types), so `src/` stays free of DOM and
Node APIs where `docs/design/02-architecture.md` §4 requires it. `tsc -b` writes declaration output for project
references to `node_modules/.cache/tsbuild/`.

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
  helps. CI runs on Linux and is unaffected. (Not observed during WP00: `wrangler deploy --dry-run` worked from a
  worktree path; the note is kept from the design's risk register, 07 §5 item 12.)
