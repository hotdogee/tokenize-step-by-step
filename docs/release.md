# Release and deployment

How the site gets from a pull request to production — `https://tokens.hanlin.uk` (a Workers Custom Domain, below) and the
Worker's own `https://tokenize-step-by-step.hotdogee.workers.dev`, which stays on for the PR previews and as the fallback —
what has to be set up once, and the checklist signed off before the first production deploy and re-run for every release
(`docs/design/06-quality-ci-deploy.md` §4–§7; AD-3, AD-32). The signed releases are at the end (§ Release 1.0.0).

## How a change ships

1. **Pull request → `ci`** (`.github/workflows/ci.yml`): `check`, `vocab` (uv, raw-vocabulary cache, `vocab:fetch`,
   conformance gate, `vocab:build`, guards), `unit`, `build` (`vite build` → `check:dist` → `wrangler deploy --dry-run`,
   uploads `dist`), `e2e` (the full Playwright matrix on `vite preview`, see below), `e2e-headers` (Playwright on
   `wrangler dev --assets apps/web/dist`, plus the deploy smoke checks). When the Cloudflare secrets exist, `preview`
   publishes `pr-<n>` with `wrangler preview`, comments its URL on the PR, runs `e2e:headers` and `deploy:smoke` against
   it, and `lighthouse` runs LHCI against it. Closing the PR deletes the preview (`preview-cleanup`).
   - **The e2e matrix** (06 §1, §4): `E2E_FULL_MATRIX=1`, one job per engine × 3 shards — `e2e (chromium n/3)` runs the
     chromium, Pixel 5, 320 × 568, 360 × 780, 2560 × 1440@2× and `visual` projects; `e2e (firefox n/3)` firefox;
     `e2e (webkit n/3)` webkit and iPhone 12 (one retry in CI; every other project has none). Each job installs only its
     browser (cached per Playwright version, `.github/actions/playwright`) plus `fonts-noto-cjk`, and uploads the HTML
     report, traces and screenshots of failures as `e2e-report-<engine>-<shard>`. The suites: shell, board, device
     (touch targets on Pixel 5 / iPhone 12, reflow on every viewport), live Worker, axe, the `@parity` harness
     (chromium, firefox, webkit) and the visual baselines (below). Locally: `E2E_FULL_MATRIX=1 pnpm e2e` (after
     `pnpm --filter @tsbs/e2e exec playwright install chromium firefox webkit`), or one CI job with
     `E2E_FULL_MATRIX=1 E2E_ENGINE=webkit pnpm e2e --shard=1/3`.
   - **Wall-time target ≤ 15 min** (06 §4): `check` ∥ `vocab` (≈ 1–4 min with warm caches) → `build` ∥ `unit` (≈ 2–3 min)
     → the nine e2e shards and `e2e-headers` in parallel. A shard runs (`playwright test --list --shard=<n>/3`) ≈ 123
     tests on chromium (six projects), 24–25 on firefox and 47 on webkit (two projects). Their summed test time, measured
     on a Windows workstation with 8 workers, is 431 s for chromium, 160 s for firefox and 600 s for webkit: per shard at
     the runner's two Playwright workers ≈ 1.2, 0.5 and 1.7 min of tests plus the setup (browser from cache, CJK fonts,
     `vite preview`). WebKit, not chromium, is the long pole, and the firefox shards are mostly setup. The Linux wall
     time, measured on the green push run of c1ff708 (run 40285194863, 2026-10-26, warm caches): 7 min 27 s end to end —
     check 1.5, vocab 0.7, build 0.6, unit 2.2 min; shards chromium 4.8 / 4.6 / 6.0, firefox 1.7 / 2.3 / 1.8, webkit
     5.1 / 4.1 / 4.1 min, e2e-headers 1.4 min. If a shard grows past ≈ 8 min, raise that
     matrix's shard count (`shard: [1, 2, 3, 4]`, `/4` in the job name and `--shard=${{ matrix.shard }}/4`) rather than
     add workers per runner; the shard checks are not required by name (item 7), so branch protection stays as it is.
2. **Merge to `main` → `ci`** runs again on the merge commit.
3. **`deploy`** (`.github/workflows/deploy.yml`) is triggered only by that `ci` run completing successfully on `main`. It
   downloads the `dist` artifact that run tested (no rebuild), runs `wrangler deploy`, then `pnpm deploy:smoke` against
   production and a report-only Lighthouse run. A push never deploys directly, so a commit is never deployed twice, and
   a manually dispatched `ci` run (the visual-baselines path below) never deploys at all.

Without the secrets (forks, Dependabot PRs, or before the setup below) `preview`, `lighthouse`, `preview-cleanup` and
`deploy` are skipped and every workflow stays green: the first job of `ci.yml` and `deploy.yml` (`cloudflare secrets`)
exposes `has_cf_secrets` and those jobs depend on it.

## One-time account setup

Do this once, before the first deploy.

1. **workers.dev subdomain.** In the Cloudflare dashboard open _Workers & Pages_ and register the account subdomain
   (`<subdomain>.workers.dev`) if the account has none yet. The Worker name comes from `wrangler.jsonc`
   (`tokenize-step-by-step`), so production is `https://tokenize-step-by-step.<subdomain>.workers.dev`.
2. **API token.** _My Profile → API Tokens → Create Token → Create Custom Token_: permission **Account › Workers Scripts ›
   Edit**, account resources limited to this one account, plus — for the custom domain (§ Custom domain) — **Zone › Zone ›
   Read**, **Zone › DNS › Edit** and **Zone › Workers Routes › Edit**, zone resources limited to `hanlin.uk`. Copy the token
   once.
3. **Account ID.** _Workers & Pages_ → the account ID in the right-hand column.
4. **Repository secrets** (_Settings → Secrets and variables → Actions_, or the CLI):

   ```sh
   gh secret set CLOUDFLARE_API_TOKEN     # paste the token
   gh secret set CLOUDFLARE_ACCOUNT_ID    # paste the account id
   ```

5. **Repository variables.**

   ```sh
   gh variable set CONFORMANCE_MODE --body strict   # AD-32; set to strict on 2026-10-25 when wave 2 merged both engines
   gh variable set PRODUCTION_URL --body https://tokenize-step-by-step.hotdogee.workers.dev   # fallback; https://tokens.hanlin.uk once attached
   ```

   `CONFORMANCE_MODE` was `skip-missing-engine` while only one engine existed (wave 1); the wave 2 integration that merged
   the second engine set it to `strict` (AD-32), so every asset must pass its fixture inside the converter. The `vocab`
   job's conformance gate (`pnpm conformance:gate`) fails whenever both engine factories are exported and the variable is
   weaker than `strict`; `off` is never accepted in CI. An unset variable means `strict`. `PRODUCTION_URL` is used only if
   `wrangler deploy` prints no URL.

6. **Check the token** from a checkout (nothing is uploaded):

   ```sh
   CLOUDFLARE_API_TOKEN=… CLOUDFLARE_ACCOUNT_ID=… pnpm exec wrangler whoami
   pnpm build   # strict conformance (the default); ends with wrangler deploy --dry-run
   ```

7. **Branch protection on `main`**: require the status checks `check`, `vocab`, `unit`, `build`, `e2e`, `e2e-headers`
   and `lighthouse` (06 §4; a skipped job counts as passing, so `lighthouse` does not block before the secrets exist).
   `e2e` is the gate job over the matrix: it fails unless every `e2e (<engine> <shard>/3)` job succeeded (it runs even
   when they are skipped, so a failed `build` fails it too). Do not require the shard checks themselves, so changing the
   shard count never leaves a required check that no longer reports; remove the `e2e (chromium)` check of waves 1–2 if
   it is still listed. The `production` environment is created
   by the first deploy; adding required reviewers to it pauses every deploy until approved.

## Custom domain

Production is served at `https://tokens.hanlin.uk` (owner decision, 2026-10-26; the `hanlin.uk` zone is on the same
Cloudflare account). `wrangler.jsonc` declares it as a Workers Custom Domain:

```jsonc
"routes": [{ "pattern": "tokens.hanlin.uk", "custom_domain": true }],
"workers_dev": true,   // the workers.dev URL and the PR preview URLs stay on
```

Nothing is attached from a developer machine: the next CI `wrangler deploy` (`deploy.yml`) creates the proxied DNS record
and the edge certificate and binds the hostname to the Worker. That needs the API token's zone permissions on `hanlin.uk`
(**Zone › Zone › Read**, **Zone › DNS › Edit**, **Zone › Workers Routes › Edit**, § One-time account setup item 2). Without
them the deploy step fails when wrangler publishes the triggers, after the new version has been uploaded, with a
Cloudflare API authentication or permission error on the zone or Workers-domains request, and the smoke checks do not
run — add the permissions and re-run the `deploy` run (Actions → the failed run → _Re-run failed jobs_); nothing else
changes. A DNS record already present for `tokens.hanlin.uk` (other than one Workers created) also fails it: remove
that record first.

Verify once the deploy is green:

```sh
curl -sI https://tokens.hanlin.uk/ | grep -iE '^(HTTP|content-security-policy)'
pnpm deploy:smoke --url https://tokens.hanlin.uk
gh variable set PRODUCTION_URL --body https://tokens.hanlin.uk   # the final launch step: deploy.yml falls back to it
```

Until then `PRODUCTION_URL` stays on the workers.dev address. The certificate can take a few minutes after the first
deploy; a `525`/`526` or a TLS error in that window is not a failure.

## Visual baselines

The `visual` project (`e2e/visual/board.visual.ts`, 06 §1) compares 4 fixtures (台灣台南 on o200k, cl100k and Grok-1;
𰻝 on Gemma 4) × 2 themes × 3 viewports (360, 768, 1440) with `toHaveScreenshot` at `maxDiffPixelRatio` 0.002. The
baselines are Linux renders (chromium + `fonts-noto-cjk` on `ubuntu-24.04`), stored as
`e2e/visual/__screenshots__/<fixture>-<theme>-<width>-linux.png`. Off Linux, or while no baseline is committed at all,
each test skips with a notice (and the `e2e (chromium 1/3)` job prints a "Visual baselines absent" notice); once any
baseline exists, a missing one fails its test. They cannot be produced on Windows or macOS — fonts and anti-aliasing
differ. To create or refresh them:

1. Actions → **ci** → _Run workflow_ on the branch whose UI the baselines should show (after the last UI change of a
   wave). Tick **open_pr** to have the run push `visual-baselines/<sha>` and open a PR (needs _Settings → Actions →
   General → Allow GitHub Actions to create and approve pull requests_); otherwise leave it off.
2. The `visual-baselines` job renders the 24 images with `--update-snapshots=all` against the `dist` that run built and
   uploads them as the **`visual-baselines`** artifact (30 days).
3. Without the PR: download the artifact (`gh run download <run-id> -n visual-baselines -D e2e/visual/__screenshots__`),
   look at every image, commit them on a branch and open a PR. With the PR: review the images in it; a PR opened with
   `GITHUB_TOKEN` does not start `ci`, so push an empty commit (or close and reopen it) to run the checks.
4. An intended UI change that moves pixels needs the same refresh in its PR; an unintended diff fails `e2e (chromium n/3)`
   with the expected/actual/diff images in the `e2e-report-chromium-<n>` artifact.

## Pre-launch re-verification of inferred mappings

Before launch and on every monthly _Re-verify inferred mappings_ issue (opened by `reverify.yml` for `models.json` rows
whose `checkedOn` is older than 90 days), re-check and then update `checkedOn` (and `fidelity` if the status changed) in
`packages/registry/data/models.json`:

- [ ] OpenAI: `tiktoken/model.py` and issue #608 / PR #616 for a `gpt-6` prefix → GPT-6 Astra / 6.1 Sol stay `inferred`
      or become `confirmed`.
- [ ] Google: `python-genai/_local_tokenizer_loader.py` for `gemini-3.6/3.8/4-*` entries → Gemini 4 Argon.
- [ ] Meta: Meta Model API docs / HF `meta-models` for a Muse Wonder tokenizer statement.
- [ ] xAI: `xai-org` on HF/GitHub for any Grok 3/4 tokenizer file; the `/v1/tokenize-text` docs example still reproduces
      with Grok-2; current model slugs in `byok.json`.
- [ ] Anthropic: current `anthropic-version`, `Authorization: Bearer` primary, still-callable v3-reference models
      (Opus 4.6 / Sonnet 4.6) in `byok.json`.

`node scripts/reverify.ts` prints the same list locally.

## Deploy verification

`pnpm deploy:smoke --url <base> --dist apps/web/dist` automates items 6–8; CI runs it after every preview and production
deploy, and `e2e-headers` runs it against `wrangler dev` on every PR. By hand:

```sh
BASE=https://tokens.hanlin.uk   # or https://tokenize-step-by-step.hotdogee.workers.dev before the domain is attached
BIN=$(jq -r '.assets | to_entries | max_by(.value.bytesCompressed) | .value.path' data/vocab/dist/vocab-manifest.generated.json)
JS=/assets/$(ls -S apps/web/dist/assets/*.js | head -1 | xargs basename)
```

- [ ] **6. Largest vocabulary file.** `curl -s -D - -o /dev/null -H 'Accept-Encoding: zstd, br, gzip' "$BASE$BIN"` (a GET; the edge answers HEAD without `Content-Length`) → `200`, **no**
      `Content-Encoding`, `Content-Length` equal to the manifest's `bytesCompressed`, `Content-Type` exactly
      `application/octet-stream` (one value), `Cache-Control: public, max-age=31536000, immutable`,
      `X-Content-Type-Options: nosniff`, `Cross-Origin-Resource-Policy: same-origin`. Record the transferred bytes and the
      loader's `layer` / `contentEncoding` diagnostics (About › Diagnostics) in `docs/perf-log.md`.
- [ ] **7. Compressed assets.** `curl -sI -H 'Accept-Encoding: zstd, br, gzip' "$BASE$JS"` (and one `/examples/*.json`) →
      `Content-Encoding` zstd, br or gzip, an `ETag`, immutable caching; repeating with `-H "If-None-Match: <etag>"`
      returns `304`.
- [ ] **8. Pages and guards.** `curl -sI "$BASE/"` → `Content-Security-Policy` exactly as in `apps/web/public/_headers`
      (06 §6); `curl -sI "$BASE/index.html"` → `307` with `location: /`; `curl -s -o /dev/null -w '%{http_code}' "$BASE/nope"`
      → `404` with the `404.html` page; `"$BASE/.env"` → `404`.
- [ ] **9. Performance.** `pnpm lhci --collect.url="$BASE/"` meets 06 §3 (mobile, Lighthouse "Slow 4G"); a Safari 16.4 /
      iOS 16.4 smoke on BrowserStack (Playwright WebKit is newer than the floor); one mid-range Android Chrome run timed
      and recorded in `docs/perf-log.md`. A manual macOS Safari morph check: Web Inspector › Timelines while pressing `2`
      then `3` on 150 ideographs (600 cells); record the longest frame and any dropped frames in `docs/perf-log.md` (the
      06 §3 morph bound is enforced per main-thread task in desktop chromium only, and no Safari number exists), plus a
      headed Chrome check in DevTools › Performance on the same 600 cells: record the longest presented frame, since the
      wave 3 review traced longest tasks of 26–27 ms (inside the 32 ms bound) but one 38–41 ms DrawFrame at the commit in
      every trace. This is a known risk, not a formality: Playwright WebKit on Windows had 12–13 of 31 rAF intervals above 33 ms (max 74–82 ms,
      idle max 31 ms) on the same morph in the wave 3 review, against 17–33 ms in chromium. If Safari confirms long frames,
      fix it before launch in `apps/web/src/motion/choreography.ts`: skip the counter-scaled FLIP above a cell threshold
      on WebKit, or cross-fade only. The Android run follows the script below (§ Mid-range Android check). Only a
      deployed URL (the PR preview in the `lighthouse` job, or production) is budget-authoritative: `pnpm lhci-local`
      runs the same `lighthouserc.json` against `wrangler dev` on loopback (no edge compression, no HTTP/3, no real RTT)
      as a smoke read and never fails on an assertion.

### Mid-range Android check (2 minutes, owner)

One run on a mid-range Android phone (Chrome, the phone's usual network; 06 §3 budgets: o200k loaded ≤ 4 s on a mid
phone, keystroke → board update p95 ≤ 50 ms at 1k characters). Record the numbers in the open row of `docs/perf-log.md`
(§ production, 2026-10-26).

1. **0:00** — Chrome → ⋮ → _New Incognito tab_ (empty HTTP cache and Cache API, as a first visit). Have a stopwatch ready.
2. **0:10** — type `tokens.hanlin.uk` (or `tokenize-step-by-step.hotdogee.workers.dev` until the domain is attached)
   and start the stopwatch as you tap _Go_. Note **A** when the board first shows 台灣台南 and **B** when the counts line's
   badge turns to **LIVE** (o200k downloaded, verified and resident).
3. **0:40** — tap the text box, put the cursor after 台南 and type `hello 東京` at normal speed. Note whether the board
   keeps up with each keystroke (**C**: "keeps up" or the longest visible lag, in tenths of a second).
4. **1:00** — tap the rail's **5 Merges** stop, then drag the scrubber from end to end and back. Note **D**: smooth, or
   visible stutter.
5. **1:20** — tap the **3 UTF-8 bytes** stop, then **6 Tokens** (the morph). Note **E**: smooth, or visible stutter.
6. **1:35** — footer → _About_ → _Diagnostics_. Copy the "last load" line (**F**: ms, network or cache, KB transferred,
   layer, content encoding) and the feature list.
7. **1:50** — note the phone model, Android and Chrome versions (Chrome → ⋮ → _Settings_ → _About Chrome_) and the
   network (Wi-Fi / 4G / 5G).

## Legal and content

- [ ] **10.** About renders every `shipIntent: ship` asset; the xAI notice sentence is exact (“Copyright © xAI 2026”);
      "Powered by xAI" is visible with Grok-2 selected; "Built with Meta Llama 3" and its Notice; the Gemma Notice, Terms
      copy and Prohibited Use Policy link; MIT texts; MODIFIED statements; owner sign-off on the wording.
- [ ] **11.** Native-speaker review of zh-TW (owner, at the launch checkpoint) complete; ja ships as drafted with the
      corrections invitation on About; glossary applied.
- [ ] **12.** Manual screen-reader scripts (NVDA + Firefox, VoiceOver + Safari) and the 360 px touch pass of
      `docs/a11y-checklist.md` complete.
- [ ] **13.** `oracle:check` and `unicode:check` green on the release commit; `vocab-manifest.generated.json` matches the
      deployed `/tok/*` listing (`check:dist` cross-checks it at build time); `CONFORMANCE_MODE` is `strict`.

## Known issues

- **Dependabot's npm job fails with an unknown error** on pnpm 12.14.0 (the `packageManager` pin, PA-1): every
  `npm_and_yarn` run since the first (2026-10-25) failed, while the `github_actions` runs succeed. No fix in v1.0.0:
  re-check when Dependabot's pnpm support catches up, and meanwhile run `pnpm outdated -r` / `pnpm audit --prod` by hand
  (`check` runs the audit on every PR).
- **Slow Azure Ubuntu mirror on CI runners.** `playwright install-deps` (`.github/actions/playwright`) fetches ≈ 52 MB of
  WebKit / Firefox system packages from `azure.archive.ubuntu.com`; on 2026-10-26 (dispatched run 40300681611) two shards
  downloaded at ≈ 40 KB/s and hit the job's 20-minute limit before any test ran (7 of 9 shards passed). If a shard is
  cancelled at 20 min inside _Run ./.github/actions/playwright_, re-run the failed jobs; a deploy waits for a green `ci`.
- **The pipeline-trace 64 ms parallel ceiling** (`e2e/specs/pipeline-trace.spec.ts`) can flake only when every engine
  runs in one container at once; the CI shards are green and the ceiling stays as it is.

## Rollback

- **Fastest — previous Worker version:** `pnpm exec wrangler deployments list` shows the recent versions (each deploy's
  message is `ci <commit sha>`); `pnpm exec wrangler rollback <version-id> --message "rollback: <reason>"` makes an earlier
  version live again within seconds. Run it with the same token and account id as CI.
- **Redeploy a previous commit (the documented path):** re-run the `deploy` workflow run of the last good commit from the
  Actions tab — it downloads that commit's tested `dist` artifact again (kept 30 days for `main`). Older than that:
  `git revert` the bad commit on a branch, open a PR and merge; `ci` → `deploy` ships the reverted tree.
- **Asset withdrawal** (e.g. the xAI licence is revoked): set `withdrawn: true` on the tokenizer in
  `packages/registry/data/tokenizers.json`; the converter skips it and About states the withdrawal. Merge, and the
  regular `ci` → `deploy` run removes the asset within one CI run.

## Troubleshooting

- _Conformance gate failed_: both engines are exported but `CONFORMANCE_MODE` is not `strict` — run
  `gh variable set CONFORMANCE_MODE --body strict`.
- _No preview on a PR_: the PR comes from a fork or Dependabot (no secrets), or the secrets are not set; the
  `cloudflare secrets` job prints a notice.
- _Deploy skipped_: the `ci` run did not succeed, was not a push to `main`, or the secrets are missing.
- _An e2e shard failed_: download `e2e-report-<engine>-<shard>` and open `playwright-report/functional/index.html`
  (traces: `pnpm exec playwright show-trace <trace.zip>`). Reproduce one job locally with
  `E2E_FULL_MATRIX=1 E2E_ENGINE=<engine> pnpm e2e --shard=<n>/3`. A WebKit-only failure is often a real Safari difference
  (wave 3 found two: a re-evaluated Worker entry module and radios that do not take focus on click), not a flaky test.

## Release 1.0.0 — 2026-10-26

Signed on 2026-10-26 by the WP13b launch engineer against **`a313ef2`** on `main` (the PA-15 static first paint, the
wave 4 fixes, the Linux visual baselines, the re-verified registry and the custom domain); the tag **`v1.0.0`** is the
commit that adds this section, on top of it. **Production URL:** `https://tokenize-step-by-step.hotdogee.workers.dev`
(live, serving `c1ff708`, deploy run 40285946585), and `https://tokens.hanlin.uk` once the release push's CI deploy has
attached it (§ Custom domain). The checks marked _production_ ran against `c1ff708`: the release changes no vocabulary
file, header or licence text, and the verification after the release push repeats them on its deploy.

| #      | Item                                           | Status  | Evidence (2026-10-26)                                                                                                                                                                                                                                                                                                                                                                                                                                                    |
| ------ | ---------------------------------------------- | ------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Re-1   | OpenAI mapping                                 | done    | `tiktoken/model.py` (release 0.14.0) maps no `gpt-6` prefix; PR #616 open and unmerged, issue #608 closed → GPT-6 Astra / 6.1 Sol stay `inferred`.                                                                                                                                                                                                                                                                                                                       |
| Re-2   | Google mapping                                 | done    | `_local_tokenizer_loader.py` (last change 2026-08-10): gemini-2.0/2.5/3 previews → gemma3, gemini-3.1/3.5 → gemma4, no 3.6/3.8/4 entry → Gemini 4 Argon, 3.6/3.8 Flash stay `inferred`.                                                                                                                                                                                                                                                                                  |
| Re-3   | Meta mapping                                   | done    | No Muse Wonder tokenizer statement; HF `meta-models` lists Glimmer and Spark Open only → Muse Wonder stays `inferred`.                                                                                                                                                                                                                                                                                                                                                   |
| Re-4   | xAI mapping                                    | done    | `xai-org` on HF: grok-1 and grok-2 only; the `/v1/tokenize-text` example (`latest`, `Hello world!` → 13902, 1749, 161) unchanged and reproduced by the Grok-2 fixture; grok-4.7 / 4.6 / 4.5 / 4.3 are the current text models, as in `byok.json`.                                                                                                                                                                                                                        |
| Re-5   | Anthropic BYOK                                 | done    | `anthropic-version` 2026-10-21 still the latest; `Authorization: Bearer` primary (`x-api-key` a legacy fallback); Opus 4.6 / Sonnet 4.6 still available (legacy). All 38 `models.json` rows and `byok.json` re-dated `checkedOn` 2026-10-26, every `evidenceUrl` 200, no status change; `registry:check` and the registry tests green.                                                                                                                                   |
| 5a     | One-time account setup                         | done    | Secrets since 2026-10-25; `CONFORMANCE_MODE` strict; `PRODUCTION_URL` = the workers.dev URL (re-set 2026-10-26). The zone permissions for `tokens.hanlin.uk` are the owner's (below).                                                                                                                                                                                                                                                                                    |
| 6      | Largest vocabulary file (_production_)         | done    | `/tok/google-gemma4/95b2821652a7.bin`: 200, `Content-Length` 1,658,262 = `bytesCompressed`, no `Content-Encoding` with `zstd, br, gzip` offered, `Content-Type` exactly `application/octet-stream`, `immutable`, `nosniff`, CORP `same-origin`; transferred bytes and loader diagnostics in `docs/perf-log.md` (§ production, launch).                                                                                                                                   |
| 7      | Compressed assets (_production_)               | done    | `/assets/main-C6VqvXyV.js` and `/examples/anthropic-claude-legacy.d9b81657.json`: `zstd`, weak ETag, `immutable`, `304` on `If-None-Match`.                                                                                                                                                                                                                                                                                                                              |
| 8      | Pages and guards (_production_)                | done    | `/` CSP byte-identical to `_headers` (06 §6); `/index.html` → 307 `/`; `/nope` → 404 with the `404.html` body; `/.env` → 404. `pnpm deploy:smoke` 10/10 against the deployed `dist`; `E2E_BASE_URL=<production> pnpm e2e:headers` 6/6 (zero CSP violations, boot before `DOMContentLoaded`, live Worker typing).                                                                                                                                                         |
| 9a     | Lighthouse on production                       | blocked | 99 / 100 / 100, LCP 1,567, TBT 62, CLS 0 and every transfer budget met, but FCP 1,511 ms on the best run (> 1,500 by 11 ms) on the pre-PA-15 page. PA-15 (−396 to −407 ms FCP measured) ships with this release: blocked on the release deploy, where the post-push verification re-runs `pnpm lhci`.                                                                                                                                                                    |
| 9b     | Perf spec on production                        | done    | All budgets met: o200k `loaded.ms` 1,165 ms (Fast 4G, ≤ 2,500), keystroke p95 18.6 / 26.3 ms at 1k / 10k (≤ 50 / 120), longest task 9.8 ms typing and 14.8 ms scrubbing (≤ 50), 2,000-cell render 14.9 ms (≤ 50).                                                                                                                                                                                                                                                        |
| 9c     | Safari 16.4 / iOS 16.4 smoke (BrowserStack)    | owner   | No BrowserStack access from this build. Playwright WebKit (newer than the floor) and iPhone 12 are green in the matrix.                                                                                                                                                                                                                                                                                                                                                  |
| 9d     | Mid-range Android Chrome run                   | owner   | The owner runs § Mid-range Android check on production and fills the open row in `docs/perf-log.md`.                                                                                                                                                                                                                                                                                                                                                                     |
| 9e     | macOS Safari morph + headed Chrome frame check | owner   | Needs a Mac (Web Inspector › Timelines) and a headed Chrome (DevTools › Performance) on 150 ideographs; record in `docs/perf-log.md`.                                                                                                                                                                                                                                                                                                                                    |
| 10     | Legal notices (_production_)                   | done    | Live About, 24/24 checks: the 9 `shipIntent: ship` assets with upstream and served SHA-256 and MODIFIED statements; the xAI sentence exact ("… Copyright © xAI 2026."); "Powered by xAI" visible with Grok-2 and absent otherwise; "Built with Meta Llama 3" + `NOTICE.txt`; Gemma Notice, Terms copy and Prohibited Use Policy link; the tiktoken and Anthropic MIT texts render; 18 `/licenses/*` links answer 200. Wording: the owner's legal defaults of 2026-10-25. |
| 11     | zh-TW / ja copy                                | owner   | The owner reviewed the zh-TW catalog on the side-by-side page and ships it as is (2026-10-26); a native-speaker review remains open. ja ships as drafted with the corrections invitation on About; the 05 §10 glossary is enforced by the catalog tests.                                                                                                                                                                                                                 |
| 12     | Screen-reader scripts and 360 px touch pass    | owner   | `docs/a11y-checklist.md` (NVDA + Firefox, VoiceOver + Safari, the 360 px touch pass) needs the owner's devices; automated: axe zero violations and the touch-target, reflow and focus-not-obscured specs green across the matrix.                                                                                                                                                                                                                                        |
| 13     | Oracles, Unicode, manifest, conformance        | done    | `pnpm oracle:check` (12 fixtures, 0 stale, licence docs, Unicode tables) and `pnpm unicode:check` green on the release tree; `vocab-manifest.generated.json` equals the deployed `/tok/*` listing (9/9, 200, byte-exact lengths); `CONFORMANCE_MODE` strict; `pnpm build` green with strict conformance on all 9 assets and every size budget.                                                                                                                           |
| Visual | Linux visual baselines                         | done    | 24 PNGs from the `visual-baselines` job of ci run 40300681611 (c1ff708), reviewed and committed; the release renders them pixel-identically outside the masked build stamp (all 24 cases rendered locally from both builds).                                                                                                                                                                                                                                             |
| Tests  | Release tree                                   | done    | Lint, typecheck, `format:check`, `knip` clean; Vitest 1,460 passed (31 skipped) + browser mode 119 passed; full Playwright matrix (`E2E_FULL_MATRIX=1`, 8 projects, Windows) 1,176 passed, 95 skipped (the visual project skips off Linux), 0 failed.                                                                                                                                                                                                                    |

**Minors fixed for the release:** the page guard files errors by when they were raised (events in flight are flushed
before a navigation); a reopened picker forgets a pending live-check request; the switch helpers wait for the new
tokenizer's live result and the end of the crossfade before the next click (the two one-in-1,117 matrix flakes). The
BYOK drawer's focus race with the picker's close was already fixed in `6f353b9` (the drawer is asked for only from the
dialog's `onclosed`). Left as they are: the pipeline-trace 64 ms ceiling, Dependabot's npm job (§ Known issues).

**Owner follow-ups:**

1. **Branch protection on `main`** (§ One-time account setup item 7) — enabled by the orchestrator right after the
   release push; required checks would have blocked the direct pushes this build used.
2. **Custom domain:** the CI token's Zone › Zone › Read, Zone › DNS › Edit and Zone › Workers Routes › Edit on
   `hanlin.uk`. If the release deploy fails on permissions, add them and re-run it; once it is green,
   `gh variable set PRODUCTION_URL --body https://tokens.hanlin.uk` — the final launch step (§ Custom domain).
3. **The mid-range Android run** (§ Mid-range Android check) into `docs/perf-log.md`.
4. **The native-speaker zh-TW review** (item 11).
5. The manual screen-reader scripts and the 360 px touch pass (item 12); the Safari 16.4 / iOS 16.4 BrowserStack smoke,
   the macOS Safari morph check and the headed Chrome frame check (items 9c, 9e).
