# Release and deployment

How the site gets from a pull request to `https://tokenize-step-by-step.<subdomain>.workers.dev`, what has to be set up
once, and the checklist signed off before the first production deploy and re-run for every release
(`docs/design/06-quality-ci-deploy.md` §4–§7; AD-3, AD-32).

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
     time is not measured yet; record it here from the first full CI run. If a shard grows past ≈ 8 min, raise that
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
   Edit**, account resources limited to this one account, no zone permissions. Copy the token once.
3. **Account ID.** _Workers & Pages_ → the account ID in the right-hand column.
4. **Repository secrets** (_Settings → Secrets and variables → Actions_, or the CLI):

   ```sh
   gh secret set CLOUDFLARE_API_TOKEN     # paste the token
   gh secret set CLOUDFLARE_ACCOUNT_ID    # paste the account id
   ```

5. **Repository variables.**

   ```sh
   gh variable set CONFORMANCE_MODE --body strict   # AD-32; set to strict on 2026-10-25 when wave 2 merged both engines
   gh variable set PRODUCTION_URL --body https://tokenize-step-by-step.<subdomain>.workers.dev   # optional fallback
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
BASE=https://tokenize-step-by-step.<subdomain>.workers.dev
BIN=$(jq -r '.assets | to_entries | max_by(.value.bytesCompressed) | .value.path' data/vocab/dist/vocab-manifest.generated.json)
JS=/assets/$(ls -S apps/web/dist/assets/*.js | head -1 | xargs basename)
```

- [ ] **6. Largest vocabulary file.** `curl -sI -H 'Accept-Encoding: zstd, br, gzip' "$BASE$BIN"` → `200`, **no**
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
      06 §3 morph bound is enforced per main-thread task in desktop chromium only, and no Safari number exists). This is a
      known risk, not a formality: Playwright WebKit on Windows had 12–13 of 31 rAF intervals above 33 ms (max 74–82 ms,
      idle max 31 ms) on the same morph in the wave 3 review, against 17–33 ms in chromium. If Safari confirms long frames,
      fix it before launch in `apps/web/src/motion/choreography.ts`: skip the counter-scaled FLIP above a cell threshold
      on WebKit, or cross-fade only. Only a
      deployed URL (the PR preview in the `lighthouse` job, or production) is budget-authoritative: `pnpm lhci-local`
      runs the same `lighthouserc.json` against `wrangler dev` on loopback (no edge compression, no HTTP/3, no real RTT)
      as a smoke read and never fails on an assertion.

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
