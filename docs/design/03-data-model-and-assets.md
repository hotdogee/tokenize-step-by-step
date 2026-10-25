# 03 — Core data model, registry and vocabulary assets (areas B and C)

*The TypeScript in §B.1–B.7, §B.8 and §C.1–C.4 is the FROZEN v1 contract between work packages. WP00 commits it verbatim as `packages/core/src/model/result.ts`, `packages/core/src/format/types.ts`, `packages/registry/src/schema.ts`; later changes require an ADR plus a PR that updates every dependent listed in `07-implementation-plan.md`.*

## B. Core data model

### B.0 Design rules

1. **Bytes are the spine.** Every tier (code points, graphemes, chunks, tokens, merge parts) is a half-open span `[start, end)` into `utf8 = UTF-8(text)`. UTF-16 offsets exist only to talk to the `<textarea>`.
2. **Struct of arrays in typed arrays.** The result is transferable (zero-copy across the Worker boundary), O(1)-indexable by the layout engine and the scrubber, and ≈ 1.8 MB for 10,000 CJK characters including the timeline (≈ 180 B per CJK code point: `chars` 7 × 4 B, `tokens` ≈ 13 B, `byteTo*` 12 B per input byte, timeline 8 B per byte + 25 B per step with `stepRank` as `Float32Array`). A result is allocated per keystroke, which is why the long-input tiers (AD-27) and the trace policy exist; at the 200,000-code-point cap with `trace: false` a result is ≤ 25 MB. `TokenizationView` wraps it on the main thread; no per-token objects cross the boundary.
3. **Replayable merge timeline** (AD-9): scrubbing to step `k` is O(bytes) with no engine.
4. **Normalization is explicit.** Only `anthropic-claude-legacy` has an opt-in NFKC mode; `text !== input.text` is a first-class state with a per-code-point source map.
5. **Zero-width and partial tokens are first-class** (flags and kinds), never patched over (research §5.1).
6. **The engine throws rather than misaligns**: `AlignmentError`, `PretokenizeError` (04 §5).

### B.1 Identifiers, options, flags

```ts
// packages/core/src/model/result.ts  — FROZEN v1
export type TokenizerId =
  | 'openai-o200k_base' | 'openai-cl100k_base'
  | 'anthropic-claude-legacy'
  | 'google-gemma4' | 'google-gemma2'
  | 'meta-llama4-muse' | 'meta-llama3'
  | 'xai-grok2' | 'xai-grok1';
export type Family = 'bytelevel-bpe' | 'spm-bpe';

export interface EncodeOptions {
  /** 'as-text' = tiktoken encode_ordinary / HF encode_special_tokens=true (default). 'match' = special strings become their ids. */
  readonly specialTokens: 'as-text' | 'match';
  /** Prepend BOS as a zero-width Special token at offset 0 (only tokenizers whose registry entry declares a BOS id). Default false. */
  readonly addBos: boolean;
  /** 'NFKC' only for anthropic-claude-legacy (archived SDK behaviour). Default 'none'. */
  readonly normalize: 'none' | 'NFKC';
  /** Record the merge timeline. false for count-only paths; { maxSteps } caps memory (timeline.truncated = true; semantics in MergeTimeline). Default true.
   *  UI policy (AD-27): ≤ 20,000 code points → true; 20,001–100,000 → { maxSteps: 50_000 }; above → false. */
  readonly trace: boolean | { readonly maxSteps: number };
}
export const DEFAULT_OPTIONS: EncodeOptions = { specialTokens: 'as-text', addBos: false, normalize: 'none', trace: true };

/** Bit flags in TokenTable.flags (Uint8). */
export const TokenFlag = {
  Partial: 1,        // bytes are non-empty and not a complete valid UTF-8 sequence (fixture `partial`)
  ZeroWidth: 2,      // byteStart[i] === byteStart[i+1] (BOS, Grok-1 dummy ▁)
  Special: 4,        // produced by specialTokens:'match' or addBos
  StartsMidChar: 8,  // first byte is not the first byte of its code point
  EndsMidChar: 16,   // last byte is not the last byte of its code point
  ByteFallback: 32,  // SentencePiece BYTE piece
  UserDefined: 64,   // SentencePiece USER_DEFINED pre-match (frozen symbol)
  DirectHit: 128,    // byte-level: the whole chunk was a vocabulary entry (no merges)
} as const;

export const TokenKind = { Normal: 0, Byte: 1, UserDefined: 2, Control: 3, Unk: 4, Special: 5, Bos: 6, DummyPrefix: 7 } as const;
export const ChunkKind = { Regex: 0, SpecialString: 1, SpmText: 2 } as const;
export const StepKind = { Merge: 0, ByteFallbackSplit: 1 } as const;
```

### B.2 Tables

```ts
/** One row per Unicode code point of `text`. */
export interface CharTable {
  readonly count: number;
  readonly cp: Uint32Array;          // code point (lone surrogates arrive as U+FFFD: TextEncoder semantics; inspector says "unpaired surrogate")
  readonly utf16Start: Uint32Array;  // count+1 sentinel; index into `text`
  readonly byteStart: Uint32Array;   // count+1 sentinel; byteLen(i) = byteStart[i+1] - byteStart[i] ∈ 1..4
  readonly grapheme: Uint32Array;    // grapheme-cluster index
  readonly chunk: Int32Array;        // chunk index; never -1 (a matched special string is a chunk of kind SpecialString)
  readonly tokenFirst: Int32Array;   // first NON-zero-width token overlapping this char
  readonly tokenLast: Int32Array;    // last NON-zero-width token overlapping (inclusive); tokenLast > tokenFirst ⇔ the char is split.
                                     // Zero-width tokens (BOS, dummy prefix) are excluded here; reach them via tokensAtByte(b) / TokenTable.charFirst
  readonly sourceRunStart: Int32Array | null; // normalization source map (B.4): index of the first input code point of the run that produced
  readonly sourceRunEnd: Int32Array | null;   // this output code point, and one past the last (many-to-one and one-to-many are both representable);
                                              // null when not normalized
}

/** Grapheme clusters; charStart/byteStart have count+1 sentinels. source = 'fallback' when Intl.Segmenter is unavailable:
 *  then every code point is its own cluster (count = chars.count) and the UI hides the brackets. count is never -1. */
export interface GraphemeTable { readonly count: number; readonly source: 'segmenter' | 'fallback'; readonly charStart: Uint32Array; readonly byteStart: Uint32Array; }

export interface ChunkTable {
  readonly count: number;
  readonly byteStart: Uint32Array;   // count+1
  readonly charStart: Uint32Array;   // count+1 (spm: one chunk [0, count))
  readonly tokenStart: Uint32Array;  // count+1
  readonly kind: Uint8Array;         // ChunkKind (SpecialString chunks cover matched special strings, so chunks always tile utf8)
  readonly directHit: Uint8Array;    // bytelevel: 1 iff the whole chunk's bytes are one vocabulary entry (tiktoken emits it without running BPE;
                                     // every 1-byte chunk is a direct hit; a multi-byte chunk with no merges and no vocab hit, e.g. the 2-byte NEL
                                     // chunk in `nel`, has directHit 0 and zero steps)
  readonly rule: Uint8Array;         // bytelevel: index of the regex alternative that matched in context (04 §2.1; 255 = n/a); recorded when trace is on
}

export interface TokenTable {
  readonly count: number;
  readonly id: Uint32Array;
  readonly byteStart: Uint32Array;   // count+1 sentinel; zero-width ⇔ byteStart[i] === byteStart[i+1]
  readonly flags: Uint8Array;        // TokenFlag bits
  readonly kind: Uint8Array;         // TokenKind
  readonly chunk: Int32Array;        // owning chunk; -1 ONLY for zero-width tokens (BOS, bare dummy prefix); a matched special has its SpecialString chunk
  readonly charFirst: Int32Array;    // first char overlapped; zero-width: the char starting at that boundary (or chars.count at end)
  readonly charLast: Int32Array;     // inclusive (zero-width: charLast = charFirst - 1, i.e. an empty range)
  readonly stepFormed: Int32Array;   // timeline step that produced this token; -1 if none (single symbol, direct hit, special, BOS, dummy).
                                     // Byte tokens produced by a ByteFallbackSplit carry the split step. After trace.maxSteps: -1 for tokens formed later
}

/**
 * Merge timeline (AD-9). A boundary b (0 < b < byteCount) is the gap before byte b.
 * At step k (0..stepCount) the live boundaries are those with  born !== NEVER && born <= k && (died === ALIVE || died > k);
 * the live parts are the maximal runs between live boundaries, restricted to byte-level chunks or the spm text.
 * Sentinels: NEVER = 0x7fffffff (born: the boundary never exists), ALIVE = -1 (died: survives to the final tokens).
 * Permanent boundaries (born 0, died ALIVE): 0 and byteCount, every chunk edge, and every boundary bordering or inside a
 * SpecialString chunk. Exception: when `leadingZeroWidthPart` is true, born[0]/died[0] describe the virtual boundary between the
 * zero-width leading part (Grok-1 dummy ▁) and byte 0.
 * Byte-level: boundaries inside a non-direct-hit chunk are born 0; boundaries inside a direct-hit chunk are born NEVER.
 * spm (SentencePiece order): code-point boundaries born 0; byte-fallback splits (StepKind.ByteFallbackSplit) give birth to
 * intra-code-point boundaries at that step. spm (HF order): fallback happens before merging, so those boundaries are born 0.
 * Truncation (options.trace = { maxSteps }): steps after maxSteps are not recorded (stepCount = maxSteps, truncated = true) but
 * the boundary arrays still describe the FINAL tokens: a boundary removed by an unrecorded merge has died = stepCount, a boundary
 * born by an unrecorded split has born = stepCount, so replay(timeline, stepCount) === the final token boundaries always holds.
 */
export interface MergeTimeline {
  readonly stepCount: number;
  readonly leadingZeroWidthPart: boolean;
  readonly boundaryBorn: Int32Array;   // byteCount+1; NEVER = 0x7fffffff
  readonly boundaryDied: Int32Array;   // byteCount+1; ALIVE = -1
  readonly stepKind: Uint8Array;       // StepKind
  readonly stepLeft: Uint32Array;      // byte offset where the left part starts
  readonly stepMid: Uint32Array;       // Merge: byte offset where the right part starts (= boundary removed); Split: == stepLeft
  readonly stepEnd: Uint32Array;       // byte offset where the merged part ends (Split: end of the shattered part)
  readonly stepRank: Float32Array;     // bytelevel: the merged TOKEN ID (= PCES index + idOffset; equals the fixture's `rank`, e.g. Grok-2 1128, Claude ranks 5…);
                                       // spm score-priority: -score (integers, exact in float32); spm merge-rank: HF merge rank (< 2^24, exact)
  readonly stepResultId: Int32Array;   // id of the piece/token formed (Split: first byte id); -1 n/a. bytelevel: === stepRank
  readonly stepChunk: Uint32Array;     // owning chunk (steps are grouped by chunk in execution order; spm: 0)
  readonly truncated: boolean;         // trace.maxSteps reached (see the doc comment for the boundary semantics)
}
export const NEVER = 0x7fffffff, ALIVE = -1;

export interface TokenizationResult {
  readonly tokenizer: TokenizerId;
  readonly family: Family;
  readonly options: EncodeOptions;
  readonly input: { readonly text: string; readonly codePoints: number; readonly utf16Units: number };
  readonly text: string;                     // what was encoded (=== input.text unless normalize changed it)
  readonly normalization: { readonly form: 'NFKC'; readonly changed: boolean } | null;
  readonly utf8: Uint8Array;                 // UTF-8 of text
  readonly chars: CharTable;
  readonly graphemes: GraphemeTable;         // source = 'fallback' (one cluster per code point) when Intl.Segmenter is unavailable; UI hides brackets
  readonly chunks: ChunkTable;
  readonly tokens: TokenTable;
  readonly timeline: MergeTimeline | null;   // null when options.trace === false
  readonly byteToChar: Uint32Array;          // utf8.length entries
  readonly byteToToken: Int32Array;          // utf8.length entries (every byte is covered by exactly one non-zero-width token)
  readonly byteToChunk: Int32Array;          // never -1 (matched special strings are SpecialString chunks)
  readonly stats: Readonly<{ codePoints: number; utf16Units: number; bytes: number; graphemes: number; chunks: number; tokens: number;
    partialTokens: number; splitChars: number; zeroWidthTokens: number; specialTokens: number; mergeSteps: number }>;
  readonly timings: Readonly<{ analyzeMs: number; encodeMs: number }>;
  readonly seq: number;                      // request sequence stamped by the client (stale results dropped)
}
```

Transfer list = `utf8.buffer` and every typed array's buffer (allocated per result, never shared with vocab tables). The main-thread `TokenizationView` (core/model/view.ts) exposes `charAt(i): CharInfo`, `tokenAt(i): TokenInfo`, `tokensAtByte(b)`, `charsOfToken(t)`, `partsAt(k): PartsAt` (live boundaries after `k` steps; cached cursor so ±1 is O(1) amortised) and `stepSentence(k): StepSentence`. Their shapes are FROZEN in `packages/core/src/model/view-types.ts` (committed verbatim by WP00; consumed by WP08/WP09, held by WP06's `AppState`):

```ts
// packages/core/src/model/view-types.ts — FROZEN v1
export interface CharInfo { index: number; cp: number; hex: string /* "U+7063" */; byteStart: number; byteEnd: number; utf16Start: number; utf16End: number;
  grapheme: number; chunk: number; tokenFirst: number; tokenLast: number; split: boolean; standIn: string | null /* ␠ ⇥ ⏎ … key, 05 §4 */;
  combining: boolean; lang: ResolvedTextLang; sourceRun: readonly [number, number] | null; }
export interface TokenInfo { index: number; id: number; byteStart: number; byteEnd: number; bytes: Uint8Array; hex: string[]; dec: number[];
  text: string | null /* decoded only if complete UTF-8: TextDecoder('utf-8', { fatal: true, ignoreBOM: true }) */; piece: string | null;
  kind: number; flags: number; flagsAsWords: string[]; completes: 'full' | 'starts' | 'ends' | 'inside' | 'crosses'; missingBytes: number;
  charFirst: number; charLast: number; chunk: number; stepFormed: number; zeroWidth: boolean; partial: boolean; }
export interface PartsAt { step: number; partStart: Uint32Array /* count+1 */; partChunk: Int32Array; partId: Int32Array /* -1 if not a vocab entry */;
  justMerged: number /* part index formed at this step or -1 */; }
export interface StepSentence { step: number; stepCount: number; kind: 'merge' | 'split'; leftHex: string[]; rightHex: string[]; resultId: number;
  rank: number; chunk: number; charsText: string /* "灣" */; partOf: 'whole' | 'part' | 'crosses'; }
export interface Fragment { spanId: number; row: number; colStart: number /* 0-based column in the row */; colSpan: number; first: boolean; last: boolean;
  byteStart: number; byteEnd: number; }
export interface RowModel { index: number; byteStart: number; byteEnd: number; columns: number /* ≤ K, incl. marker columns */;
  chars: Fragment[]; markers: Array<{ col: number; token: number }>; bytes: Array<{ col: number; byte: number }>;
  graphemes: Fragment[]; chunks: Fragment[]; tokens: Fragment[]; parts: Fragment[] /* at the current step */; }
/** What the text-language chip offers (05 §10) … */
export type TextLangChoice = 'auto' | 'zh-Hant' | 'ja' | 'en';
/** … and what is written to `lang` attributes (auto-detection may yield 'ko' / 'und'). zh-Hant resolves to zh-Hant-TW so the UI root (zh-TW) and glyph cells share one font stack. */
export type ResolvedTextLang = 'zh-Hant-TW' | 'ja' | 'en' | 'ko' | 'und';
```

### B.3 Normative semantics: partial, split, zero-width, dummy prefix

- `Partial` ⇔ token bytes are non-empty and are not a complete valid UTF-8 sequence (fixture `partial`). Inside valid text this ⇔ `StartsMidChar || EndsMidChar`; the engine computes the flags from char boundaries and tests assert equivalence with the byte-level definition.
- A **char is split** ⇔ `tokenLast > tokenFirst`. A token **crosses** a char boundary while partial when `(StartsMidChar || EndsMidChar) && charLast > charFirst` (Grok-2 token 4242 = ー + 2 bytes of メ; Claude 20094, research §5.3).
- `ZeroWidth` ⇔ `byteStart[i] === byteStart[i+1]`: BOS (`TokenKind.Bos`), Grok-1 dummy prefix when the first piece is the bare `▁` (`TokenKind.DummyPrefix`, id 130089, `[0,0)`). Zero-width tokens attach to the char index at that boundary through `TokenTable.charFirst` and are returned by `tokensAtByte(b)`, but they are **excluded** from `chars.tokenFirst/tokenLast` and from `stats.splitChars` (Grok-1 `zh-tw-tainan`: `splitChars` must be 1 — 灣 — not 2; the same holds for every tokenizer under `addBos`).
- A matched special string (`specialTokens: 'match'`) is a chunk of kind `SpecialString` containing exactly one token; chunks therefore tile `utf8` in every mode and `byteToChunk` is never -1.
- When the first spm piece **fuses** the dummy prefix (`▁Hello`), the token is not zero-width; its `▁` covers 0 bytes and the inspector says "includes the dummy prefix (0 bytes)".
- A literal U+2581 in the input is matched by a `▁` in a piece as 3 bytes (`E2 96 81`); a replaced space as 1 byte; the dummy as 0. Spans come from the symbol byte map by construction (04 §3.2), not from a post-hoc walk; the total must be consumed exactly or `AlignmentError` is thrown.
- Invariants (asserted in debug builds, the conformance suite and property tests): `concat(tokenBytes) === utf8`; spans contiguous and non-overlapping; chunks tile `utf8`; `Partial` iff invalid UTF-8; `replay(timeline, stepCount)` boundaries == token boundaries (per chunk); `chars.byteStart` strictly increasing; `byteToToken`/`byteToChar`/`byteToChunk` consistent with the tables.

### B.4 Normalization (legacy Claude NFKC)

`normalize: 'NFKC'` → `text = input.text.normalize('NFKC')`. NFKC is **not** per code point (`halfwidth-katakana-dakuten`: ﾀ + ﾞ → ダ, 2 → 1; ㍻ → 平成, 1 → 2), so the source map is built per **normalization-stable segment**: the input is cut before every code point with `ccc = 0` and `NFKC_Quick_Check = Yes` (both from `tables.generated.ts`, exported with the Unicode tables, AD-4); each segment is normalized on its own (`segment.normalize('NFKC')` equals the corresponding slice of the whole-string result by the stability property) and its output code points all receive `sourceRunStart = first input index of the segment`, `sourceRunEnd = one past its last input index`. Deleted segments (output empty) leave no rows; inserted code points are impossible under NFKC. Assertion: `concat(segments.normalize())` equals `text` for every fixture `normalizedNFKC` case (150 in `anthropic-claude-legacy.json`) and in the property test. The board is laid out over `text`; a "normalized text" row above the char tier shows the input with changed runs underlined (05 §4.1), using the run map. The browser's `String.prototype.normalize` uses the browser's Unicode tables while the fixtures were produced with Python `unicodedata` (Unicode 15.1) — listed as a known divergence in 04 §8 and on About. All other tokenizers: identity. SentencePiece whitespace escaping (`' '` → `▁`) is modelled inside the engine (piece shows `▁`, bytes show `0x20`), never as a change of `text`.

### B.5 Fixture mapping (used by `@tsbs/conformance` and `fromFixtureCase`)

| Fixture field | Model |
|---|---|
| `ids` | `Array.from(tokens.id)` with default options |
| `idsWithSpecials` | ids with `specialTokens: 'match'`. **Absence ⇒ both modes equal** is asserted only for fixtures whose oracle has a specials mode (`policy.specialTokens === 'as-text'` with tiktoken-family `allowed_special='all'` or HF `encode_special_tokens`: o200k, cl100k, llama3, llama4-muse, grok2, claude-legacy, gemma4). For `user-defined-atomic` fixtures (gemma2, grok1 — sentencepiece has no specials switch) the assertion is instead: `'match'` equals `'as-text'` on every case whose text contains no CONTROL/UNK piece string (`<bos>`, `[BOS]`, …), and on cases that do, `'match'` equals the oracle-lane emulation `idsWithSpecials` once WP00 emits it (04 §7) |
| `tokens[].{id, bytes, start, end, partial, zeroWidth}` | `tokens.id[i]`, `utf8.subarray(byteStart[i], byteStart[i+1])` (zero-width: `engine.tokenBytes(id)`), flags |
| `tokens[].piece`, `tokens[].type` (spm) | `engine.pieceString(id)`; `type` → `TokenKind` (`BYTE`→Byte, `USER_DEFINED`→UserDefined, `CONTROL`→Control/Special, `NORMAL`→Normal, `UNK`→Unk) for `.model`-oracle fixtures (gemma2, grok1). **google-gemma4 exception (AD-31):** the fixture's `type` comes from the Gemma 3 proto (`tools/oracle/README.md`; 347 tokens over 8 ids — `\n` 107, `\n\n` 108, `▁` runs 138–144, `\t` 255968, `\t\t` 255969 — are typed `USER_DEFINED` there), whereas HF semantics (the oracle that produced the ids) has no USER_DEFINED pieces. For gemma4, conformance compares `type` only on the axis BYTE / CONTROL / UNK / other, and both the engine (TYPS from the JSON) and `fromFixtureCase` map fixture `USER_DEFINED` → `TokenKind.Normal` (plain chip, no lock glyph). Negative test: `tab-only`, `newline-pair`, `three-spaces` on gemma4 are `Normal` in both the precomputed and the live result |
| `utf8Len` | `utf8.length` |
| `chunks` (tiktoken family) | `chunks.byteStart` pairs for `ChunkKind.Regex` |
| `merges[].{chunk, directHit, steps:[position, rank]}` | `chunks.directHit`; harness replays the fixture positions on one-part-per-byte and compares `(left, mid, rank)` with `stepLeft/stepMid/stepRank` in order; conversely `position = aliveBoundariesLeftOf(stepLeft, chunk, k)` (Fenwick tree, `timeline/fixture-steps.ts`, tests only) |
| `normalizedNFKC[]` | encoded with `normalize: 'NFKC'`; `text` equals the fixture's NFKC form |
| `policy.addBos === false` | `addBos` tests add `[bosId]` at `[0,0)` with `ZeroWidth \| Special` |

### B.6 Engine contract (implemented by both engines; `04-engines.md`)

```ts
export interface TokenizerInfo {
  readonly id: TokenizerId; readonly family: Family; readonly vocabSize: number; readonly rankCount: number;
  readonly specials: ReadonlyArray<{ readonly id: number; readonly text: string }>;
  readonly bosId: number | null; readonly unicodeVersion: '16.0.0'; readonly sourceSha256: string;
  readonly supports: { readonly nfkc: boolean; readonly bos: boolean; readonly specialsToggle: boolean };
}
export interface Tokenizer {
  readonly info: TokenizerInfo;
  encode(text: string, options?: Partial<EncodeOptions>): TokenizationResult;
  /** Yields between chunks AND inside the agenda loop (every ~4 ms of merge work, 04 §1.3) so the Worker can observe `cancel` even when the
   *  whole text is one chunk (CJK). `budgetMs` defaults to 4. */
  encodeIncremental(text: string, options?: Partial<EncodeOptions>, budgetMs?: number): Generator<{ bytesDone: number; bytesTotal: number }, TokenizationResult>;
  tokenBytes(id: number): Uint8Array | null;
  pieceString(id: number): string | null;      // spm piece with ▁; bytelevel: null
  idOf(bytes: Uint8Array): number | null;      // inspector: "is this byte string a token?"
  pretokenize(text: string): ReadonlyArray<readonly [number, number]>;  // byte spans (engine A: chunks; engine B: symbols)
  dispose(): void;
}
```

### B.7 Registry data files (`packages/registry/data/`)

```ts
// packages/registry/src/schema.ts — FROZEN v1 (zod schemas derive these types; JSON is imported as-is at runtime)
export type Locale = 'en' | 'zh-TW' | 'ja';
export type L10n = Readonly<Record<Locale, string>>;
export type Fidelity = 'confirmed' | 'inferred' | 'legacy' | 'reconstruction';
export type Lab = 'openai' | 'anthropic' | 'google' | 'meta' | 'xai';
export type NoticeKey = 'powered-by-xai' | 'xai-materials-notice' | 'built-with-meta-llama-3' | 'llama3-notice' | 'gemma-terms'
  | 'gemma-notice' | 'claude-legacy-disclaimer' | 'tiktoken-rank-file-basis' | 'modified-asset';
export type { TextLangChoice, ResolvedTextLang } from '@tsbs/core';   // defined once in core/model/view-types.ts (B.2); registry depends on core for types only

export interface TokenizerEntry {
  id: TokenizerId; lab: Lab; family: Family; tier: 'primary' | 'secondary'; default?: true;   // exactly one default: openai-o200k_base
  displayName: L10n;                                   // "o200k_base (GPT-4o → GPT-5.x)"
  vocabSize: number; rankCount: number;                // 200019 / 199998
  asset: { manifestId: string; sourceFile: string; sourceSha256: string };   // oracle manifest asset id + file; resolved to a path via vocab-manifest
  engine: ByteLevelConfig | SpmConfig;
  defaults: Partial<EncodeOptions>;
  toggles: ReadonlyArray<'specialTokens' | 'addBos' | 'normalize'>;   // which toggles the UI shows
  fidelity: Fidelity; fidelityNote: L10n;              // badge + sentence for the tokenizer itself (e.g. "Claude 1/2-era vocabulary — not the Claude 3+ tokenizer")
  licence: string;                                     // key into licences.json / licences.generated.json
  requiredNotices: NoticeKey[];                        // rendered persistently while selected (05 §15)
  fixture: string;                                     // "fixtures/openai-o200k_base.json"
  byok?: 'anthropic-count' | 'xai-tokenize';
  withdrawn?: true;                                    // hides from the picker; converter skips the asset (xAI revocability)
}
export interface ByteLevelConfig {
  kind: 'bytelevel-bpe';
  pattern: 'o200k' | 'cl100k' | 'llama3' | 'grok2-v1' | 'claude-legacy';   // key into core/engines/bytelevel/patterns.ts
  idOffset: number;                                    // rank r ↦ id r + idOffset (0 OpenAI/Meta, 128 Grok-2, 5 Claude)
  maxTokenBytes: number;                               // informational (picker/About); the ENGINE reads META.maxPieceBytes from the asset (04 §2.1) and registry:check asserts equality
  bosId: number | null;                                // Llama 3 128000, Llama 4/Muse 200000; null for OpenAI/Grok-2/Claude
}
export interface SpmConfig {
  kind: 'spm-bpe';
  priority: 'score' | 'merge-rank';                    // Grok-1, Gemma 2: score (.model); Gemma 4: merge-rank (HF merges)
  fallbackOrder: 'after-merge' | 'before-merge';       // SentencePiece: after; HF: before
  addDummyPrefix: boolean;                             // Grok-1 true; Gemma false
  escapeWhitespace: true;
  byteFirstId: number;                                 // 238 Gemma 4, 217 Gemma 2, 69 Grok-1 (also in META; must agree)
  unkId: number; bosId: number; eosId: number; padId: number;
  userDefinedPolicy: 'atomic';                         // USER_DEFINED always frozen (fixture policy user-defined-atomic)
  controlPolicy: 'as-text-unless-match';               // CONTROL/special strings are text unless specialTokens:'match'
}
export interface ModelRow {
  model: string; lab: Lab;
  tokenizer: TokenizerId | null;                       // null = no public tokenizer (Claude 3 → 5.5 / Fable / Mythos); such rows MUST carry `byok`
  byok?: 'anthropic-count' | 'xai-tokenize';           // the live-check panel the row points to
  fidelity: Fidelity | 'unavailable';                  // 'unavailable' iff tokenizer === null
  status: 'current' | 'previous' | 'historical';
  evidenceUrl: string; checkedOn: string;              // ISO date; registry:check fails if an inferred row lacks either
  note: L10n;
}
export interface ExampleChip {
  key: string;
  fixtureCase: string;                                 // a case name present in EVERY shipping fixture
  text: string;                                        // MUST equal the fixture case's text byte-for-byte (registry:check: chip.text === case.text)
  label?: L10n;                                        // display label when the text is long (paragraph chips); default = text
  lang: TextLangChoice;                                // what the chip sets the text-language chip to ('auto' for mixed-script cases)
  why: L10n;
}
export interface ByokConfig {
  checkedOn: string;
  anthropic: { endpoint: 'https://api.anthropic.com/v1/messages/count_tokens'; version: string;   // "2026-10-21"
    authSchemes: ReadonlyArray<'bearer' | 'x-api-key'>; defaultAuth: 'bearer'; browserAccessHeader: 'anthropic-dangerous-direct-browser-access';
    workspaceHeader: 'anthropic-workspace-id'; models: ReadonlyArray<{ id: string; label: string; frameTokens: number; generation: 'v3' | 'v4.7' | 'v4.8' | 'v5.5' }>; };
  xai: { endpoint: 'https://api.x.ai/v1/tokenize-text'; defaultModel: string; models: ReadonlyArray<{ id: string; label: string }>; };
}
```

Initial `models.json` rows (from research §2–3; every `inferred` row has `evidenceUrl` + `checkedOn: 2026-10-25`): OpenAI GPT-4o/4.1/4.5/5.x/o-series → o200k `confirmed` (tiktoken `model.py`), GPT-6 Astra / GPT-6.1 Sol → o200k `inferred` (tiktoken #608/#616), GPT-4 / GPT-3.5 → cl100k `confirmed` `previous`; Anthropic Claude 1/2 → claude-legacy `legacy`, Claude 3 → 5.5 / Fable / Mythos → `{ tokenizer: null, byok: 'anthropic-count', fidelity: 'unavailable' }` rows (rendered in the picker as "Claude 3+ → live check" and in the About fidelity table as "no public tokenizer"); Google Gemini 2.0–3.5 → gemma4 `confirmed` (google-genai LocalTokenizer), Gemini 3.6/3.8/4 Argon → gemma4 `inferred`, Gemini 1.0/1.5 → gemma2 `confirmed` `previous` (Vertex SDK); Meta Llama 4 / Muse Glimmer / Muse Spark Open → llama4-muse `confirmed`, Muse Wonder → `inferred`, Llama 3.x → llama3 `confirmed` `previous`; xAI Grok 2 / 2.5 → grok2 `confirmed` (docs example reproduced), Grok 3 / 4.x → grok2 `inferred` ("verify with your key" link), Grok-1 → grok1 `legacy` `historical`.

`licences.json` (hand-written display strings, 3 locales; verbatim legal strings are **not** translated): exact xAI notice "This product includes materials licensed under the xAI Community License. All rights reserved. Copyright © xAI 2026." (year = owner-confirmed, 07 §6), "Powered by xAI", "Built with Meta Llama 3" + the Llama 3 Notice sentence, the Gemma Notice sentence "Gemma is provided under and subject to the Gemma Terms of Use found at ai.google.dev/gemma/terms" + Prohibited Use Policy link, the Anthropic disclaimer, the tiktoken rank-file basis disclosure, and the MODIFIED template "Converted to the TSBV1 container from <file> (sha256 <…>) by @tsbs/vocab-tools <version> on <date>; vocabulary contents unchanged." `licences.generated.json` is produced by `vocab-tools` from `tools/oracle/manifest.json` + `docs/licenses/**` (asset id, SPDX, obligations verbatim, snapshot sha256, source URL/revision, `shipIntent`). `registry:check` fails if: a shipped tokenizer lacks a `confirmed|legacy` row; an `inferred` row lacks `evidenceUrl`/`checkedOn`; a row with `tokenizer: null` lacks `byok` or has a fidelity other than `unavailable` (and vice versa); a `requiredNotices` key is missing from any locale; a tokenizer's `asset.sourceSha256` differs from the manifest; a manifest asset with `shipIntent: ship` has no tokenizer entry or vice versa; an `ExampleChip.fixtureCase` is missing from any shipping fixture or `chip.text !== case.text`; `ByteLevelConfig.maxTokenBytes !== META.maxPieceBytes` of the built asset (when `data/vocab/dist` exists). Negative tests exercise each rule.

### B.8 Vocab manifest (generated by `vocab:build`, bundled into the Worker chunk — AD-11)

```ts
// packages/core/src/format/types.ts — FROZEN v1
export interface VocabManifest {
  readonly schema: 1;
  readonly builtOn: string;                                   // ISO date
  readonly generator: string;                                 // "@tsbs/vocab-tools@x.y.z"
  readonly assets: Readonly<Record<string /* TokenizerId */, VocabAssetEntry>>;
}
export interface VocabAssetEntry {
  readonly path: string;            // ROOT-RELATIVE: "/tok/openai-o200k_base/3f9a1c0b7e2d.bin" (sha256(compressed)[0:12]). Inside the Worker a relative
                                    // path would resolve against /assets/worker-<hash>.js, so the loader always does new URL(entry.path, self.location.origin)
  readonly format: 'tsbv1'; readonly family: Family;
  readonly encoding: 'gzip';        // v1.1 may add 'br' siblings: { br?: { path, bytesCompressed, sha256 } }
  readonly bytesCompressed: number; // progress denominator and Cache quota
  readonly bytesRaw: number;        // decompressed container size
  readonly sha256: string;          // of the compressed file (checked when the gzip layer arrives, C.6)
  readonly sha256Raw: string;       // of the decompressed TSBV1 container (checked when a transparently-decoded body arrives, C.6)
  readonly upstream: { readonly assetId: string; readonly file: string; readonly sha256: string; readonly url: string; readonly revision: string; readonly retrievedOn: string };
  readonly counts: { readonly pieces: number; readonly specials: number; readonly merges?: number };
}
```

---

## C. Vocabulary asset pipeline

### C.1 Container format `TSBV1` (byte layout)

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

### C.2 Decoded in-memory structures (`@tsbs/core/format`)

```ts
export interface ByteVocab {                 // AD-8: both families; zero allocation on lookup
  readonly count: number;
  readonly offsets: Uint32Array;             // count+1, into `bytes`; recomputed at load by scanning PCES varints (5–12 ms)
  readonly bytes: Uint8Array;                // OWN COPY of the PCES payload (readTsbv1 copies it so the whole decompressed container — incl. the 1 MB MRGS payload — is released after the CSR is built)
  /** index (= rank / piece id) of buf[start,end) or -1. FNV-1a 32-bit over the slice, linear probing in a table of 2^ceil(log2(2·count)) Int32 slots, byte compare on probe. */
  indexOf(buf: Uint8Array, start: number, end: number): number;
  bytesOf(index: number): Uint8Array;        // subarray view
  pieceOf(index: number): string | null;     // TextDecoder({ fatal: true, ignoreBOM: true }); null if not valid UTF-8; memoised per index
}
export interface Tsbv1 {
  readonly meta: TsbvMeta; readonly family: Family;
  readonly vocab: ByteVocab;                 // over PCES
  readonly types: Uint8Array | null;         // TYPS
  readonly scores: Int32Array | Float32Array | null;   // PRIO (decoded) or SCRF
  readonly merges: { readonly start: Uint32Array /* count+1, CSR by result piece */; readonly splitByteOffset: Uint8Array; readonly rank: Uint32Array } | null;
  readonly specials: ReadonlyArray<{ id: number; bytes: Uint8Array; text: string }>;   // SPCL, source order
}
export function readTsbv1(buf: ArrayBuffer): Tsbv1;   // throws FormatError { section, offset, reason }
```

Resident memory (o200k): 1.56 MB PCES copy + 0.8 MB offsets + 2 MB hash table ≈ **4.4–5.2 MB** (measured 5.2 MB) vs +25 MiB for `Map<latin1,rank>`. Gemma 4: 2.5 MB PCES copy + 1.05 MB offsets + 2 MB table + CSR (1.05 MB start + 0.5 MB offsets + 2.1 MB ranks) ≈ **9.5 MB** once the 3.8 MB container is released. Build time (Node desktop, measured): o200k offsets+table 7.8 ms; Gemma 4 ≈ 13 ms + CSR 10 ms. Phone budgets (×4 margin, CI-asserted ceilings in 06 §3, which is the single source for all performance numbers): ≤ 100 ms / ≤ 160 ms.

### C.3 Estimated sizes per tokenizer (measured today on the pinned raw files unless marked est.; KB = 1024 B; gzip = zlib-9; br = brotli-11 reference)

| Tokenizer | Upstream file → size | TSBV1 raw | **gzip (wire)** | br-11 (ref) | Edge-like zstd-3 | Load (Node, ByteVocab) |
|---|---|---|---|---|---|---|
| openai-o200k_base | `o200k_base.tiktoken` 3,529 KB | 1,560 KB | **1,025 KB** | 809 KB | 1,030 KB | 8 ms |
| openai-cl100k_base | `cl100k_base.tiktoken` 1,642 KB | 727 KB | **443 KB** | 372 KB | 446 KB | 5 ms |
| meta-llama4-muse | Glimmer `tokenizer.json` 27,470 KB (> 25 MiB cap) | 1,575 KB (+ ~40 KB SPCL) | **≈ 1,045 KB** | ≈ 820 KB | 1,038 KB | 8 ms |
| meta-llama3 | `tokenizer.model` 2,133 KB | 937 KB (+ 5 KB SPCL) | **≈ 572 KB** | 481 KB | 579 KB | 6 ms |
| xai-grok2 | `tokenizer.tok.json` 7,544 KB | 936 KB (+ 3 KB SPCL) | **≈ 601 KB** | 498 KB | 606 KB | 6 ms |
| anthropic-claude-legacy | `claude.json` 680 KB | 464 KB | **277 KB** | 233 KB | 279 KB | 4 ms |
| google-gemma4 | `tokenizer.json` 31,416 KB (> 25 MiB cap) | 3,782 KB (PCES 2,518 + TYPS 256 + MRGS 1,007) | **≈ 1,620 KB** | ≈ 1,270 KB | 1,650 KB | 13 + 10 ms |
| google-gemma2 (est. from Gemma 3 ratio) | `tokenizer.model` 4,142 KB | ≈ 3,030 KB | **≈ 1,410 KB** | ≈ 1,090 KB | ≈ 1,400 KB | ≈ 13 ms |
| xai-grok1 | `tokenizer.model` 2,177 KB | 1,407 KB (PCES 1,151 + TYPS 128 + PRIO ≈ 128) | **615 KB** | 514 KB | 618 KB | 7 ms |
| **All nine** | | ≈ 14.4 MiB | **≈ 7.6 MiB** | ≈ 6.1 MiB | | |

Largest single file ≈ 3.8 MiB raw / 1.6 MiB on the wire — 15 % of the 25 MiB cap (research §6.2). First visit = app (≤ 123 KB transfer excluding the vocabulary, 06 §3) + o200k 1,025 KB. gzip-9 is within 2–3 % of what the edge would produce (zstd-3 / br-4 columns), so edge compression would save nothing (AD-10).

### C.4 Transport: pre-gzipped opaque `.bin` + `DecompressionStream('gzip')`

Content-type rules from research §6.4 applied: wrangler sets `Content-Type` from the extension and omits it for unknown ones, so `_headers` sets `Content-Type: application/octet-stream` and `X-Content-Type-Options: nosniff` for `/tok/*`; `application/octet-stream` is on the non-compressible list, so no double encoding, no chunked transfer, `Content-Length` present (exact progress; the "no Content-Length on compressed responses" problem does not arise). Query strings are ignored by asset lookup (§6.4), so content hashes live in file names. `Cache-Control: public, max-age=31536000, immutable`, `Cross-Origin-Resource-Policy: same-origin`.

Compatibility: `DecompressionStream('gzip')` — Chrome 80, Firefox 113, Safari 16.4 (= floor). `'brotli'` is Firefox 147 / Safari 18.4 only and absent in Chrome → `.br` siblings are v1.1 behind `try { new DecompressionStream('brotli') }` with the manifest `encoding` field; no protocol change.

### C.5 Converter CLI (`@tsbs/vocab-tools`)

```text
tsbs-vocab build    --manifest tools/oracle/manifest.json --raw data/vocab/raw --out data/vocab/dist [--only <assetId>] [--conformance strict|skip-missing-engine|off]
                    # strict (default once both engines have merged): refuse to write an asset that fails its fixture
                    # skip-missing-engine (CI default until WP05A+WP05B merge, AD-32): run conformance only for families whose engine factory @tsbs/core exports; print a WARNING per skipped asset
                    # off: local development only; never in CI
tsbs-vocab verify   --out data/vocab/dist                 # decode every .bin, check sha256, round-trip vs raw
tsbs-vocab inspect  <file.bin>                            # META, counts, first/last entries, sha256
tsbs-vocab guard    --dist apps/web/dist                  # C.8
tsbs-vocab licences --out packages/registry/data/licences.generated.json
tsbs-vocab examples --fixtures fixtures --chips packages/registry/data/examples.json --out <dir>   # precomputed example results (via core/fixture)
```

Per-source parsers (each ≤ 200 lines, unit-tested on a 20-entry synthetic input and the real file's known counts):

| Parser | Input | Output | Assertions |
|---|---|---|---|
| `tiktokenText` | `base64 rank` lines (o200k, cl100k, Llama 3 `tokenizer.model`) | PCES in rank order; SPCL from `openai_public.py` tables (o200k 2, cl100k 5) / `llama-models/models/llama3/tokenizer.py` (256; **3.1+ names ship**: `<\|finetune_right_pad_id\|>` 128004, `<\|eom_id\|>` 128008, `<\|python_tag\|>` 128010 — the fixture's cross-check used the Xenova 3.0 `added_tokens`, whose ids agree and whose three older names are listed in the Llama 3 `fidelityNote`) committed in `sources/specials/*.json` with their upstream URL | ranks contiguous 0..N−1; all 256 single bytes present; byte strings unique; `maxPieceBytes` recorded |
| `claudeJson` | `claude.json` `bpe_ranks` (`! 5 <b64> …`) | PCES (idOffset 5); SPCL ids 0–4; `pat_str` compared with the `claude-legacy` template | 64,995 ranks; `explicit_n_vocab` inconsistency ignored (documented) |
| `grok2Json` | `tokenizer.tok.json` | PCES from `regular_tokens[].bytes` ordered by id (idOffset 128); SPCL from `special_tokens` | `reserved_tokens === 128`; single-byte tokens satisfy id = 128 + byte; `word_split === "V1"` |
| `hfByteLevel` | Muse Glimmer `tokenizer.json` | PCES via inverse GPT-2 `bytes_to_unicode` (one char = one byte); SPCL from `added_tokens` (2,048) | `model.vocab` ids contiguous; `ignore_merges === true`; `Split` regex byte-equal to the o200k template source; cross-check ranks against `meta-llama4-model/tokenizer.model` when present locally (oracle-only, never shipped) |
| `spmProto` | SentencePiece `.model` (Grok-1, Gemma 2) | PCES, TYPS, PRIO/SCRF; META from `trainer_spec`/`normalizer_spec`; SPCL from CONTROL pieces | minimal proto2 reader (varint + length-delimited): `pieces[1]{piece 1, score 2, type 3}`, `trainer_spec[2]{model_type 3 == 2, byte_fallback 35, unk_id 40, bos_id 41, eos_id 42, pad_id 43}`, `normalizer_spec[3]{name 1 == "identity", precompiled_charsmap 2 (empty), add_dummy_prefix 3, remove_extra_whitespaces 4 (false), escape_whitespaces 5}`; **proto2 defaults for absent fields** (`escape_whitespaces` default true — Grok-1 omits field 5); BYTE pieces are 256 contiguous `<0xNN>` ids with the byte value taken from the id (Gemma 1/2 tab quirk: id 226 is a literal tab in HF JSON, research §5.2); **`UNUSED` count asserted 0** (resegmentation unsupported, 04 §3.2); `normalScoresMonotone`, `maxPieceBytes` recorded |
| `hfSpmJson` | Gemma 4 `tokenizer.json` | PCES (id order), TYPS (derived: BYTE/CONTROL/UNK/NORMAL, never USER_DEFINED), MRGS, SPCL (24), META `{priority:'merge-rank', fallbackOrder:'before-merge', unkId, bosId, eosId}` from `tokenizer_config.json` | `normalizer` is exactly `Replace(" " → "▁")`; `pre_tokenizer` is the no-op `Split(" ", MergedWithPrevious)`; `model.ignore_merges === false`; `byte_fallback === true`; every merge's halves and result exist in the vocab; **max piece length ≤ 255 UTF-16 units** (MRGS `u8` offset); `added_tokens[special=false]` count recorded (0); A2 regeneration check (`hfMergesRegenerable`) |

Pipeline per asset: verify raw SHA-256 against the manifest → refuse `shipIntent !== 'ship'` or `withdrawn` → parse → validate → encode TSBV1 → **run `@tsbs/conformance` against `fixtures/<tokenizerId>.json` with the in-memory tables** (per the `--conformance` mode above; AD-32) → gzip → write `.bin` + manifest entry (`sha256` and `sha256Raw`) → write `licences.generated.json` and `MODIFIED-<assetId>.txt`. Any failure aborts the whole build with a non-zero exit and no partial output.

### C.6 Loading sequence, Cache API, progress (runs inside the Worker; `packages/worker/loader.ts`)

```text
load(tokenizerId)
 1. entry = manifest.assets[id]                                    (bundled; AD-11)
    url   = new URL(entry.path, self.location.origin).href           (root-relative path → absolute; the SAME string is the Cache API key)
    index = new URL('/__tsbs-index', self.location.origin).href
 2. features: cacheApi = 'caches' in self (try/catch: private mode / quota → memory-only path);
              subtleCrypto = !!crypto.subtle (absent in insecure contexts, e.g. http://192.168.x.x device testing → verification is SKIPPED,
              features.subtleCrypto = false is shown on About › Diagnostics; phone testing goes through HTTPS: the wrangler preview URL or a tunnel)
 3. hit  = await cache.match(url)             (cache 'tsbs-tok-v1')
      hit  → phase 'cache' (progress jumps to 100 % of download) → bytes = await hit.arrayBuffer()   (verified when stored)
      miss → resp = await fetch(url, { cache: 'force-cache' }); resp.ok else error { code: 'fetch', retryable: status >= 500 }
             total = Content-Length ?? entry.bytesCompressed (a visible Content-Encoding only means "no Content-Length": the denominator falls back)
             tee the body: (a) counting TransformStream → phase 'download' {loaded,total}, progress events every ≥ 64 KB or ≥ 100 ms;
                           (b) buffered for cache.put after verification
 4. CONTENT SNIFFING (never the headers — if the edge ever adds its own compression on top of our gzip, the browser strips only that layer and the
    bytes we see are still OUR GZIP FILE; if some intermediary transparently gunzips, we see the raw container):
      bytes[0..2) === 1F 8B      → layer = 'gzip' : expectedSha = entry.sha256
      bytes[0..4) === "TSBV"     → layer = 'raw'  : expectedSha = entry.sha256Raw
      else                       → error { code: 'format', retryable: false }
 5. phase 'verify' (when subtleCrypto): sha256(bytes) === expectedSha   (~10 ms / 1.6 MB; cache hits skip)
      mismatch → cache.delete(url) → error { code: 'integrity', retryable: true } (one automatic refetch, then surface)
 6. layer = 'gzip' → phase 'decompress': new Response(stream.pipeThrough(new DecompressionStream('gzip'))).arrayBuffer(); progress vs entry.bytesRaw
    layer = 'raw'  → container = bytes
 7. phase 'build': readTsbv1 (copies PCES; container released) → ByteVocab (offsets + table) → engine factory (lazy import per family) → phase steps 'pieces' | 'merges'
 8. cache.put(url, new Response(bytes, { headers: { 'x-tsbs-layer': layer } })) when it came from the network and quota allows
      (navigator.storage.estimate(): need ≥ 2× asset free); the stored body is exactly what was verified
 9. index entry (JSON at `index` in the same cache) records { url, bytes, lastUsed }; keep ≤ 3 tokenizers or ≤ 12 MiB (LRU evict)
10. on startup: delete caches named 'tsbs-tok-*' with another version; delete entries whose url is not in the manifest
11. post 'loaded' { fromCache, ms, bytesTransferred, contentEncoding: resp.headers.get('content-encoding'), layer }   (perf log + About diagnostics)
```

Progress weights for the picker bar (from measured times): download 0–75 %, verify 75–78 %, decompress 78–84 %, build 84–100 %. `prefetch(id)` = steps 3–5 + 8 only (download + cache, no build), issued by the client on `requestIdleCallback` for the lab's secondary tokenizer when `navigator.connection` is **undefined** (Firefox, Safari) **or** `effectiveType === '4g'`, and never when `saveData` is true (AD-19). Prefetching the id that is currently loading is a no-op. A 404 (stale client after a deploy) → `error { code: 'fetch', retryable: false }` → UI "A new version is available — reload". The picker's "downloaded ✓" state is derived from a `cache.keys()` probe each time the picker opens, never from the index entry alone: iOS Safari evicts script-writable storage (Cache API included) after 7 days without interaction, and About › Diagnostics says so next to the cache listing so the behaviour is not mistaken for a bug.

### C.7 Precomputed example results (`examples` plugin)

`fromFixtureCase(fixture, caseName, tokenizerEntry)` (core/fixture, pure, runs on the **main thread**) converts a fixture case into a `TokenizationResult` (tables + timeline from `merges[].steps` for the tiktoken family; spm cases carry no steps, so `timeline` is null; the rail then shows stops 1–4 and 6 with stop 4 derived from the final tokens — each token is one symbol, kinds from `type` — and stop 5 disabled with the hint "merge replay available once the tokenizer is loaded"). What ships is **not** the expanded result but the compact fixture subset it is built from:

```ts
// wire format of generated/examples-default.json and dist/examples/<tokenizerId>.<sha8>.json (plain JSON; typed arrays are rebuilt by fromFixtureCase)
interface ExamplesWire { schema: 1; tokenizer: TokenizerId; cases: Record<string /* case name */, ExampleCaseWire>; }
interface ExampleCaseWire {
  text: string; ids: number[];
  tokenEnd: number[];                       // delta-coded byte ends (cumulative); zero-width tokens contribute 0
  flags?: Array<[number, number]>;          // sparse [index, TokenFlag bits] for tokens that are Partial/ZeroWidth/Byte/UserDefined/Special
  piece?: Array<string | 0>;                // spm only, 0 = "same as decoded bytes"
  type?: number[];                          // spm only, TokenKind per token (gemma4: USER_DEFINED already mapped to Normal, B.5)
  chunks?: number[];                        // bytelevel: delta-coded chunk ends
  merges?: Array<{ c: number; d: 0 | 1; s: number[] }>;   // bytelevel: per chunk, [position, rank] flattened; OMITTED for paragraph chips
}
```

Paragraph chips (`zh-tw-paragraph` 814 o200k steps, `ja-paragraph` 660, `en-paragraph`) omit `merges`: their timeline arrives with the live engine (the board shows stops 1–4 and 6 meanwhile, the same as spm precomputed cases). Budgets: `generated/examples-default.json` (default chip × default tokenizer, inlined) ≤ 4 KB gz; `dist/examples/<tokenizerId>.<sha8>.json` (all chips for that tokenizer) **≤ 16 KB gz** each — a ceiling to be measured by WP03 and recorded in 06 §3 (estimate: 16 small chips with merges ≈ 6 KB + 3 paragraphs' ids/ends ≈ 7 KB). Served from `/examples/*` as `application/json`, edge-compressed, immutable. The chips list (`examples.json`) references fixture case names and `registry:check` asserts `chip.text === case.text`, so a chip can never show a result the oracles did not produce.

### C.8 Guards (`tsbs-vocab guard`, also run by `pnpm check:dist`)

- Hard: any file in `dist/` > 20 MiB fails (platform limit 25 MiB = 26,214,400 B, §6.2); warn > 8 MiB; total files ≤ 2,000 (platform 20,000, server-side only); no dotfiles except `.assetsignore` (dotfiles are served, §6.4); every `/tok/*` file has a manifest entry and vice versa; `_headers` ≤ 100 rules; `dist/index.html` ≤ 14 KB brotli.
- Bundle budgets via `size-limit` (06 §3).
- `wrangler deploy --dry-run` must pass.
