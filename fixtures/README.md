# Golden fixtures

These files are generated. Do not edit them by hand. The full schema, the
oracles and the invariants are documented in
[`tools/oracle/README.md` § Golden fixtures](../tools/oracle/README.md#golden-fixtures).
Regenerate the files with
`uv run --project tools/oracle python tools/oracle/gen_fixtures.py`, and check
them with `gen_fixtures.py --check`.

**Schema in one paragraph.** Each `<tokenizer-id>.json` is one tokenizer's
output on the same 374-case corpus (`tools/oracle/corpus.json`).

- The top level has `tokenizer`, `lab`, `family` (`tiktoken-bpe`,
  `sentencepiece-bpe` or `ctok-tiling`), `vocabAsset` and `vocabSha256`
  (pinned in `tools/oracle/manifest.json`), plus `oracle`, `crossCheck`,
  `policy {specialTokens, addBos, notes}`, `generatedOn` and `cases`.
- Each case has `name`, `text`, `utf8Len`, `ids` and `tokens[]`. Every token
  has `id`, `bytes` (hex), UTF-8 byte offsets `start` and `end`, `partial`
  and `zeroWidth`. SentencePiece and ctok tokens add `piece`, and
  SentencePiece tokens add `type`.
- A case has `idsWithSpecials` only where matching special-token strings
  changes the ids. For `google-gemma2` and `xai-grok1` this value is a
  documented emulation, because sentencepiece has no specials mode.
- tiktoken-family cases add `chunks` (pre-tokenizer byte spans) and `merges`
  (`{chunk, directHit, steps: [[position, rank], ...]}`).
- `anthropic-claude-legacy` adds a second case list, `normalizedNFKC`.
- ctok fixtures carry ctok-specific fields and `null` ids.
- Serialisation is deterministic: sorted keys, UTF-8, LF line endings, and
  scalar arrays on one line.

| File | Family | Oracle |
|---|---|---|
| `openai-o200k_base.json` | tiktoken-bpe | tiktoken 0.14.0 |
| `openai-cl100k_base.json` | tiktoken-bpe | tiktoken 0.14.0 |
| `meta-llama4-muse.json` | tiktoken-bpe | tiktoken on the Llama 4 ranks (Muse Glimmer specials) |
| `meta-llama3.json` | tiktoken-bpe | tiktoken on the Llama 3 ranks |
| `xai-grok2.json` | tiktoken-bpe | tiktoken on `tokenizer.tok.json` |
| `anthropic-claude-legacy.json` | tiktoken-bpe | tiktoken on `claude.json` |
| `google-gemma4.json` | sentencepiece-bpe | HF tokenizers 0.23.3 |
| `google-gemma2.json` | sentencepiece-bpe | sentencepiece 0.2.2 |
| `xai-grok1.json` | sentencepiece-bpe | sentencepiece 0.2.2 |
| `anthropic-ctok-v3.json` | ctok-tiling | ctok 1.3.0, label `3.0` (Phase 2) |
| `anthropic-ctok-v4.7.json` | ctok-tiling | ctok 1.3.0, label `4.7` (Phase 2) |
| `anthropic-ctok-v4.8.json` | ctok-tiling | ctok 1.3.0, label `4.8` (Phase 2) |
