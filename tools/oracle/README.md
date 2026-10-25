# Oracle tooling

Python tooling for the tokenize-step-by-step visualizer. It lives apart from the
web app and produces two committed outputs: provenance (pinned, hash-verified
upstream vocabularies plus licence snapshots) and golden test fixtures. It
also exports the Unicode tables that the web app's pre-tokenizer uses
(`unicode_tables.json`).

**Current stage.** Two stages are complete:

1. **Provenance and fetching.** `manifest.json` pins every upstream tokenizer
   file to a URL and revision. `fetch_vocab.py` downloads each file, verifies
   its SHA-256 and snapshots its licence texts into `docs/licenses/`.
2. **Golden fixtures.** Reference oracles in three families (tiktoken-bpe,
   sentencepiece-bpe, ctok-tiling) encode a fixed 374-case corpus into 12
   fixtures under `fixtures/`.

The next stage is the web app's TypeScript tokenizers. They will be tested
against these fixtures. No web-app code lives here.

## Prerequisites

- [uv](https://docs.astral.sh/uv/) 0.9 or newer. Ruff runs through `uvx`.
- CPython 3.13. The project pins `requires-python = ">=3.13,<3.14"`, so run
  `uv python install 3.13` if uv cannot find one.
- Network access to huggingface.co, raw.githubusercontent.com, api.github.com,
  openaipublic.blob.core.windows.net, registry.npmjs.org, pypi.org,
  files.pythonhosted.org, www.apache.org and ai.google.dev. Only
  `pin_manifest.py` and `fetch_vocab.py` use the network. `make_corpus.py` and
  `gen_fixtures.py` run offline from `data/vocab/raw/`.

## Setup

Run all commands from the repository root:

```sh
uv sync --project tools/oracle        # creates tools/oracle/.venv from uv.lock
```

The virtual environment lives in `tools/oracle/.venv/` and is gitignored.
Dependencies are pinned exactly in `pyproject.toml` and locked in `uv.lock`:

| Package | Version | Used for |
|---|---|---|
| tiktoken | 0.14.0 | tiktoken-bpe oracle |
| regex | 2026.9.29 | pre-tokenizer `pat_str` matching (`\p{..}` classes, possessive quantifiers) |
| sentencepiece | 0.2.2 | sentencepiece-bpe oracle (Grok-1, Gemma 1/2); Gemma 4 cross-check |
| protobuf | 7.36.2 | parsing `.model` files through `sentencepiece.sentencepiece_model_pb2` (piece types, normaliser flags). sentencepiece does not depend on it, so it is listed explicitly. |
| tokenizers | 0.23.3 | Gemma 4 oracle; HF cross-checks for Llama 3 and Llama 4 / Muse |
| huggingface_hub | 2.3.0 | a dependency of tokenizers, pinned explicitly. No script imports it, because fetching uses `urllib` to keep the provenance code auditable. |
| ctok | 1.3.0 | ctok-tiling oracle |

`google-genai` is deliberately not installed. The research found that
google-genai 2.33.0 crashes with sentencepiece 0.2.2.

Lint and format settings are in `[tool.ruff]` in `pyproject.toml`: line length
120, rules `E, F, W, I, B, UP`, and isort first-party `oracle_lib` and `oracles`.
The target version is inferred from `requires-python`. Ruff is not a project
dependency.

## Commands

The full list, from the repository root:

```sh
# Provenance
uv run --project tools/oracle python tools/oracle/pin_manifest.py [--asset ID ...]     # re-resolve url/revision (never hashes)
uv run --project tools/oracle python tools/oracle/fetch_vocab.py [--asset ID ...]      # download + verify + snapshot licences
uv run --project tools/oracle python tools/oracle/fetch_vocab.py --update-manifest     # accept new/changed hashes (human review!)
uv run --project tools/oracle python tools/oracle/render_license_docs.py               # regenerate docs/licenses/README.md + NOTICE files

# Corpus and fixtures
uv run --project tools/oracle python tools/oracle/make_corpus.py --export-alphabet     # rewrite corpus.json + alphabet.json
uv run --project tools/oracle python tools/oracle/gen_fixtures.py                      # all families; deletes orphaned fixtures
uv run --project tools/oracle python tools/oracle/gen_fixtures.py --family sentencepiece --tokenizer google-gemma2
uv run --project tools/oracle python tools/oracle/gen_fixtures.py --list               # registered families

# Unicode tables for the web app's pre-tokenizer
uv run --project tools/oracle python tools/oracle/export_unicode_tables.py             # rewrite unicode_tables.json

# Batch oracle for the web app's fuzz run (`pnpm test:fuzz` starts it with --serve)
uv run --project tools/oracle python tools/oracle/fuzz_oracle.py --input req.json --output res.json

# Full check suite (CI). Every command must exit 0.
uv run --project tools/oracle python tools/oracle/fetch_vocab.py                       # idempotent: everything "cached"
uv run --project tools/oracle python tools/oracle/make_corpus.py --check
uv run --project tools/oracle python tools/oracle/gen_fixtures.py --check
uv run --project tools/oracle python tools/oracle/render_license_docs.py --check
uv run --project tools/oracle python tools/oracle/export_unicode_tables.py --check
uvx ruff check tools/oracle
uvx ruff format --check tools/oracle
```

`uv run --project tools/oracle tools/oracle/<script>.py` (without `python`)
works too.

## Fetching (`fetch_vocab.py`)

`fetch_vocab.py` writes every manifest file to
`data/vocab/raw/<asset-id>/<name>` (gitignored). It copies each file with a
licence-like role into `docs/licenses/<asset-id>/` (committed), unless the file
is marked `snapshot: false` (see *Volatile files*). Files that are
already present and valid are skipped. It exits with status 1 if any file
fails verification, and prints a table with one row per file:

| Status       | Meaning |
|--------------|---------|
| `cached`     | Already on disk, and its SHA-256 and size match the manifest. |
| `restored`   | A `volatile` file (or one extracted from an unsnapshotted page), copied from its committed `docs/licenses` snapshot, which matches the manifest. |
| `unsnapshotted` | A `volatile` file marked `snapshot: false`. It is neither required on disk nor downloaded; its recorded hash is a retrieval record. |
| `fetched`    | Downloaded, extracted or derived, and it matches the manifest. |
| `accepted`   | No hash was recorded, so the observed hash was written (`--update-manifest` only). |
| `updated`    | The hash differed and the new hash was accepted (`--update-manifest` only). |
| `MISMATCH`   | The observed hash differs from the manifest. The file is **not** written. |
| `UNRECORDED` | The manifest has no hash yet. The file is **not** written. |
| `GATED`      | HTTP 401/403. The file is skipped and never bypassed. |
| `ERROR`      | Any other failure, including a host-attested digest mismatch. |

Host-attested digests are checked on every download, even with
`--update-manifest`. They are npm `sha512-` integrity, the PyPI `sha256:`
digest and a pinned `Content-MD5`. Archive members are read into memory by
exact name. Nothing is ever extracted to disk under a path taken from an archive.

**`url` pins are mutable upstream.** The `url` source type covers hosts that
have no revision system: the Azure blob host for the `.tiktoken` rank files,
www.apache.org for the Apache-2.0 text, and ai.google.dev for the Gemma Terms of
Use. The URL can serve different bytes tomorrow. The recorded `ETag` or
`Last-Modified` value is only a hint. The integrity guarantee is the recorded
SHA-256, plus the host's `Content-MD5` where one is pinned (the Azure blobs). If
upstream content changes, `fetch_vocab.py` fails with `MISMATCH` and never
silently accepts the change.

**Volatile files.** Some pages can never be re-downloaded byte-identically.
ai.google.dev, for example, renders a fresh CSP nonce into every response. These
files carry a `volatile` reason in the manifest. `fetch_vocab.py` restores them
from the committed snapshot and downloads them only when no valid snapshot
exists. To refresh one, delete both copies (`docs/licenses/...` and
`data/vocab/raw/...`), run with `--update-manifest`, and review the diff.

A volatile file can also be marked `snapshot: false`. It is then kept out of
`docs/licenses/` and out of the required files, and `fetch_vocab.py` reports
it as `unsnapshotted` without downloading it. Its recorded `sha256`, `bytes`,
`retrievedOn` and `httpHeaders` stay in the manifest as the record of the
retrieval. The raw Gemma Terms of Use HTML is such a file: the page carries
third-party analytics ids and feature flags, so only the extracted
`gemma-terms-of-use.txt` is committed as the evidence (planner amendment
PA-4). A file extracted from an unsnapshotted page is restored from its own
committed snapshot. If that snapshot is missing too, the page is downloaded
fresh, the text is extracted again and checked against the text file's own
SHA-256. To refresh the page record, set `snapshot` to `true`, then follow the
refresh steps above.

## Updating upstream pins (human in the loop)

1. Re-resolve the pins. This rewrites `url`/`revision` but never hashes:

   ```sh
   uv run --project tools/oracle python tools/oracle/pin_manifest.py
   ```

2. Fetch. If upstream content changed, this fails with `MISMATCH`:

   ```sh
   uv run --project tools/oracle python tools/oracle/fetch_vocab.py
   ```

3. Inspect the change (diff the vocabulary, re-read the licence), then accept it.
   **`--update-manifest` is the only way a new or changed hash enters the
   manifest:**

   ```sh
   uv run --project tools/oracle python tools/oracle/fetch_vocab.py --update-manifest
   uv run --project tools/oracle python tools/oracle/render_license_docs.py
   ```

4. Review `git diff tools/oracle/manifest.json docs/licenses/` before committing.

To add an asset, add an entry to `manifest.json` with `url`, `revision`,
`bytes`, `sha256`, `retrievedOn` and `contentType` set to `null`. Then run
steps 1 to 3 with `--asset <id>`. Run the fetch without `--update-manifest`
first, and compare the printed observed hashes with an independent source
before you accept them.

Optional: set `GITHUB_TOKEN` in your environment to lift the GitHub API's limit
of 60 unauthenticated requests per hour. The token is only sent to
api.github.com and is never written anywhere.

## Manifest (`manifest.json`)

The top level has `schemaVersion` (1), `about`, and an ordered `assets` list
(12 assets today). Each asset has:

- `id`, `lab`, `description`, `notes` (provenance findings).
- `shipIntent`: `ship`, `oracle-only` or `phase-2`. An optional `shipNote` qualifies it.
- `license`: `spdx` (an SPDX id or expression, or `LicenseRef-*` for licences
  that are not on the SPDX list; `google-gemma2` records
  `Apache-2.0 (repo) + LicenseRef-Gemma-Terms-of-Use (applicability unresolved)`),
  `file` (the primary licence file among the asset's files), `sourceUrl` (its
  pinned URL), `snapshotPath` (its copy under `docs/licenses/`), and
  `obligations` (a plain-language list). An optional `notice` (`{file, text}`)
  is an attribution Notice file that the licence requires the distributor to
  write, not an upstream file (Llama 3's `NOTICE.txt`). `render_license_docs.py`
  renders it to `docs/licenses/<asset-id>/<file>`, and `--check` verifies it.
- `files[]`, where each file has:
  - `name`: the path under `data/vocab/raw/<asset-id>/` (it may contain `/`).
  - `role`: `vocab`, `config`, `archive`, `license`, `notice`, `policy` or
    `license-evidence`. The last four are snapshotted into `docs/licenses/`.
  - `source`: how the file is located upstream (see below).
  - `url` and `revision`: the pinned location, written by `pin_manifest.py`.
  - `httpHeaders`: only for `url` sources (`etag`, `lastModified`, `contentMd5`).
  - `bytes`, `sha256`, `retrievedOn` (UTC date) and `contentType`: observed
    facts, written only by `fetch_vocab.py --update-manifest`. `contentType`
    is the server's `Content-Type` header. For derived files, it comes from a
    fixed extension table instead.
  - `volatile` (optional): why a re-download cannot reproduce `sha256` (see
    *Volatile files*). Only snapshotted roles may be volatile.
  - `snapshot` (optional, default `true`): `false` keeps a volatile file out
    of `docs/licenses/` while its observed facts stay as a retrieval record.
  - `access`: present only when a download was refused (e.g. `gated (HTTP 401)`).

| `source.type`    | Fields                          | Pinned `url`                                         | `revision` |
|------------------|---------------------------------|------------------------------------------------------|------------|
| `huggingface`    | `repo`, `path`                  | `https://huggingface.co/<repo>/resolve/<sha>/<path>` | the repo commit `sha` from `GET /api/models/<repo>` |
| `github`         | `repo`, `path`, optional `ref`  | `https://raw.githubusercontent.com/<repo>/<sha>/<path>` | the latest commit touching `path` (`GET /repos/<repo>/commits?path=…&per_page=1`), or `ref` if given |
| `url`            | `url`                           | the URL itself (mutable: see above)                  | `etag:<ETag>`, or `last-modified:<Last-Modified>` when the host sends no ETag |
| `npm`            | `package`, `version`            | the registry `dist.tarball`                          | the registry `dist.integrity` (`sha512-…`) |
| `pypi`           | `package`, `version`, `filename`| the PyPI file URL                                    | `sha256:<PyPI digest>` |
| `archive-member` | `archive`, `member`             | `<archive url>#<member>`                             | the archive's revision |
| `html-text`      | `document`, `classes`           | the HTML page's URL                                  | the page's revision |

Derived types (`archive-member`, `html-text`) are processed after the file they
are read from, which must already be verified. `html-text`
(`oracle_lib/htmltext.py`) renders the elements whose `class` contains one of
`classes` as plain text: headings as `#` lines, one line per paragraph or list
item, blank lines between blocks. It is deterministic and ignores page chrome
outside those elements, so the extracted text has a stable hash even when the
raw HTML does not.

All JSON written by the provenance scripts is deterministic: sorted keys,
two-space indent, UTF-8 without a BOM, LF line endings and a trailing newline.
Re-running a script on unchanged inputs leaves files byte-identical.

## Golden fixtures

Reference oracles turn a fixed corpus into one JSON fixture per tokenizer under
`fixtures/<tokenizer-id>.json`. The web app's tokenizers are tested against
these files.

`gen_fixtures.py` exits with status 1 in three cases: a builder raises; an
invariant fails (the fixture is then not written); or `--check` finds a stale
or orphaned fixture. A full run, with no `--family`/`--tokenizer` filter and no
failures, deletes `fixtures/*.json` files that no builder produces, for example
after a tokenizer is renamed or split. `--check` reports such files as
`ORPHAN` and fails.

**Corpus** (`corpus.json`): generated by `make_corpus.py`, never edited by hand,
374 cases in total.

- 70 hand-picked `core` cases: CJK and rare ideographs, emoji (ZWJ, flags,
  skin tone, a leading space), normalisation traps, whitespace and controls,
  special-token look-alikes, digits, the empty string, and every string the
  research report quotes ids for. They also include:
  - Pre-tokenizer port discriminators (`discriminator` tag). `ws-bom-mid` and
    `nel-before-letter` change chunks if a port uses the JavaScript `\s` set
    instead of Unicode White_Space. `fs-before-letter` changes them if U+001C
    to U+001F count as whitespace. The contraction cases change them if the
    `(?i:)` contraction folding is dropped, or the U+017F long s closure is
    missing. `contraction-upper`, `contraction-long-s` and
    `contraction-dont-upper` catch this for o200k-style patterns.
    `contraction-upper-run` and `contraction-long-s-run` catch it for
    cl100k, Llama 3 and Grok-2. `nel-after-space` and `fs-control` keep the
    plain forms the design names.
  - One special-token string per shipped tokenizer, taken from its own table:
    `special-llama3-bot` (`<|begin_of_text|>`), `special-llama4-eot`
    (`<|eot|>`), `special-grok2-eos` (`<|eos|>`), `special-grok1-bos`
    (`[BOS]`), `special-gemma2-end-of-turn` (`<end_of_turn>`) and
    `special-claude-eot` (`<EOT>`).
- 4 original `paragraph` cases: Traditional Chinese, Japanese, English, and
  JSON + Python.
- 300 `fuzz` strings drawn with `random.Random(20261025)` from a mixed
  alphabet, 1 to 40 code points each.

**Alphabet** (`alphabet.json`): `make_corpus.py --export-alphabet` writes it
next to the corpus, and `make_corpus.py --check` verifies both files. It holds
the fuzz generator's weighted pools (`fuzz.pools`, with labels, ranges or
literal strings) and the distinct code points that each corpus part uses
(`codePoints.all`, `.core`, `.paragraph` and `.fuzz`, as inclusive
`[first, last]` ranges). The web app's fuzz tests draw from it.

**Family modules** live in `oracles/<name>_family.py` and expose
`TOKENIZERS: dict[str, Callable[[list[dict]], dict]]`, mapping a tokenizer id
to a builder that takes the corpus cases and returns a fixture. A module may
also export `NORMALIZE: dict[str, Callable[[str], str]]`, which gives the text
that the token bytes cover (NFC for ctok). `gen_fixtures.py` finds the modules
through its `FAMILIES` registry and by auto-discovery. Shared helpers are in
`oracles/common.py`.

| Fixture | Family | Oracle | Cross-check |
|---|---|---|---|
| `openai-o200k_base` | tiktoken-bpe | tiktoken 0.14.0 | `bpe_reference.py` |
| `openai-cl100k_base` | tiktoken-bpe | tiktoken | `bpe_reference.py` |
| `meta-llama4-muse` | tiktoken-bpe | tiktoken on the Llama 4 ranks | HF tokenizers on Muse Glimmer `tokenizer.json` |
| `meta-llama3` | tiktoken-bpe | tiktoken on the Llama 3 ranks | HF tokenizers on Xenova `tokenizer.json` |
| `xai-grok2` | tiktoken-bpe | tiktoken on `tokenizer.tok.json` | `bpe_reference.py` |
| `anthropic-claude-legacy` | tiktoken-bpe | tiktoken on `claude.json` | `bpe_reference.py` |
| `google-gemma4` | sentencepiece-bpe | HF tokenizers 0.23.3 | sentencepiece on the Gemma 3 `.spiece.model` |
| `google-gemma2` | sentencepiece-bpe | sentencepiece 0.2.2 | `spm_bpe_ref.py` |
| `xai-grok1` | sentencepiece-bpe | sentencepiece 0.2.2 | `spm_bpe_ref.py` |
| `anthropic-ctok-v3` | ctok-tiling | ctok 1.3.0, label `3.0` | `ctok_tiling_check.py` |
| `anthropic-ctok-v4.7` | ctok-tiling | ctok 1.3.0, label `4.7` | `ctok_tiling_check.py` |
| `anthropic-ctok-v4.8` | ctok-tiling | ctok 1.3.0, label `4.8` | `ctok_tiling_check.py` |

### Fixture schema

**Serialisation** (`common.fixture_dumps`): sorted keys, literal Unicode
(`ensure_ascii=False`), UTF-8 without a BOM, LF line endings and a trailing
newline. Objects are indented one space per level, exactly as
`json.dumps(indent=1)` writes them. Each array of scalars, or of arrays of
scalars, is written on one line: `"ids": [3735, 133072]`,
`"chunks": [[0, 12]]`, `"steps": [[0, 948], [5, 948]]`, and ctok `pieces`.
Arrays of objects (`cases`, `tokens`, `merges`) keep one element per line, so
diffs stay per token. Parsing a fixture and re-dumping it with `indent=1` gives
the classic layout.

**Top level** (every fixture):

- `tokenizer`, `lab`, `family`, `vocabAsset` (a manifest asset id) and
  `vocabSha256` (verified against the manifest).
- `oracle {library, version}`.
- `crossCheck {library, version, agreedCases, disagreedCases}`.
- `policy {specialTokens, addBos, notes}`.
- `generatedOn`, fixed at `2026-10-25` so regeneration is byte-identical.
- `cases`.

`policy.specialTokens` takes one of two values:

- `as-text`: special-token strings in the input are encoded as ordinary text.
  Where matching them would change the ids, that result is stored as
  `idsWithSpecials`.
- `user-defined-atomic` (`google-gemma2`): SentencePiece never matches CONTROL
  pieces but always matches USER_DEFINED pieces. This model's USER_DEFINED
  pieces include special-token strings such as `<start_of_turn>`, so those
  appear as single ids in `ids`.

The generator asserts the value for the `.model` fixtures: `user-defined-atomic`
needs at least one case whose `ids` hold a special-token-like USER_DEFINED
piece, and `as-text` needs none.

`policy.addBos` is `false` everywhere. `policy.notes` documents the exact
encode call, the special-token handling and the alignment rule for that
fixture.

**Each case:**

- `name`, `text`, `utf8Len` and `ids`.
- `tokens[]`, where each token has:
  - `id`.
  - `bytes`: lowercase hex.
  - `start`/`end`: UTF-8 byte offsets.
  - `partial`: the bytes are not complete UTF-8 on their own.
  - `zeroWidth`.
  - `piece`: SentencePiece and ctok only.
  - `type`: SentencePiece only. This is the proto piece type: `NORMAL`,
    `USER_DEFINED`, `BYTE`, `CONTROL`, `UNK` or `UNUSED`. Gemma 4 has no
    `.model`, so its types come from the Gemma 3 proto, as `policy.notes`
    explains.
- `idsWithSpecials`: present only where matching special-token strings changes
  the ids. For the tiktoken family and `google-gemma4` it comes from the
  oracle's own specials mode. The sentencepiece library has no such mode, so
  for `google-gemma2` and `xai-grok1` it is an **emulation** (see the
  sentencepiece-bpe family below), as `policy.notes` states.

**tiktoken family extras:**

- `chunks`: pre-tokenizer regex matches as byte spans.
- `merges`: one `{chunk, directHit, steps}` per chunk. Each step is
  `[position, rank]`. Start from one part per byte, and merge part `position`
  with part `position + 1` of the current list. `rank` is the merged token's
  rank, which equals its id. `directHit` means the whole chunk is a vocabulary
  entry, so tiktoken emits it without merging and `steps` is empty.
- `normalizedNFKC` (`anthropic-claude-legacy` only): a second case list. It
  repeats the cases whose NFKC form differs, with `text` set to the NFKC form,
  and is checked like `cases`.

`google-gemma4` adds `crossCheck.vocabAsset` and `crossCheck.vocabSha256`, which
identify the cross-check's own model. It also adds `crossCheck.disagreements[]`
with `{name, ids, crossCheckIds, explanation}`.

**ctok file layout.** Each ctok family has its own fixture:
`anthropic-ctok-v3.json`, `anthropic-ctok-v4.7.json` and
`anthropic-ctok-v4.8.json`. The old combined `anthropic-ctok.json` is gone.
Each file is a regular fixture with a populated `cases` list and `family`
`ctok-tiling`.

The family metadata sits at the top level:

- `version`: the ctok label used.
- `ctokFamily`.
- `aliases`: labels that give identical output, e.g. `5` and `5.5` for v4.8.
- `models` and `sourceModel`.
- `frame {count, piece, position, endsInBow}`.
- `dataFile {path, bytes, sha256}`: the bundled pieces file.
- `vocabSha256`: equal to `dataFile.sha256`. `vocabSha256Of` says so.
- `wheelSha256`: the pinned ctok wheel, checked against `uv.lock`.
- `vocabSize`, `vocabGroups` and `byteFallbackPieces`.
- `normalization {allcapsMin, foldQuotes}`.
- `knownGaps`.
- `versionRouting {defaultVersions, observed, rule}`.
- `caveat` and `description`.
- `crossCheck.scope`.

Each ctok case adds:

- `pieces`: the verbatim `ctok.tokenize()` output, with the frame `⟨pad⟩`
  pieces first.
- `frameCount`, `contentCount` and `totalCount`.
- `nfcText`: present when NFC changes the text.
- `absorbed[] {start, end, reason, token}`: source bytes that no piece spells,
  where `reason` is `bow-space`, `stripped` or `frame-newlines`.

ctok has no ids, so every token `id` is `null` and `ids` is a list of `null`.
When no faithful alignment exists (e.g. v4.8 `newline-pair`, whose bytes are
all absorbed by the frame), `tokens` and `ids` are `null` and
`spansNullReason` says why. Token spans cover UTF-8(NFC(`text`)).

### Invariants

`common.check_fixture` runs on every fixture before it is written:

- The token bytes concatenate to the UTF-8 of the text, or of `NORMALIZE(text)`.
- `ids` equals the token ids.
- The spans are contiguous from 0 to `utf8Len`.
- The `partial` and `zeroWidth` flags match the bytes, and a non-partial token
  never cuts a character.
- Chunks tile the text.
- Merge steps replay to exactly the chunk's tokens.
- Each rank maps to one byte string across the whole fixture.
- A case may have `tokens: null` only with a `spansNullReason` and
  `ids: null`. Only `utf8Len` is checked for it.

### tiktoken-bpe family (`oracles/tiktoken_family.py`)

- **Oracle:** tiktoken 0.14.0. `ids` come from `encode_ordinary`. Token bytes
  come from `decode_single_token_bytes`, never from decoded strings.
- **Cross-check:** `oracles/bpe_reference.py` is a pure-Python port of
  tiktoken's `_byte_pair_merge`. It re-encodes every chunk, records the merge
  steps, and fails generation if it disagrees with tiktoken. Some fixtures
  also have the HF tokenizers cross-check listed below.
- **Special tokens:** `as-text`. `idsWithSpecials = encode(text,
  allowed_special="all")`, present only where it differs (e.g.
  `special-endoftext` for o200k_base and cl100k_base).
- **Dummy prefix:** none. Byte-level BPE never prepends anything, so no token is
  zero-width.
- Research-report ids are asserted as anchors.

| Fixture | Ranks | `pat_str` | Cross-check |
|---|---|---|---|
| `openai-o200k_base` | `tiktoken.get_encoding("o200k_base")` | tiktoken | reference BPE; o200k_harmony identical on 10 cases |
| `openai-cl100k_base` | `tiktoken.get_encoding("cl100k_base")` | tiktoken (possessive) | reference BPE; pre-0.8.0 pattern gives identical ids |
| `meta-llama4-muse` | Llama 4 `tokenizer.model` (bytes identical to Muse Glimmer) | o200k (identical to Glimmer `Split`) | HF tokenizers on Glimmer `tokenizer.json` |
| `meta-llama3` | Llama 3 `tokenizer.model` | llama3 `tokenizer.py` (pre-0.8.0 cl100k) | HF tokenizers on Xenova `tokenizer.json` |
| `xai-grok2` | `tokenizer.tok.json` `regular_tokens` | SGLang `V1` | reference BPE; xAI docs example |
| `anthropic-claude-legacy` | `claude.json` `bpe_ranks` (`! 5 ...` format) | from the file | reference BPE; no NFKC (variant under `normalizedNFKC`) |

`get_encoding` runs offline: before the first call, the generator fills a
temporary tiktoken cache from `data/vocab/raw`. tiktoken re-checks the
SHA-256 of every cached file.

### sentencepiece-bpe family (`oracles/sentencepiece_family.py`)

| Fixture | Oracle | Cross-check | `specialTokens` | Dummy prefix | BYTE ids |
|---|---|---|---|---|---|
| `google-gemma4` | HF tokenizers on Gemma 4 `tokenizer.json`, `encode(text, add_special_tokens=False)` with `encode_special_tokens=True` | sentencepiece on the Gemma 3 `.spiece.model` (same 262,144 slots). It must agree except on literal special-token strings, and each difference is explained in `crossCheck.disagreements`. | `as-text`; `idsWithSpecials` uses `encode_special_tokens=False` | none | 238–493 |
| `google-gemma2` | sentencepiece on the Gemma 1/2 `tokenizer.model` (256,000 pieces; Gemini 1.0/1.5), `encode(text, add_bos=False, add_eos=False)` | `spm_bpe_ref.py`; must reproduce every case | `user-defined-atomic` | none | 217–472 |
| `xai-grok1` | sentencepiece on Grok-1 `tokenizer.model`, `encode(text, add_bos=False, add_eos=False)` | `spm_bpe_ref.py`; must reproduce every case | `as-text` | zero-width dummy `▁` | 69–324 |

- **Cross-check engine:** `oracles/spm_bpe_ref.py` re-implements SentencePiece
  BPE in pure Python and shares no code with the library. It handles the
  identity normaliser, whitespace escaping, the dummy prefix, longest-match
  USER_DEFINED pieces, score-ordered merges and byte fallback.
- **Byte spans** (research section 5.2): the UTF-8 input is walked with a
  cursor while pieces are consumed in order.
  - A BYTE piece covers exactly one byte, whose value is `id - first BYTE id`.
    The range is derived from the model's piece types and never hard-coded.
    For Gemma 1/2 it is also asserted to equal the research value 217.
  - Any other piece covers its UTF-8 text, except that each `▁` matches
    whichever of `0x20` (an escaped space) or `E2 96 81` (a literal U+2581)
    is actually at the cursor.
  - The walk asserts that every byte is consumed exactly once.
- **Dummy-prefix rule:** only Grok-1 has `add_dummy_prefix=true`. Its first
  `▁` belongs to the first piece and covers zero bytes, unconditionally. A
  bare `▁` becomes a `zeroWidth` token at `0..0`. A fused piece such as
  `▁Hello` consumes only its other characters. Never strip a leading space
  conditionally, because `'   leading'` still gets its own dummy. The Gemma
  models have no dummy prefix, so a leading space is an ordinary `▁` piece.
- **Special-token policy:** SentencePiece has no switch.
  - It never matches CONTROL or UNK pieces in text, so a literal `<bos>` is
    ordinary text.
  - It always matches USER_DEFINED pieces as single tokens.
  - Grok-1 is `as-text` because no corpus text contains one of its
    special-token-like USER_DEFINED pieces (`<|separator|>`, `<|mask|>`,
    `<|control1|>` ...).
  - Gemma 1/2 is `user-defined-atomic`: `<start_of_turn>` (106) and
    `<end_of_turn>` (107) are USER_DEFINED, along with newline runs, `▁` runs,
    tab runs, `<unusedN>` and HTML tags.
  - Gemma 4 has no special:false added tokens, so with
    `encode_special_tokens=True` nothing is matched ahead of BPE.
- **Emulated `idsWithSpecials` (Gemma 1/2, Grok-1):** the library cannot match
  specials, so `spm_bpe_ref.py`'s `encode(text, match_specials=True)` emulates
  "match" semantics:
  - The CONTROL and UNK piece strings (`<pad>`, `<eos>`, `<bos>`, `<unk>`;
    `[PAD]`, `[BOS]`, `[EOS]`, `[UNK]`) join the USER_DEFINED pieces in the
    longest-first prefix match, as frozen symbols that map straight to their
    own ids and never to byte fallback.
  - The dummy prefix is still prepended only once, at the start of the text.
    Grok-1's `x [BOS] y` therefore gives `▁x`, `▁`, `[BOS]`, `▁y`.
  - This is the web app's `specialTokens: 'match'`.
  - Every emulated result is checked three ways. It must differ from `ids`
    exactly when the text contains a CONTROL or UNK string. Its tokens must
    tile the input bytes, with each matched piece covering its own text. And
    it must equal a rebuild from the library itself: the text is split at
    the matched strings, each stretch of plain text is encoded by
    sentencepiece (the dummy prefix only on the first stretch), and the
    special ids go in between.
  - The value is stored only where it differs from `ids`, e.g. Gemma 1/2
    `special-bos`, where `[235322, 14084, 235313]` becomes `[2]`.
- **Gemma 1/2 tab caveat:** a single tab is BYTE id 226 (`<0x09>`) in the
  `.model`. The HF `tokenizer.json` for Gemma 1/2 keys id 226 as a literal tab
  instead. A JSON-based port must therefore take a BYTE token's value from its
  id, not from its piece string. The fixture reads the `.model` and is
  unaffected.
- **Research anchors asserted:**
  - Gemma 4: `台灣台南` → `[44953, 237838, 238162]`, plus `東京都渋谷区のラーメン屋`,
    `𰻝`, `Hello world, tokenizers!`, `12345`, `龘`, `鬱` and tab.
  - Gemma 1/2: `台灣台南` → `[40911, 139274]` (台灣 | 台南),
    `東京都渋谷区` → `[98973, 101041, 236149]`, and tab → BYTE 226.
  - Grok-1: `台灣台南`, `Hello, world! The quick brown fox.`, `Hello world!`
    and `東京都渋谷区のラーメン屋さん`.

### ctok-tiling family (`oracles/ctok_family.py`)

- **Oracle:** ctok 1.3.0 (sanderland/ctok, MIT), run as
  `ctok.tokenize(text, label)` with label `3.0`, `4.7` and `4.8` for the v3,
  v4.7 and v4.8 families. Each bundled pieces file is verified against the
  `anthropic-ctok` manifest asset, and the wheel hash against `uv.lock`.
  ctok is a **community reconstruction calibrated on Claude token counts**. It
  is not Anthropic's tokenizer, and its boundaries are one valid minimum-cost
  tiling, which every fixture's `caveat` states.
- **Cross-check:** `oracles/ctok_tiling_check.py` independently re-derives the
  tiling. The pieces must concatenate to `ctok.marked_stream`, every piece must
  be legal, the content count must equal an independent minimum-cost tiling,
  and the frame tail must have the predicted length. ctok's normalisation and
  marker model are taken as given.
- **Special tokens:** `as-text`. Look-alikes are plain text, and there are no
  ids to match.
- **Dummy-prefix rule:** there is no dummy prefix. Instead, every result starts
  with a message frame of `frame.count` `⟨pad⟩` pieces (7 for v3, 11 for v4.7,
  6 for v4.8), which `tokens` excludes. `frame.endsInBow` copies ctok's
  `frame_bow` metadata (`false` only for v4.8).
- **Spans:** `oracles/ctok_spans.py` aligns content pieces to UTF-8(NFC(text)).
  - A byte atom covers 1 byte and a marker atom covers zero bytes.
  - A text character covers the source character it spells, including case-,
    quote- and space-folded characters.
  - Bytes that no piece spells are listed in `absorbed`.
- **Research known answers asserted:** `台灣台南` totals 13 (v3), 17 (v4.7) and
  11 (v4.8) tokens, with the content pieces quoted in research sections 3.2
  and 5.3.

## Unicode tables (`export_unicode_tables.py`)

`unicode_tables.json` (committed, generated) holds the character classes the
web app's pre-tokenizer patterns need, as sorted inclusive `[first, last]`
code-point ranges: `classes` has `L`, `Lu`, `Ll`, `Lt`, `Lm`, `Lo`, `M`, `N`
and `White_Space`. `normalization` has `cccNonZero` and `nfkcQcNotYes` for
the NFKC segment source map. The web app converts the file to TypeScript; the
script writes nothing outside `tools/oracle/`.

- **Unicode version.** The classes are at **Unicode 16.0**, the version of
  the engines that produce the fixture ids. Both tiktoken 0.14.0 (Rust
  `regex`) and HF tokenizers 0.23.3 (Oniguruma) assign Garay (16.0) and leave
  CJK Extension J (17.0) unassigned. The pinned Python `regex` 2026.9.29 is
  newer: its metadata says Unicode 18.0.0. So the script reads the classes
  from tiktoken's own regex engine. tiktoken has no matcher API, so a BPE
  probe does it: the text is `U+0000 X` for every code point X, and a merge
  rank exists for `00` plus each possible first byte. The first token of each
  pair is a merge exactly when the class matches X.
- **Cross-checks** (any failure stops the export):
  - Oniguruma must give identical sets.
  - The Python `regex` module must agree everywhere except the code points it
    assigns later (`regexModule.assignedLater`, 17,810 today) and the
    general-category changes it makes (`regexModule.categoryChanges`: U+0295
    moved from `Ll` to `Lo`).
  - `regex`'s `\s` must equal `\p{White_Space}`.
- **Fixture chunks.** The fixtures' `chunks` come from Python `regex`, so they
  match these tables only because no corpus text contains a code point from
  `regexModule.assignedLater` or U+0295. Keep it that way, or regenerate the
  chunks with a Unicode 16.0 engine.
- **Normalisation tables.** These come from Python `unicodedata` (Unicode
  15.1), united with the same properties from `regex`. NFKC_Quick_Check is
  derived: No when NFKC changes the code point on its own, Maybe for the
  trailing half of a canonical composition pair and for Hangul V/T jamo. The
  derivation is asserted equal to `regex` on every code point that 15.1
  assigns. The union is deliberate: a larger "never cut before" set only makes
  segments longer, which is always safe, so the tables stay correct for
  browsers on any Unicode version from 15.1 to 18.0.

## Fuzz oracle (`fuzz_oracle.py`)

The web app's `pnpm test:fuzz` (`packages/core/test/fuzz/`, design PA-9)
generates seeded strings in Node, sends them here and compares the answers
with its own engines. The script builds each shipped tokenizer's encoder with
the fixture builders' helpers from `oracles/`, with the same policy as the
fixtures: special-token strings are text, no BOS/EOS, no NFKC. For every
string it returns the ids and the per-token UTF-8 byte spans (tiktoken
`decode_single_token_bytes`, or the section 5.2 cursor walk
`align_tokens` for SentencePiece). It also returns the ids of an independent
cross-check where the fixture lane has one: HF tokenizers on the Xenova JSON
(Llama 3), `oracles.bpe_reference` over `regex` chunks (Grok-2, Claude legacy),
sentencepiece on the Gemma 3 model (Gemma 4, with `crossNote` explaining a
Gemma 3 USER_DEFINED literal) and `oracles.spm_bpe_ref` (Gemma 1/2, Grok-1).
A text the oracle cannot encode returns `{"error": ...}` instead of stopping
the batch.

- `--input req.json --output res.json`: one batch. The request is
  `{"<tokenizer-id>": ["text", ...]}`. The answer is
  `{"results": {...}, "oracles": {...}}`.
- `--serve`: JSON lines on stdin/stdout, so the tokenizers load once. Node
  keeps one process for the whole run, including the minimal-repro
  shrinking.
- Output is ASCII JSON, so the Windows console code page does not matter.

It writes nothing. Failures are saved by the Node side to
`fixtures/candidates/<tokenizer>-<seed>.json`, in the fixture case shape plus
a `classification` field, for review in this lane.

## Layout

```text
tools/oracle/
  pyproject.toml, uv.lock, .python-version   (pyproject also holds the ruff config)
  manifest.json            provenance manifest (committed)
  pin_manifest.py          resolve sources to pinned URLs and revisions
  fetch_vocab.py           download, verify and snapshot licences
  render_license_docs.py   generate docs/licenses/README.md and authored NOTICE files
  oracle_lib/              small standard-library helpers (paths, jsonio, fsio, netio,
                           manifest, resolvers, archives, htmltext, report)
  make_corpus.py, corpus.json, alphabet.json  golden-fixture corpus and its alphabet (generator and output, committed)
  export_unicode_tables.py, unicode_tables.json  Unicode 16.0 class tables + NFKC tables (committed)
  gen_fixtures.py          build/check fixtures/ from the oracle families
  fuzz_oracle.py           batch oracle for `pnpm test:fuzz` (ids + byte spans + cross-check per string; --serve)
  oracles/
    common.py              corpus loading, UTF-8 helpers, fixture writer and invariant checks
    tiktoken_family.py     tiktoken-bpe builders;  bpe_reference.py (pure-Python BPE merge)
    sentencepiece_family.py  sentencepiece-bpe builders;  spm_bpe_ref.py (pure-Python SentencePiece BPE)
    ctok_family.py         ctok-tiling builders;  ctok_spans.py (byte alignment), ctok_tiling_check.py
data/vocab/raw/<asset-id>/ raw downloads (gitignored)
docs/licenses/<asset-id>/  licence, notice and policy snapshots (committed); docs/licenses/README.md is generated
fixtures/<tokenizer-id>.json golden fixtures (committed, 12 files)
```
