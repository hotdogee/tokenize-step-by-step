/**
 * TODO(WP-integration): the precomputed default result (AD-16) built locally from ONE fixture case, until WP01's
 * `fromFixtureCase` and WP03's `generated/examples-default.json` land. The integrator deletes this file and inlines the
 * generated default example instead.
 *
 * `DEFAULT_CASE` is `fixtures/openai-o200k_base.json` › `zh-tw-tainan` verbatim (stub-result.test.ts compares it with the
 * fixture). `buildTiktokenResult` covers what that case needs — a tiktoken-family case without zero-width or special
 * tokens — and fills every FROZEN table, including the merge timeline (born/died boundaries and per-step arrays).
 * Step numbers are 1-based (`stepFormed`, `boundaryDied`): step k is the k-th merge, k ∈ 1…stepCount.
 */
import type { TokenizationResult, TokenizerId } from '@tsbs/core';
import { ALIVE, ChunkKind, DEFAULT_OPTIONS, NEVER, StepKind, TokenFlag, TokenKind } from '@tsbs/core/model/result';

/** The subset of a tiktoken fixture case the builder reads (fixture-types.ts `TiktokenFixtureCase`). */
export interface StubCase {
  readonly name: string;
  readonly text: string;
  readonly ids: readonly number[];
  readonly tokens: ReadonlyArray<{
    readonly id: number;
    readonly start: number;
    readonly end: number;
    readonly partial: boolean;
  }>;
  readonly chunks: ReadonlyArray<readonly [number, number]>;
  readonly merges: ReadonlyArray<{
    readonly chunk: number;
    readonly directHit: boolean;
    readonly steps: ReadonlyArray<readonly [number, number]>;
  }>;
}

/** fixtures/openai-o200k_base.json › zh-tw-tainan (台灣台南 = [3735, 133072, 3735, 14609]). */
export const DEFAULT_CASE: StubCase = {
  name: 'zh-tw-tainan',
  text: '台灣台南',
  ids: [3735, 133072, 3735, 14609],
  tokens: [
    { id: 3735, start: 0, end: 3, partial: false },
    { id: 133072, start: 3, end: 6, partial: false },
    { id: 3735, start: 6, end: 9, partial: false },
    { id: 14609, start: 9, end: 12, partial: false },
  ],
  chunks: [[0, 12]],
  merges: [
    {
      chunk: 0,
      directHit: false,
      steps: [
        [0, 948],
        [5, 948],
        [7, 2166],
        [0, 3735],
        [4, 3735],
        [1, 13864],
        [4, 14609],
        [1, 133072],
      ],
    },
  ],
};

export const DEFAULT_CASE_TOKENIZER: TokenizerId = 'openai-o200k_base';

const encoder = new TextEncoder();

/** Builds the FROZEN `TokenizationResult` of a tiktoken-family fixture case (no zero-width / special tokens). */
export function buildTiktokenResult(tokenizer: TokenizerId, fixtureCase: StubCase, seq = 0): TokenizationResult {
  const text = fixtureCase.text;
  const utf8 = encoder.encode(text);
  const byteCount = utf8.length;
  const codePoints = Array.from(text);
  const charCount = codePoints.length;

  // Characters.
  const cp = new Uint32Array(charCount);
  const utf16Start = new Uint32Array(charCount + 1);
  const charByteStart = new Uint32Array(charCount + 1);
  let u16 = 0;
  let byte = 0;
  codePoints.forEach((char, i) => {
    cp[i] = char.codePointAt(0) ?? 0xfffd;
    utf16Start[i] = u16;
    charByteStart[i] = byte;
    u16 += char.length;
    byte += encoder.encode(char).length;
  });
  utf16Start[charCount] = u16;
  charByteStart[charCount] = byte;
  const byteToChar = new Uint32Array(byteCount);
  for (let i = 0; i < charCount; i++) byteToChar.fill(i, charByteStart[i] ?? 0, charByteStart[i + 1] ?? byteCount);

  // Graphemes (Intl.Segmenter, else one per code point).
  const graphemeStarts: number[] = [];
  let source: 'segmenter' | 'fallback' = 'fallback';
  if (typeof Intl.Segmenter === 'function') {
    source = 'segmenter';
    let index = 0;
    let unit = 0;
    for (const { segment } of new Intl.Segmenter(undefined, { granularity: 'grapheme' }).segment(text)) {
      while ((utf16Start[index] ?? u16) < unit) index++;
      graphemeStarts.push(index);
      unit += segment.length;
    }
  } else {
    for (let i = 0; i < charCount; i++) graphemeStarts.push(i);
  }
  const graphemeCount = graphemeStarts.length;
  const gCharStart = Uint32Array.from([...graphemeStarts, charCount]);
  const gByteStart = Uint32Array.from([...graphemeStarts, charCount].map((c) => charByteStart[c] ?? byteCount));
  const charGrapheme = new Uint32Array(charCount);
  for (let g = 0; g < graphemeCount; g++) charGrapheme.fill(g, gCharStart[g] ?? 0, gCharStart[g + 1] ?? charCount);

  // Tokens.
  const tokenCount = fixtureCase.tokens.length;
  const id = Uint32Array.from(fixtureCase.tokens.map((token) => token.id));
  const tokenByteStart = Uint32Array.from([...fixtureCase.tokens.map((token) => token.start), byteCount]);
  const byteToToken = new Int32Array(byteCount);
  fixtureCase.tokens.forEach((token, t) => byteToToken.fill(t, token.start, token.end));
  const isCharStart = (b: number): boolean => b >= byteCount || charByteStart[byteToChar[b] ?? 0] === b;

  // Chunks.
  const chunkCount = fixtureCase.chunks.length;
  const chunkByteStart = Uint32Array.from([...fixtureCase.chunks.map(([start]) => start), byteCount]);
  const byteToChunk = new Int32Array(byteCount);
  fixtureCase.chunks.forEach(([start, end], c) => byteToChunk.fill(c, start, end));
  const directHit = Uint8Array.from(fixtureCase.merges.map((merge) => (merge.directHit ? 1 : 0)));

  // Timeline: replay the fixture's [position, rank] steps chunk by chunk.
  const boundaryBorn = new Int32Array(byteCount + 1);
  const boundaryDied = new Int32Array(byteCount + 1).fill(ALIVE);
  const steps = fixtureCase.merges.flatMap((merge) => merge.steps.map((step) => ({ chunk: merge.chunk, step })));
  const stepCount = steps.length;
  const stepLeft = new Uint32Array(stepCount);
  const stepMid = new Uint32Array(stepCount);
  const stepEnd = new Uint32Array(stepCount);
  const stepRank = new Float32Array(stepCount);
  const stepResultId = new Int32Array(stepCount);
  const stepChunk = new Uint32Array(stepCount);
  let k = 0;
  for (const merge of fixtureCase.merges) {
    const [start, end] = fixtureCase.chunks[merge.chunk] ?? [0, 0];
    if (merge.directHit) for (let b = start + 1; b < end; b++) boundaryBorn[b] = NEVER;
    const parts = Array.from({ length: end - start }, (_, i) => start + i);
    for (const [position, rank] of merge.steps) {
      const left = parts[position] ?? start;
      const mid = parts[position + 1] ?? end;
      const right = parts[position + 2] ?? end;
      parts.splice(position + 1, 1);
      boundaryDied[mid] = k + 1;
      stepLeft[k] = left;
      stepMid[k] = mid;
      stepEnd[k] = right;
      stepRank[k] = rank;
      stepResultId[k] = rank;
      stepChunk[k] = merge.chunk;
      k++;
    }
  }
  const stepFormed = Int32Array.from(fixtureCase.tokens, (token) => {
    for (let s = stepCount - 1; s >= 0; s--) if (stepLeft[s] === token.start && stepEnd[s] === token.end) return s + 1;
    return -1;
  });
  const flags = Uint8Array.from(fixtureCase.tokens, (token, t) => {
    let f = token.partial ? TokenFlag.Partial : 0;
    if (!isCharStart(token.start)) f |= TokenFlag.StartsMidChar;
    if (!isCharStart(token.end)) f |= TokenFlag.EndsMidChar;
    if ((stepFormed[t] ?? -1) === -1 && directHit[byteToChunk[token.start] ?? 0] === 1) f |= TokenFlag.DirectHit;
    return f;
  });
  const chunkOfToken = Int32Array.from(fixtureCase.tokens, (token) => byteToChunk[token.start] ?? 0);
  const charFirst = Int32Array.from(fixtureCase.tokens, (token) => byteToChar[token.start] ?? 0);
  const charLast = Int32Array.from(fixtureCase.tokens, (token) => byteToChar[token.end - 1] ?? 0);
  const tokenStartOfChunk = Uint32Array.from([
    ...fixtureCase.chunks.map(([start]) => byteToToken[start] ?? 0),
    tokenCount,
  ]);
  const charStartOfChunk = Uint32Array.from([
    ...fixtureCase.chunks.map(([start]) => byteToChar[start] ?? 0),
    charCount,
  ]);

  const tokenFirst = new Int32Array(charCount);
  const tokenLast = new Int32Array(charCount);
  const chunkOfChar = new Int32Array(charCount);
  for (let i = 0; i < charCount; i++) {
    const first = charByteStart[i] ?? 0;
    const last = (charByteStart[i + 1] ?? byteCount) - 1;
    tokenFirst[i] = byteToToken[first] ?? 0;
    tokenLast[i] = byteToToken[last] ?? 0;
    chunkOfChar[i] = byteToChunk[first] ?? 0;
  }
  let partialTokens = 0;
  for (const f of flags) if ((f & TokenFlag.Partial) !== 0) partialTokens++;
  let splitChars = 0;
  for (let i = 0; i < charCount; i++) if ((tokenLast[i] ?? 0) > (tokenFirst[i] ?? 0)) splitChars++;

  return {
    tokenizer,
    family: 'bytelevel-bpe',
    options: DEFAULT_OPTIONS,
    input: { text, codePoints: charCount, utf16Units: text.length },
    text,
    normalization: null,
    utf8,
    chars: {
      count: charCount,
      cp,
      utf16Start,
      byteStart: charByteStart,
      grapheme: charGrapheme,
      chunk: chunkOfChar,
      tokenFirst,
      tokenLast,
      sourceRunStart: null,
      sourceRunEnd: null,
    },
    graphemes: { count: graphemeCount, source, charStart: gCharStart, byteStart: gByteStart },
    chunks: {
      count: chunkCount,
      byteStart: chunkByteStart,
      charStart: charStartOfChunk,
      tokenStart: tokenStartOfChunk,
      kind: new Uint8Array(chunkCount).fill(ChunkKind.Regex),
      directHit,
      rule: new Uint8Array(chunkCount).fill(255),
    },
    tokens: {
      count: tokenCount,
      id,
      byteStart: tokenByteStart,
      flags,
      kind: new Uint8Array(tokenCount).fill(TokenKind.Normal),
      chunk: chunkOfToken,
      charFirst,
      charLast,
      stepFormed,
    },
    timeline: {
      stepCount,
      leadingZeroWidthPart: false,
      boundaryBorn,
      boundaryDied,
      stepKind: new Uint8Array(stepCount).fill(StepKind.Merge),
      stepLeft,
      stepMid,
      stepEnd,
      stepRank,
      stepResultId,
      stepChunk,
      truncated: false,
    },
    byteToChar,
    byteToToken,
    byteToChunk,
    stats: {
      codePoints: charCount,
      utf16Units: text.length,
      bytes: byteCount,
      graphemes: graphemeCount,
      chunks: chunkCount,
      tokens: tokenCount,
      partialTokens,
      splitChars,
      zeroWidthTokens: 0,
      specialTokens: 0,
      mergeSteps: stepCount,
    },
    timings: { analyzeMs: 0, encodeMs: 0 },
    seq,
  };
}

/** The precomputed default example: 台灣台南 on o200k_base. */
export function defaultResult(seq = 0): TokenizationResult {
  return buildTiktokenResult(DEFAULT_CASE_TOKENIZER, DEFAULT_CASE, seq);
}
