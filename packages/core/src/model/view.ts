/**
 * `TokenizationView` (03 §B.2, AD-20): the main-thread wrapper around a transferred `TokenizationResult`, with lazy
 * per-cell accessors in the FROZEN shapes of `view-types.ts` — `charAt`, `tokenAt`, `tokensAtByte`, `charsOfToken`,
 * `partsAt(k)` (live parts after k steps through a cached `ReplayCursor`, so ±1 is O(1) amortised) and `stepSentence(k)`.
 *
 * Steps are 1-based (`timeline.ts`). A part's id is known when the part is a final token, when a recorded merge formed it,
 * or when the optional `idOf` resolver (the inspector's Worker `lookup`) names it; otherwise `partId` is −1. Without a
 * timeline (spm precomputed results, `trace: false`) only `partsAt(0)` exists and it shows the final tokens as the parts
 * (05 §2: stop 4 is derived from the final tokens).
 */
import { codePointLabel, decodeUtf8, hexByte } from '../text/utf8.ts';
import { isUnpairedSurrogateAt } from '../text/analyze.ts';
import { isCombiningMark, standInFor } from '../text/stand-ins.ts';
import { ReplayCursor } from '../timeline/replay.ts';
import { flagsToWords } from './flags.ts';
import { ChunkKind, StepKind, TokenFlag, TokenKind, type TokenizationResult } from './result.ts';
import type { CharInfo, PartsAt, ResolvedTextLang, StepSentence, TokenInfo } from './view-types.ts';

export interface ViewOptions {
  /** `CharInfo.lang` for every char: the resolved text language (05 §10). Default `'und'`. */
  readonly lang?: ResolvedTextLang;
  /** spm piece string for an id (`Tokenizer.pieceString`, or the fixture's `piece`); default: none. */
  readonly pieceOf?: (id: number) => string | null;
  /** Vocabulary lookup for intermediate parts that are neither final tokens nor formed by a recorded merge. */
  readonly idOf?: (bytes: Uint8Array) => number | null;
}

function hexOf(bytes: Uint8Array, start: number, end: number): string[] {
  const out: string[] = [];
  for (let b = start; b < end; b++) out.push(hexByte(bytes[b] ?? 0));
  return out;
}

export class TokenizationView {
  readonly result: TokenizationResult;
  private readonly options: ViewOptions;
  private cursor: ReplayCursor | null = null;
  private zeroWidth: Map<number, number[]> | null = null;
  private insideSpecial: Uint8Array | null = null;

  constructor(result: TokenizationResult, options: ViewOptions = {}) {
    this.result = result;
    this.options = options;
  }

  /** Steps the scrubber can show (0 without a timeline). */
  get stepCount(): number {
    return this.result.timeline?.stepCount ?? 0;
  }

  /** The char row `i` (0 ≤ i < chars.count). */
  charAt(i: number): CharInfo {
    const { chars, text } = this.result;
    if (!Number.isInteger(i) || i < 0 || i >= chars.count) throw new RangeError(`char ${String(i)} out of range`);
    const cp = chars.cp[i] ?? 0;
    const tokenFirst = chars.tokenFirst[i] ?? -1;
    const tokenLast = chars.tokenLast[i] ?? -1;
    const sourceStart = chars.sourceRunStart?.[i];
    const sourceEnd = chars.sourceRunEnd?.[i];
    return {
      index: i,
      cp,
      hex: codePointLabel(cp),
      byteStart: chars.byteStart[i] ?? 0,
      byteEnd: chars.byteStart[i + 1] ?? 0,
      utf16Start: chars.utf16Start[i] ?? 0,
      utf16End: chars.utf16Start[i + 1] ?? text.length,
      grapheme: chars.grapheme[i] ?? 0,
      chunk: chars.chunk[i] ?? -1,
      tokenFirst,
      tokenLast,
      split: tokenLast > tokenFirst,
      standIn: standInFor(cp),
      combining: isCombiningMark(cp),
      lang: this.options.lang ?? 'und',
      sourceRun: sourceStart !== undefined && sourceEnd !== undefined ? [sourceStart, sourceEnd] : null,
    };
  }

  /** True when char `i` is U+FFFD standing for an unpaired surrogate of the input (the inspector says so). */
  isUnpairedSurrogate(i: number): boolean {
    const { chars, text } = this.result;
    return chars.cp[i] === 0xfffd && isUnpairedSurrogateAt(text, chars.utf16Start[i] ?? 0);
  }

  /** The token `t` (0 ≤ t < tokens.count). */
  tokenAt(t: number): TokenInfo {
    const { tokens, utf8, chars } = this.result;
    if (!Number.isInteger(t) || t < 0 || t >= tokens.count) throw new RangeError(`token ${String(t)} out of range`);
    const byteStart = tokens.byteStart[t] ?? 0;
    const byteEnd = tokens.byteStart[t + 1] ?? 0;
    const flags = tokens.flags[t] ?? 0;
    const charFirst = tokens.charFirst[t] ?? 0;
    const charLast = tokens.charLast[t] ?? -1;
    const zeroWidth = byteStart === byteEnd;
    const startsMid = (flags & TokenFlag.StartsMidChar) !== 0;
    const endsMid = (flags & TokenFlag.EndsMidChar) !== 0;
    let completes: TokenInfo['completes'] = 'full';
    if (startsMid || endsMid) {
      if (charLast > charFirst) completes = 'crosses';
      else if (startsMid && endsMid) completes = 'inside';
      else completes = endsMid ? 'starts' : 'ends';
    }
    const charsBytes = zeroWidth ? 0 : (chars.byteStart[charLast + 1] ?? 0) - (chars.byteStart[charFirst] ?? 0);
    const id = tokens.id[t] ?? 0;
    const bytes = utf8.subarray(byteStart, byteEnd);
    return {
      index: t,
      id,
      byteStart,
      byteEnd,
      bytes,
      hex: hexOf(utf8, byteStart, byteEnd),
      dec: Array.from(bytes),
      text: decodeUtf8(utf8, byteStart, byteEnd),
      piece: this.options.pieceOf?.(id) ?? null,
      kind: tokens.kind[t] ?? 0,
      flags,
      flagsAsWords: flagsToWords(flags),
      completes,
      missingBytes: zeroWidth ? 0 : charsBytes - (byteEnd - byteStart),
      charFirst,
      charLast,
      chunk: tokens.chunk[t] ?? -1,
      stepFormed: tokens.stepFormed[t] ?? -1,
      zeroWidth,
      partial: (flags & TokenFlag.Partial) !== 0,
    };
  }

  private zeroWidthTokens(): Map<number, number[]> {
    if (this.zeroWidth === null) {
      const map = new Map<number, number[]>();
      const { tokens } = this.result;
      for (let t = 0; t < tokens.count; t++) {
        const s = tokens.byteStart[t] ?? 0;
        if (s !== tokens.byteStart[t + 1]) continue;
        const list = map.get(s);
        if (list) list.push(t);
        else map.set(s, [t]);
      }
      this.zeroWidth = map;
    }
    return this.zeroWidth;
  }

  /** Tokens at byte `b`: the zero-width tokens at boundary b (in order), then the token that covers byte b. */
  tokensAtByte(b: number): number[] {
    const { utf8, byteToToken } = this.result;
    const out = [...(this.zeroWidthTokens().get(b) ?? [])];
    if (b >= 0 && b < utf8.length) out.push(byteToToken[b] ?? -1);
    return out;
  }

  /** Char indices token `t` overlaps (empty for a zero-width token). */
  charsOfToken(t: number): number[] {
    const { tokens } = this.result;
    const out: number[] = [];
    for (let i = tokens.charFirst[t] ?? 0; i <= (tokens.charLast[t] ?? -1); i++) out.push(i);
    return out;
  }

  /** b is strictly inside a SpecialString chunk (its permanent boundaries are folded into one part). */
  private specialInterior(): Uint8Array {
    if (this.insideSpecial === null) {
      const { chunks, utf8 } = this.result;
      const mask = new Uint8Array(utf8.length + 1);
      for (let c = 0; c < chunks.count; c++) {
        if (chunks.kind[c] !== ChunkKind.SpecialString) continue;
        mask.fill(1, (chunks.byteStart[c] ?? 0) + 1, chunks.byteStart[c + 1] ?? 0);
      }
      this.insideSpecial = mask;
    }
    return this.insideSpecial;
  }

  /** Id of the final non-zero-width token whose span is exactly `[s, e)`, or −1. */
  private finalTokenId(s: number, e: number): number {
    const { tokens, byteToToken } = this.result;
    const t = byteToToken[s] ?? -1;
    return t >= 0 && tokens.byteStart[t] === s && tokens.byteStart[t + 1] === e ? (tokens.id[t] ?? -1) : -1;
  }

  /** The zero-width DummyPrefix token at offset 0, or −1. */
  private dummyToken(): number {
    const { tokens } = this.result;
    for (const t of this.zeroWidthTokens().get(0) ?? []) if (tokens.kind[t] === TokenKind.DummyPrefix) return t;
    return -1;
  }

  /** Parts without a timeline: the final tokens (and a bare dummy prefix as the zero-width leading part). */
  private finalParts(): PartsAt {
    const { tokens, byteToChunk } = this.result;
    const starts: number[] = [];
    const chunkOf: number[] = [];
    const ids: number[] = [];
    const dummy = this.dummyToken();
    if (dummy >= 0) {
      starts.push(0);
      chunkOf.push(-1);
      ids.push(tokens.id[dummy] ?? -1);
    }
    for (let t = 0; t < tokens.count; t++) {
      const s = tokens.byteStart[t] ?? 0;
      if (s === tokens.byteStart[t + 1]) continue;
      starts.push(s);
      chunkOf.push(byteToChunk[s] ?? -1);
      ids.push(tokens.id[t] ?? -1);
    }
    starts.push(this.result.utf8.length);
    return {
      step: 0,
      partStart: Uint32Array.from(starts),
      partChunk: Int32Array.from(chunkOf),
      partId: Int32Array.from(ids),
      justMerged: -1,
    };
  }

  /** Live parts after `k` steps (0 ≤ k ≤ stepCount). */
  partsAt(k: number): PartsAt {
    const { timeline, utf8, byteToChunk } = this.result;
    if (timeline === null) {
      if (k !== 0) throw new RangeError(`step ${String(k)}: this result has no timeline`);
      return this.finalParts();
    }
    this.cursor ??= new ReplayCursor(timeline);
    const cursor = this.cursor;
    cursor.seek(k);
    const boundaries = cursor.boundaries();
    const inside = this.specialInterior();
    const n = utf8.length;
    const leadLive = cursor.leadingPartLive;
    const dummy = leadLive ? this.dummyToken() : -1;
    const starts: number[] = [];
    const chunkOf: number[] = [];
    const ids: number[] = [];
    for (let i = 0; i + 1 < boundaries.length; i++) {
      const s = boundaries[i] ?? 0;
      if (inside[s] === 1) continue;
      let j = i + 1;
      while (j + 1 < boundaries.length && inside[boundaries[j] ?? 0] === 1) j++;
      const e = boundaries[j] ?? n;
      i = j - 1;
      starts.push(s);
      if (s === e) {
        chunkOf.push(-1);
        ids.push(dummy >= 0 ? (this.result.tokens.id[dummy] ?? -1) : -1);
        continue;
      }
      chunkOf.push(byteToChunk[s] ?? -1);
      ids.push(this.partId(s, e, leadLive && s === 0 && dummy < 0, cursor));
    }
    starts.push(n);
    const justMerged = k >= 1 ? starts.lastIndexOf(timeline.stepLeft[k - 1] ?? 0, starts.length - 2) : -1;
    return {
      step: k,
      partStart: Uint32Array.from(starts),
      partChunk: Int32Array.from(chunkOf),
      partId: Int32Array.from(ids),
      justMerged,
    };
  }

  /** Id of the live part `[s, e)` (see the module comment for the sources, in order). */
  private partId(s: number, e: number, fusedDummyPending: boolean, cursor: ReplayCursor): number {
    const { timeline, utf8 } = this.result;
    // A final token at 0 that fused the dummy prefix has a different piece than the same span before the dummy merged.
    if (!fusedDummyPending) {
      const final = this.finalTokenId(s, e);
      if (final >= 0) return final;
    }
    const j = cursor.latestMergeAt(s);
    if (timeline !== null && j > 0 && timeline.stepEnd[j - 1] === e) return timeline.stepResultId[j - 1] ?? -1;
    return this.options.idOf?.(utf8.subarray(s, e)) ?? -1;
  }

  /** The merge-list sentence of step `k` (1 ≤ k ≤ stepCount): "step 7 / 7 · E7 + 81 → 66285 (part of 灣)". */
  stepSentence(k: number): StepSentence {
    const { timeline, utf8, chars, byteToChar, text } = this.result;
    if (timeline === null || !Number.isInteger(k) || k < 1 || k > timeline.stepCount) {
      throw new RangeError(`step ${String(k)} is outside 1..${String(timeline?.stepCount ?? 0)}`);
    }
    const i = k - 1;
    const kind = timeline.stepKind[i] === StepKind.ByteFallbackSplit ? 'split' : 'merge';
    const left = timeline.stepLeft[i] ?? 0;
    const mid = timeline.stepMid[i] ?? 0;
    const end = timeline.stepEnd[i] ?? 0;
    const n = utf8.length;
    const charStartOf = (b: number): number => (b >= n ? chars.count : (byteToChar[b] ?? 0));
    const first = charStartOf(left);
    const last = end > left ? (byteToChar[end - 1] ?? 0) : first - 1;
    const aligned = (b: number): boolean => b >= n || chars.byteStart[byteToChar[b] ?? 0] === b;
    let partOf: StepSentence['partOf'] = 'whole';
    if (!aligned(left) || !aligned(end)) partOf = last > first ? 'crosses' : 'part';
    return {
      step: k,
      stepCount: timeline.stepCount,
      kind,
      leftHex: kind === 'split' ? hexOf(utf8, left, end) : hexOf(utf8, left, mid),
      rightHex: kind === 'split' ? [] : hexOf(utf8, mid, end),
      resultId: timeline.stepResultId[i] ?? -1,
      rank: timeline.stepRank[i] ?? 0,
      chunk: timeline.stepChunk[i] ?? 0,
      charsText:
        last >= first ? text.slice(chars.utf16Start[first] ?? 0, chars.utf16Start[last + 1] ?? text.length) : '',
      partOf,
    };
  }
}
