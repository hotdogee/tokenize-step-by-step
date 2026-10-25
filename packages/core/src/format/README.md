<!-- FROZEN v1 — see docs/design/03-data-model-and-assets.md §C.1 (verbatim). A change needs an ADR in docs/adr/ and one PR that updates every dependent (docs/design/07-implementation-plan.md §1). Excluded from Prettier on purpose. -->

# Container format `TSBV1` (byte layout)

Little-endian. Varints are unsigned LEB128; "zigzag" = signed LEB128 (zigzag-encoded). Every section is length-prefixed so a reader can skip unknown tags; readers reject an unknown `version`.

```text
offset  size  field
0       4     magic "TSBV" (0x54 0x53 0x42 0x56)
4       1     version = 1
5       1     family: 0 = bytelevel-bpe, 1 = spm-bpe
6       2     sectionCount (u16)
8       …     sections, each:  u32 tag (FourCC, ASCII, e.g. "PCES") | u32 byteLength | payload | zero padding to a 4-byte boundary
```

| Tag | Families | Payload | Notes |
|---|---|---|---|
| `META` | both | UTF-8 JSON ≤ 4 KiB: `{ tokenizerId, family, upstream:{assetId,file,sha256,url,revision,retrievedOn}, counts, maxPieceBytes, unusedCount, idOffset?, byteFirstId?, bosId?, eosId?, unkId?, padId?, addDummyPrefix?, escapeWhitespace?, priority?, fallbackOrder?, normalScoresMonotone?, hfMergesRegenerable?, modificationNotice, unicodeVersion:"16.0.0", generator }` | Self-describing: a `.bin` carries its provenance, so tests and `tsbs-vocab inspect` need no registry. `maxPieceBytes` = measured longest PCES entry (o200k 128, Grok-2 256, Glimmer 113, Gemma 4 93) — the engines' merge-window bound (04 §2.1). `unusedCount` must be 0 (04 §3.2) |
| `PCES` | both | `varint count`, then `count ×` (`varint len`, `len` bytes) in **id order** (bytelevel: index = rank; id = index + idOffset) | bytelevel: raw token bytes (o200k max 128 B, Grok-2 256 B); spm: UTF-8 of the piece string with `▁` as U+2581 (`E2 96 81`). Contiguity of ranks and presence of all 256 single bytes asserted (bytelevel). The reader copies the payload into its own buffer so the container can be released (C.2) |
| `TYPS` | spm | `count × u8`: 0 NORMAL, 1 USER_DEFINED, 2 BYTE, 3 CONTROL, 4 UNK, 5 UNUSED | Gemma 4 derived from the HF JSON (the source of the ids): BYTE = the 256 contiguous `<0xNN>` ids (238–493), CONTROL = `added_tokens[special=true]`, UNK = `unk_token`, rest NORMAL — **no USER_DEFINED** (the fixture's USER_DEFINED labels are Gemma 3 proto provenance only, B.5 / AD-31). `.model` sources: the proto `type` verbatim; UNUSED count asserted 0 |
| `PRIO` | spm, `priority: score` | `count × zigzag-varint(delta of round(score))` | Scores are exact integers in Grok-1 and Gemma 1/2 (asserted); delta coding gzips to < 5 KiB |
| `SCRF` | spm, `priority: score` (alternative) | `count × float32` | Written instead of `PRIO` when any score is non-integral; reader compares as float32 |
| `MRGS` | spm, `priority: merge-rank` | `varint m`, then per merge in **rank order**: `zigzag-varint(Δ resultPieceId)`, `u8 splitUtf16Offset` | Gemma 4: 514,906 merges, 1,007 KB raw → 206 KB gzip (measured; byte-offset variant 253 KB). Writer asserts every result piece is ≤ 255 UTF-16 units (Gemma 4 max 93 bytes). Reader converts UTF-16 offsets to byte offsets by scanning each result piece once and builds a CSR by result piece (C.3) |
| `SPCL` | both | `varint count`, `count ×` (`varint id`, `varint len`, `len` UTF-8 bytes) in **source order** | AD-12. o200k 2, cl100k 5, Llama 3 256, Llama 4/Muse 2,048 (Glimmer names), Grok-2 128 (ids 0–127), Claude 5 (ids 0–4), Gemma 4 24 (CONTROL added tokens), Grok-1 / Gemma 2 CONTROL pieces |

The whole file is gzip-compressed (zopfli `--i15` when available, else zlib level 9; parameters fixed so output is deterministic) and written to `data/vocab/dist/tok/<tokenizerId>/<sha256(compressed)[0:12]>.bin`. `packages/core/src/format/README.md` documents the layout; the reader (~150 lines) has round-trip tests against the writer for every asset (write → read → deep-equal tables) and synthetic negative tests (bad magic, truncated section, unknown version).
