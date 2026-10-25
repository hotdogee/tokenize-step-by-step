/**
 * The `AlignmentError` path (04 §3.2 step 6, 04 §5): `alignSpans` maps working-buffer spans through `normToOrig` and
 * throws, with the token index and the expected / actual original offsets, whenever the spans would not consume the
 * text exactly. The engine's own spans are contiguous by construction, so the error is exercised on hand-made inputs.
 */
import { describe, expect, it } from 'vitest';
import { AlignmentError, alignSpans } from '../../../src/engines/spm/index.ts';
import { normalizeSpm } from '../../../src/engines/spm/normalize.ts';
import { encodeUtf8 } from '../../../src/text/utf8.ts';

/** Expects `fn` to throw an AlignmentError with these fields. */
function expectAlignmentError(fn: () => unknown, tokenIndex: number, expected: number, actual: number): void {
  let error: unknown = null;
  try {
    fn();
  } catch (caught) {
    error = caught;
  }
  expect(error).toBeInstanceOf(AlignmentError);
  expect(error).toMatchObject({ name: 'AlignmentError', tokenIndex, expected, actual });
}

describe('alignSpans', () => {
  // "a b" with a dummy prefix: norm = ▁ a ▁ b (3 + 1 + 3 + 1 bytes); normToOrig = [0,0,0, 0, 1,1,1, 2, 3].
  const { normToOrig } = normalizeSpm(encodeUtf8('a b'), true, true);

  it('maps contiguous working spans to original spans (dummy 0 bytes, escaped space 1 byte)', () => {
    expect(Array.from(normToOrig)).toEqual([0, 0, 0, 0, 1, 1, 1, 2, 3]);
    expect(Array.from(alignSpans([0, 3, 4, 7], [3, 4, 7, 8], 4, normToOrig, 3))).toEqual([0, 0, 1, 2, 3]);
    expect(Array.from(alignSpans([0], [8], 1, normToOrig, 3))).toEqual([0, 3]);
    expect(Array.from(alignSpans([], [], 0, new Uint32Array([0]), 0))).toEqual([0]);
  });

  it('throws on a gap between tokens', () => {
    expectAlignmentError(() => alignSpans([0, 4], [3, 8], 2, normToOrig, 3), 1, 0, 1);
  });

  it('throws when a span runs backwards (non-monotone map)', () => {
    const broken = Uint32Array.from([0, 2, 1, 3]);
    expectAlignmentError(() => alignSpans([0, 1], [1, 2], 2, broken, 3), 1, 2, 1);
  });

  it('throws when the tokens do not reach utf8.length (or overshoot it)', () => {
    expectAlignmentError(() => alignSpans([0], [7], 1, normToOrig, 3), 1, 3, 2);
    expectAlignmentError(() => alignSpans([0], [8], 1, normToOrig, 2), 1, 2, 3);
  });

  it('carries a readable message', () => {
    expect(new AlignmentError(4, 10, 12).message).toMatch(/token 4: expected original byte offset 10, got 12/);
  });
});
