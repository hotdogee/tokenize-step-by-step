/**
 * Minimal-repro shrinking (delta debugging, Zeller's ddmin, over code points). The predicate is batched — every round
 * asks it about all candidates at once — because each round is one round trip to the Python oracle. The result is
 * 1-minimal for the removals ddmin tries: no single chunk at the final granularity can be removed without losing the
 * failure. Code points are never split, so a repro stays valid UTF-16 (no lone surrogates).
 */

/** Batched predicate: `true` for every text that still fails. */
export type BatchPredicate = (texts: readonly string[]) => Promise<readonly boolean[]>;

export interface ShrinkResult {
  readonly text: string;
  /** Predicate rounds used. */
  readonly rounds: number;
}

/** Shrinks `text` (which must fail) to a short string that still fails; stops after `maxRounds` rounds. */
export async function shrink(text: string, failing: BatchPredicate, maxRounds = 64): Promise<ShrinkResult> {
  let cps = Array.from(text);
  let granularity = 2;
  let rounds = 0;
  while (cps.length > 1 && rounds < maxRounds) {
    const size = Math.ceil(cps.length / granularity);
    const subsets: string[][] = [];
    const complements: string[][] = [];
    for (let start = 0; start < cps.length; start += size) {
      subsets.push(cps.slice(start, start + size));
      complements.push([...cps.slice(0, start), ...cps.slice(start + size)]);
    }
    // With granularity 2 the subsets and the complements are the same two halves; ask about each text once.
    const candidates = [...subsets, ...complements].filter(
      (c, i, all) => c.length > 0 && all.findIndex((d) => d.join('') === c.join('')) === i,
    );
    const verdict = await failing(candidates.map((c) => c.join('')));
    rounds++;
    let best = -1;
    verdict.forEach((fails, i) => {
      const length = candidates[i]?.length ?? Infinity;
      if (fails && (best === -1 || length < (candidates[best]?.length ?? Infinity))) best = i;
    });
    const chosen = best === -1 ? undefined : candidates[best];
    if (chosen !== undefined) {
      // ddmin: reduce to a failing subset → restart at granularity 2; to a failing complement → one chunk coarser.
      granularity = chosen.length <= size ? 2 : Math.max(granularity - 1, 2);
      cps = chosen;
      continue;
    }
    if (size === 1) break;
    granularity = Math.min(granularity * 2, cps.length);
  }
  return { text: cps.join(''), rounds };
}
