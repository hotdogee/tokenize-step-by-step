# @tsbs/e2e

Playwright suites (`docs/design/06-quality-ci-deploy.md` §1, §4). Build first: the suites run against the built
`apps/web/dist`.

```sh
pnpm build
pnpm --filter @tsbs/e2e exec playwright install chromium   # once
pnpm e2e           # functional: specs/ on vite preview (+ headersMiddleware), chromium
pnpm e2e:headers   # headers: headers/ on wrangler dev --assets apps/web/dist
```

| Directory  | Runs against                                                             | What                                                                                                                                                                                                                                                       |
| ---------- | ------------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `specs/`   | `vite preview` (port `E2E_PORT`, default 4173)                           | smoke of `/` and `/about/` (title, `lang`, boot attributes, zero CSP violations, axe WCAG 2.2 AA), WP06 shell tests, WP08 board tours, live Worker tokenization and `?mock=1` (`live-worker.spec.ts`), browser-parity harness (`@parity`), guard self-test |
| `headers/` | `wrangler dev` (port `E2E_HEADERS_PORT`, default 8791) or `E2E_BASE_URL` | exact 06 §6 security headers, zero CSP violations, boot before `DOMContentLoaded`, the 06 §7 deploy smoke checks (`scripts/lib/smoke.ts`), live Worker tokenization under the production CSP                                                               |
| `parity/`  | —                                                                        | the harness page (browser code bundled by esbuild, served through `page.route` under the production CSP)                                                                                                                                                   |
| `perf/`    | `vite preview` (port `E2E_PERF_PORT`, default 4174), `pnpm e2e:perf`     | WP12 perf spec, own config (chromium, one worker): o200k load on CDP Fast 4G (`loaded.ms`), keystroke → board update at 1k/10k with a trace, 2,000-cell render, scrub trace; soft budgets (`PERF_STRICT=1` to fail), results in `test-results/perf/`       |
| `support/` | —                                                                        | axe harness, CSP/boot instrumentation, expected values from the design                                                                                                                                                                                     |

**Projects** (`projects.ts`): chromium only (PA-5). `E2E_FULL_MATRIX=1` adds firefox, webkit (1440×900), Pixel 5,
iPhone 12 and chromium at 320×568, 360×780 and 2560×1440@2×; WP11's wave-3 pass turns it on in CI. The `@parity` specs
run once per engine, not on the device and viewport projects.

Servers are never reused: on a machine with several checkouts a running server could belong to another worktree, so a
busy port fails loudly — pick another with `E2E_PORT` / `E2E_HEADERS_PORT`. On Windows, a `wrangler dev` killed from
outside Playwright can leave `workerd.exe` listening (`docs/dev.md`).

`pnpm test` runs only `test/` here (Vitest: configuration, project matrix, expected headers); it needs no browsers.
