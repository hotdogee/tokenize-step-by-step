# Release and deployment

How the site gets from a pull request to `https://tokenize-step-by-step.<subdomain>.workers.dev`, what has to be set up
once, and the checklist signed off before the first production deploy and re-run for every release
(`docs/design/06-quality-ci-deploy.md` §4–§7; AD-3, AD-32).

## How a change ships

1. **Pull request → `ci`** (`.github/workflows/ci.yml`): `check`, `vocab` (uv, raw-vocabulary cache, `vocab:fetch`,
   conformance gate, `vocab:build`, guards), `unit`, `build` (`vite build` → `check:dist` → `wrangler deploy --dry-run`,
   uploads `dist`), `e2e` (Playwright on `vite preview`, axe), `e2e-headers` (Playwright on
   `wrangler dev --assets apps/web/dist`, plus the deploy smoke checks). When the Cloudflare secrets exist, `preview`
   publishes `pr-<n>` with `wrangler preview`, comments its URL on the PR, runs `e2e:headers` and `deploy:smoke` against
   it, and `lighthouse` runs LHCI against it. Closing the PR deletes the preview (`preview-cleanup`).
2. **Merge to `main` → `ci`** runs again on the merge commit.
3. **`deploy`** (`.github/workflows/deploy.yml`) is triggered only by that `ci` run completing successfully on `main`. It
   downloads the `dist` artifact that run tested (no rebuild), runs `wrangler deploy`, then `pnpm deploy:smoke` against
   production and a report-only Lighthouse run. A push never deploys directly, so a commit is never deployed twice.

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
   gh variable set CONFORMANCE_MODE --body skip-missing-engine   # AD-32; already set on 2026-10-25
   gh variable set PRODUCTION_URL --body https://tokenize-step-by-step.<subdomain>.workers.dev   # optional fallback
   ```

   `CONFORMANCE_MODE` stays `skip-missing-engine` until both engines exist; the PR that lands the second engine (WP05A or
   WP05B) sets it to `strict`. The `vocab` job's conformance gate (`pnpm conformance:gate`) fails as soon as both engine
   factories are exported while the variable is weaker than `strict`; `off` is never accepted in CI. An unset variable
   means `strict`. `PRODUCTION_URL` is used only if `wrangler deploy` prints no URL.

6. **Check the token** from a checkout (nothing is uploaded):

   ```sh
   CLOUDFLARE_API_TOKEN=… CLOUDFLARE_ACCOUNT_ID=… pnpm exec wrangler whoami
   CONFORMANCE_MODE=skip-missing-engine pnpm build   # ends with wrangler deploy --dry-run
   ```

7. **Branch protection on `main`**: require the status checks `check`, `vocab`, `unit`, `build`, `e2e (chromium)`,
   `e2e-headers` and `lighthouse` (a skipped job counts as passing, so `lighthouse` does not block before the secrets
   exist). The `production` environment is created by the first deploy; adding required reviewers to it pauses every
   deploy until approved.

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
      and recorded in `docs/perf-log.md`.

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
