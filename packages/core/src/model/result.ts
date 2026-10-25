// FROZEN v1 — see docs/design/03-data-model-and-assets.md §B.1–B.2 (verbatim). A change needs an ADR in docs/adr/
// and one PR that updates every dependent (docs/design/07-implementation-plan.md §1). Excluded from Prettier on purpose.
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
