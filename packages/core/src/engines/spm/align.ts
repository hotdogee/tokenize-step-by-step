/**
 * Step 6 of the SentencePiece encode (04 §3.2): token spans in the original UTF-8 come from the working-buffer spans
 * through `normToOrig`, by construction (03 §B.3) — an escaped space is 3 working bytes for 1 original byte, a literal
 * U+2581 is 3 for 3, the dummy prefix 3 for 0. The spans must be contiguous from 0 and end exactly at `utf8.length`;
 * otherwise the engine throws `AlignmentError` rather than misalign (03 §B.0 rule 6, 04 §5).
 */

/** Token spans do not consume the original bytes exactly (Worker `error.code = 'alignment'`, 04 §5). */
export class AlignmentError extends Error {
  /** Index of the offending token (= the token count when the end is wrong). */
  readonly tokenIndex: number;
  /** Original byte offset the token should start (or the text should end) at. */
  readonly expected: number;
  readonly actual: number;

  constructor(tokenIndex: number, expected: number, actual: number) {
    super(
      `token ${String(tokenIndex)}: expected original byte offset ${String(expected)}, got ${String(actual)} (SentencePiece spans do not consume the text exactly)`,
    );
    this.name = 'AlignmentError';
    this.tokenIndex = tokenIndex;
    this.expected = expected;
    this.actual = actual;
  }
}

/**
 * Original byte offsets of `count` tokens given their working-buffer spans `[normStart[t], normEnd[t])`: returns
 * `count + 1` boundaries (token t is `[out[t], out[t + 1])`). Throws `AlignmentError` when a token does not start where the
 * previous one ended, runs backwards, or the last one does not end at `byteCount`.
 */
export function alignSpans(
  normStart: ArrayLike<number>,
  normEnd: ArrayLike<number>,
  count: number,
  normToOrig: ArrayLike<number>,
  byteCount: number,
): Uint32Array {
  const out = new Uint32Array(count + 1);
  let cursor = 0;
  for (let t = 0; t < count; t++) {
    const s = normToOrig[normStart[t] ?? -1] ?? -1;
    const e = normToOrig[normEnd[t] ?? -1] ?? -1;
    if (s !== cursor) throw new AlignmentError(t, cursor, s);
    if (e < s) throw new AlignmentError(t, s, e);
    out[t] = s;
    cursor = e;
  }
  if (cursor !== byteCount) throw new AlignmentError(count, byteCount, cursor);
  out[count] = cursor;
  return out;
}
