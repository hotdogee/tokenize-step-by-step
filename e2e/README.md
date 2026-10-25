# @tsbs/e2e

Playwright suites (`docs/design/06-quality-ci-deploy.md` §1, §4). Build first: the suites run against the built
`apps/web/dist`.

```sh
pnpm build
pnpm --filter @tsbs/e2e exec playwright install chromium firefox webkit   # once
pnpm e2e                                   # functional: specs/ on vite preview (+ headersMiddleware), chromium
E2E_FULL_MATRIX=1 pnpm e2e                 # the whole matrix (below), as CI runs it
E2E_FULL_MATRIX=1 E2E_ENGINE=webkit pnpm e2e --shard=1/3   # exactly one CI job
pnpm e2e:headers                           # headers: headers/ on wrangler dev --assets apps/web/dist
```

| Directory  | Runs against                                                             | What                                                                                                                                                                                                                                                                                                                                                                                                                                                      |
| ---------- | ------------------------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `specs/`   | `vite preview` (port `E2E_PORT`, default 4173)                           | smoke of `/` and `/about/` (title, `lang`, boot attributes, zero CSP violations, axe WCAG 2.2 AA), WP06 shell tests, WP08 board tours, device checks (touch targets on the touch projects, reflow everywhere: `device.spec.ts`), live Worker tokenization and `?mock=1` (`live-worker.spec.ts`), browser parity (`@parity`: `compilePattern` on every byte-level fixture text, o200k `.bin` through `DecompressionStream` + `readTsbv1`), guard self-test |
| `visual/`  | `vite preview`, `visual` project only                                    | 4 fixtures × 2 themes × 3 viewports, `toHaveScreenshot` (`maxDiffPixelRatio` 0.002); Linux baselines in `visual/__screenshots__/` from the `visual-baselines` CI job (`docs/release.md` § Visual baselines), skipped with a notice off Linux or while absent                                                                                                                                                                                              |
| `headers/` | `wrangler dev` (port `E2E_HEADERS_PORT`, default 8791) or `E2E_BASE_URL` | exact 06 §6 security headers, zero CSP violations, boot before `DOMContentLoaded`, the 06 §7 deploy smoke checks (`scripts/lib/smoke.ts`), live Worker tokenization under the production CSP                                                                                                                                                                                                                                                              |
| `parity/`  | —                                                                        | the harness page (browser code bundled by esbuild, served through `page.route` under the production CSP) and the digest helpers it shares with the spec                                                                                                                                                                                                                                                                                                   |
| `support/` | —                                                                        | axe harness, CSP/boot instrumentation, expected values from the design                                                                                                                                                                                                                                                                                                                                                                                    |

**Projects** (`projects.ts`): `pnpm e2e` runs chromium (1440×900). `E2E_FULL_MATRIX=1` adds firefox and webkit
(1440×900), Pixel 5, iPhone 12, chromium at 320×568, 360×780 and 2560×1440@2×, and `visual`. `E2E_ENGINE` keeps one
engine's projects — chromium: chromium, pixel-5, chromium-320/360/2560, visual; firefox: firefox; webkit: webkit,
iphone-12 — which is how CI splits the matrix into engine × 3 shards. The `@parity` specs run once per engine, not on
the device and viewport projects. No retries, except one for the WebKit projects in CI; traces are kept and screenshots
taken for failures.

Specs use each project's own device and viewport unless a test is about a specific layout (then it says so with
`test.use` / `setViewportSize`), so the matrix multiplies coverage instead of repeating one layout.

Servers are never reused: on a machine with several checkouts a running server could belong to another worktree, so a
busy port fails loudly — pick another with `E2E_PORT` / `E2E_HEADERS_PORT`. On Windows, a `wrangler dev` killed from
outside Playwright can leave `workerd.exe` listening (`docs/dev.md`).

`pnpm test` runs only `test/` here (Vitest: configuration, project matrix, expected headers); it needs no browsers.
