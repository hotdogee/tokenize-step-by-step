/**
 * `buildResult` — the struct-of-arrays builder both engines and the fixture bridge finish with (03 §B.2–B.3, 04 §2.1
 * steps 5–7, §3.2 step 8). The caller supplies what only it knows — the text analysis, chunk spans and kinds, token ids /
 * spans / kinds and the engine-side flag bits, and the timeline — and the builder derives everything else:
 *
 * - token flags `Partial` (UTF-8 validation of the bytes), `ZeroWidth`, `StartsMidChar`, `EndsMidChar` (char boundaries),
 *   plus the bits a kind implies (Byte → ByteFallback, UserDefined → UserDefined, Special/Bos → Special);
 * - `TokenTable.chunk` (−1 only for zero-width tokens), `charFirst/charLast`, `stepFormed` (the last recorded step whose
 *   `[left, end)` is the token's span; a ByteFallbackSplit step for the bytes it shattered);
 * - `chars.chunk/tokenFirst/tokenLast` over non-zero-width tokens only, so a zero-width token never makes a char "split"
 *   (03 §B.3; Grok-1 `zh-tw-tainan` has `splitChars === 1`);
 * - `chunks.charStart/tokenStart`, the three byte maps and `stats`.
 *
 * Malformed spans (tokens or chunks that do not tile the bytes, a token crossing a chunk edge) throw a RangeError: an engine
 * must throw rather than misalign (03 §B.0 rule 6).
 */
import type { TextAnalysis } from '../text/analyze.ts';
import { isValidUtf8 } from '../text/utf8.ts';
import { DERIVED_FLAGS, flagsForKind } from './flags.ts';
import {
  DEFAULT_OPTIONS,
  StepKind,
  TokenFlag,
  type EncodeOptions,
  type Family,
  type MergeTimeline,
  type TokenizationResult,
  type TokenizerId,
} from './result.ts';

export interface ChunkInput {
  /** count+1 byte offsets; chunks must tile the UTF-8 bytes. */
  readonly byteStart: ArrayLike<number>;
  /** `ChunkKind` per chunk. */
  readonly kind: ArrayLike<number>;
  /** Byte-level: 1 iff the whole chunk is one vocabulary entry. Default all 0. */
  readonly directHit?: ArrayLike<number>;
  /** Byte-level: index of the regex alternative that matched in context (255 = n/a). Default all 255. */
  readonly rule?: ArrayLike<number>;
}

export interface TokenInput {
  readonly id: ArrayLike<number>;
  /** count+1 byte offsets; contiguous from 0 to utf8.length (zero-width tokens repeat an offset). */
  readonly byteStart: ArrayLike<number>;
  /** `TokenKind` per token. */
  readonly kind: ArrayLike<number>;
  /** Engine-side `TokenFlag` bits (Special, ByteFallback, UserDefined, DirectHit); the derived bits are recomputed. */
  readonly flags?: ArrayLike<number>;
}

export interface ResultInput {
  readonly tokenizer: TokenizerId;
  readonly family: Family;
  /** Merged over `DEFAULT_OPTIONS`. */
  readonly options?: Partial<EncodeOptions>;
  /** The text before normalization (default: `analysis.text`). */
  readonly inputText?: string;
  /** `analyzeText` of the encoded text. */
  readonly analysis: TextAnalysis;
  /** NFKC source map of the encoded text (03 §B.4), or null/absent when not normalized. */
  readonly normalization?: {
    readonly changed: boolean;
    readonly sourceRunStart: Int32Array;
    readonly sourceRunEnd: Int32Array;
  } | null;
  readonly chunks: ChunkInput;
  readonly tokens: TokenInput;
  readonly timeline: MergeTimeline | null;
  /** `stats.mergeSteps` when it differs from `timeline.stepCount` (truncated or untraced runs). */
  readonly mergeSteps?: number;
  readonly timings?: Readonly<{ analyzeMs: number; encodeMs: number }>;
  readonly seq?: number;
}

function countCodePoints(text: string): number {
  let n = 0;
  for (const _ of text) n++;
  return n;
}

/** Per-span `stepFormed` lookup: the last recorded step whose span starts at each offset, and that span's end. */
function formedIndex(timeline: MergeTimeline | null, byteCount: number): { step: Int32Array; end: Int32Array } {
  const step = new Int32Array(byteCount + 1).fill(-1);
  const end = new Int32Array(byteCount + 1).fill(-1);
  if (timeline === null) return { step, end };
  for (let i = 0; i < timeline.stepCount; i++) {
    const left = timeline.stepLeft[i] ?? 0;
    const right = timeline.stepEnd[i] ?? 0;
    if (timeline.stepKind[i] === StepKind.ByteFallbackSplit) {
      for (let b = left; b < right; b++) {
        step[b] = i + 1;
        end[b] = b + 1;
      }
    } else {
      step[left] = i + 1;
      end[left] = right;
    }
  }
  return { step, end };
}

/** Builds a complete, transferable `TokenizationResult` (see the module comment for what is derived). */
export function buildResult(input: ResultInput): TokenizationResult {
  const { analysis, chunks: chunkIn, tokens: tokenIn, timeline } = input;
  const options: EncodeOptions = { ...DEFAULT_OPTIONS, ...input.options };
  const { utf8, chars: charCols, byteToChar } = analysis;
  const byteCount = utf8.length;
  const charCount = charCols.count;
  const charByteStart = charCols.byteStart;
  const isCharStart = (b: number): boolean => b === byteCount || charByteStart[byteToChar[b] ?? 0] === b;

  // ---- chunks ----
  const chunkCount = chunkIn.kind.length;
  if (chunkIn.byteStart.length !== chunkCount + 1) throw new RangeError('chunks.byteStart must have count+1 entries');
  const chunkByteStart = Uint32Array.from(chunkIn.byteStart);
  if (chunkByteStart[0] !== 0 || chunkByteStart[chunkCount] !== byteCount) {
    throw new RangeError(`chunks must tile [0, ${String(byteCount)})`);
  }
  const byteToChunk = new Int32Array(byteCount).fill(-1);
  const chunkCharStart = new Uint32Array(chunkCount + 1);
  for (let c = 0; c < chunkCount; c++) {
    const s = chunkByteStart[c] ?? 0;
    const e = chunkByteStart[c + 1] ?? 0;
    if (!(e > s)) throw new RangeError(`chunk ${String(c)} [${String(s)}, ${String(e)}) is empty or reversed`);
    if (!isCharStart(s)) throw new RangeError(`chunk ${String(c)} starts inside a code point`);
    byteToChunk.fill(c, s, e);
    chunkCharStart[c] = byteToChar[s] ?? 0;
  }
  chunkCharStart[chunkCount] = charCount;

  // ---- tokens ----
  const tokenCount = tokenIn.id.length;
  if (tokenIn.byteStart.length !== tokenCount + 1 || tokenIn.kind.length !== tokenCount) {
    throw new RangeError('tokens.byteStart must have count+1 entries and tokens.kind count entries');
  }
  const id = Uint32Array.from(tokenIn.id);
  const tokenByteStart = Uint32Array.from(tokenIn.byteStart);
  const kind = Uint8Array.from(tokenIn.kind);
  const flags = new Uint8Array(tokenCount);
  const tokenChunk = new Int32Array(tokenCount);
  const charFirst = new Int32Array(tokenCount);
  const charLast = new Int32Array(tokenCount);
  const stepFormed = new Int32Array(tokenCount).fill(-1);
  const byteToToken = new Int32Array(byteCount).fill(-1);
  const formed = formedIndex(timeline, byteCount);
  if (tokenByteStart[0] !== 0 || tokenByteStart[tokenCount] !== byteCount) {
    throw new RangeError(`tokens must cover [0, ${String(byteCount)}) contiguously`);
  }
  let partialTokens = 0;
  let zeroWidthTokens = 0;
  let specialTokens = 0;
  for (let t = 0; t < tokenCount; t++) {
    const s = tokenByteStart[t] ?? 0;
    const e = tokenByteStart[t + 1] ?? 0;
    if (e < s) throw new RangeError(`token ${String(t)} has a reversed span [${String(s)}, ${String(e)})`);
    const k = kind[t] ?? 0;
    let f = ((tokenIn.flags?.[t] ?? 0) & ~DERIVED_FLAGS) | flagsForKind(k);
    if (s === e) {
      f |= TokenFlag.ZeroWidth;
      zeroWidthTokens++;
      tokenChunk[t] = -1;
      const first = s === byteCount ? charCount : (byteToChar[s] ?? 0);
      charFirst[t] = first;
      charLast[t] = first - 1;
    } else {
      if (!isValidUtf8(utf8, s, e)) f |= TokenFlag.Partial;
      if (!isCharStart(s)) f |= TokenFlag.StartsMidChar;
      if (!isCharStart(e)) f |= TokenFlag.EndsMidChar;
      const c = byteToChunk[s] ?? -1;
      if (byteToChunk[e - 1] !== c) throw new RangeError(`token ${String(t)} crosses a chunk edge`);
      tokenChunk[t] = c;
      charFirst[t] = byteToChar[s] ?? 0;
      charLast[t] = byteToChar[e - 1] ?? 0;
      byteToToken.fill(t, s, e);
      if (formed.end[s] === e) stepFormed[t] = formed.step[s] ?? -1;
    }
    if (f & TokenFlag.Partial) partialTokens++;
    if (f & TokenFlag.Special) specialTokens++;
    flags[t] = f;
  }

  // ---- chunk → first token ----
  const tokenStart = new Uint32Array(chunkCount + 1).fill(tokenCount);
  for (let t = tokenCount - 1; t >= 0; t--) {
    const c = tokenChunk[t] ?? -1;
    if (c >= 0) tokenStart[c] = t;
  }

  // ---- chars ----
  const charChunk = new Int32Array(charCount);
  const tokenFirst = new Int32Array(charCount);
  const tokenLast = new Int32Array(charCount);
  let splitChars = 0;
  for (let i = 0; i < charCount; i++) {
    const s = charByteStart[i] ?? 0;
    const e = charByteStart[i + 1] ?? 0;
    charChunk[i] = byteToChunk[s] ?? -1;
    tokenFirst[i] = byteToToken[s] ?? -1;
    tokenLast[i] = byteToToken[e - 1] ?? -1;
    if ((tokenLast[i] ?? 0) > (tokenFirst[i] ?? 0)) splitChars++;
  }

  const normalization = input.normalization ?? null;
  if (normalization !== null && normalization.sourceRunStart.length !== charCount) {
    throw new RangeError('normalization source map must have one entry per code point of the encoded text');
  }
  const inputText = input.inputText ?? analysis.text;
  return {
    tokenizer: input.tokenizer,
    family: input.family,
    options,
    input: {
      text: inputText,
      codePoints: inputText === analysis.text ? charCount : countCodePoints(inputText),
      utf16Units: inputText.length,
    },
    text: analysis.text,
    normalization: normalization === null ? null : { form: 'NFKC', changed: normalization.changed },
    utf8,
    chars: {
      count: charCount,
      cp: charCols.cp,
      utf16Start: charCols.utf16Start,
      byteStart: charByteStart,
      grapheme: charCols.grapheme,
      chunk: charChunk,
      tokenFirst,
      tokenLast,
      sourceRunStart: normalization === null ? null : normalization.sourceRunStart,
      sourceRunEnd: normalization === null ? null : normalization.sourceRunEnd,
    },
    graphemes: analysis.graphemes,
    chunks: {
      count: chunkCount,
      byteStart: chunkByteStart,
      charStart: chunkCharStart,
      tokenStart,
      kind: Uint8Array.from(chunkIn.kind),
      directHit: chunkIn.directHit ? Uint8Array.from(chunkIn.directHit) : new Uint8Array(chunkCount),
      rule: chunkIn.rule ? Uint8Array.from(chunkIn.rule) : new Uint8Array(chunkCount).fill(255),
    },
    tokens: {
      count: tokenCount,
      id,
      byteStart: tokenByteStart,
      flags,
      kind,
      chunk: tokenChunk,
      charFirst,
      charLast,
      stepFormed,
    },
    timeline,
    byteToChar,
    byteToToken,
    byteToChunk,
    stats: {
      codePoints: charCount,
      utf16Units: analysis.text.length,
      bytes: byteCount,
      graphemes: analysis.graphemes.count,
      chunks: chunkCount,
      tokens: tokenCount,
      partialTokens,
      splitChars,
      zeroWidthTokens,
      specialTokens,
      mergeSteps: input.mergeSteps ?? timeline?.stepCount ?? 0,
    },
    timings: input.timings ?? { analyzeMs: 0, encodeMs: 0 },
    seq: input.seq ?? 0,
  };
}
