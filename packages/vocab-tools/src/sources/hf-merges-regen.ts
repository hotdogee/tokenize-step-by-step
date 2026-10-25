/**
 * The A2 regeneration check of the `hfSpmJson` parser (AD-6: informational, recorded as META `hfMergesRegenerable` and
 * never relied on). Split out of `hf-spm-json.ts` to keep each parser module ≤ 200 lines (03 §C.5).
 */

/** Pieces made of one repeated whitespace symbol: Gemma 3's USER_DEFINED score class (score 0). */
const WHITESPACE_RUN = /^(?:\n+|▁+|\t+)$/u;

/**
 * A2 regeneration check: HF `generate_merges` (every split of every piece into two vocabulary pieces, sorted by
 * `(score, len(left), len(right))` descending with a stable order and the per-piece splits pre-sorted by the halves'
 * ids), with scores derived from the JSON alone — whitespace-run pieces score 0, every other piece
 * `(byteFirstId + 256) − id`. True iff the regenerated list equals `merges` exactly.
 */
export function mergesRegenerable(
  vocab: ReadonlyMap<string, number>,
  idToPiece: readonly string[],
  merges: ReadonlyArray<readonly [string, string]>,
  byteFirstId: number,
): boolean {
  const firstNormal = byteFirstId + 256;
  const regenerated: Array<{ l: string; r: string; score: number }> = [];
  idToPiece.forEach((piece, id) => {
    const local: Array<{ l: string; r: string; li: number; ri: number }> = [];
    for (let i = 1; i < piece.length; i++) {
      const l = piece.slice(0, i);
      const r = piece.slice(i);
      const li = vocab.get(l);
      const ri = vocab.get(r);
      if (li !== undefined && ri !== undefined) local.push({ l, r, li, ri });
    }
    local.sort((a, b) => a.li - b.li || a.ri - b.ri);
    const score = WHITESPACE_RUN.test(piece) ? 0 : firstNormal - id;
    for (const { l, r } of local) regenerated.push({ l, r, score });
  });
  if (regenerated.length !== merges.length) return false;
  regenerated.sort((a, b) => b.score - a.score || b.l.length - a.l.length || b.r.length - a.r.length);
  return regenerated.every(({ l, r }, rank) => {
    const merge = merges[rank];
    return merge?.[0] === l && merge[1] === r;
  });
}
