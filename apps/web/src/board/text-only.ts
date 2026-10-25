/**
 * A `TokenizationResult` with the text tables only (05 §12): while no tokenizer result belongs to the current text, stops
 * 1–3 are live from `analyzeText` on the main thread, so the board packs code points and bytes from this result. It has
 * no chunks, no tokens and no timeline; the token tier waits for the engine.
 */
import type { Family, TokenizationResult, TokenizerId } from '@tsbs/core';
import { DEFAULT_OPTIONS } from '@tsbs/core/model/result';
import { analyzeText } from '@tsbs/core/text/analyze';

export function textOnlyResult(text: string, tokenizer: TokenizerId, family: Family): TokenizationResult {
  const analysis = analyzeText(text);
  const { utf8, chars, graphemes, byteToChar } = analysis;
  const n = utf8.length;
  return {
    tokenizer,
    family,
    options: DEFAULT_OPTIONS,
    input: { text, codePoints: chars.count, utf16Units: text.length },
    text,
    normalization: null,
    utf8,
    chars: {
      count: chars.count,
      cp: chars.cp,
      utf16Start: chars.utf16Start,
      byteStart: chars.byteStart,
      grapheme: chars.grapheme,
      chunk: new Int32Array(chars.count).fill(-1),
      tokenFirst: new Int32Array(chars.count).fill(-1),
      tokenLast: new Int32Array(chars.count).fill(-1),
      sourceRunStart: null,
      sourceRunEnd: null,
    },
    graphemes,
    chunks: {
      count: 0,
      byteStart: new Uint32Array([n]),
      charStart: new Uint32Array([chars.count]),
      tokenStart: new Uint32Array([0]),
      kind: new Uint8Array(0),
      directHit: new Uint8Array(0),
      rule: new Uint8Array(0),
    },
    tokens: {
      count: 0,
      id: new Uint32Array(0),
      byteStart: new Uint32Array([n]),
      flags: new Uint8Array(0),
      kind: new Uint8Array(0),
      chunk: new Int32Array(0),
      charFirst: new Int32Array(0),
      charLast: new Int32Array(0),
      stepFormed: new Int32Array(0),
    },
    timeline: null,
    byteToChar,
    byteToToken: new Int32Array(n).fill(-1),
    byteToChunk: new Int32Array(n).fill(-1),
    stats: {
      codePoints: chars.count,
      utf16Units: text.length,
      bytes: n,
      graphemes: graphemes.count,
      chunks: 0,
      tokens: 0,
      partialTokens: 0,
      splitChars: 0,
      zeroWidthTokens: 0,
      specialTokens: 0,
      mergeSteps: 0,
    },
    timings: { analyzeMs: 0, encodeMs: 0 },
    seq: -1,
  };
}
