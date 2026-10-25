/**
 * Opt-in Node ceiling of 06 §3 for Engine B (`TSBS_PERF=1`, like WP02; the every-PR unit job shares runners, so timing
 * assertions stay out of it): encoding 10,000 CJK code points (one SentencePiece "word") with the timeline ≤ 20 ms on every
 * spm tokenizer, as the median of warm runs. The resident-memory ceiling is in `resident.test.ts` (a file of its own).
 */
import { describe, expect, it } from 'vitest';
import { caseOf } from '../../helpers/fixtures.ts';
import { PERF_BUDGETS, time } from '../../helpers/perf.ts';
import { BUILT, SPM_IDS, spmTokenizer } from './helpers.ts';

const CJK_10K = ((): string => {
  const unit = Array.from(caseOf('xai-grok1', 'zh-tw-paragraph').text).filter((ch) => ch !== ' ');
  return Array.from({ length: 10_000 }, (_, i) => unit[i % unit.length]).join('');
})();

describe.skipIf(!PERF_BUDGETS || !BUILT)('spm encode ceiling (TSBS_PERF=1, 06 §3)', () => {
  it.each(SPM_IDS)('%s encodes 10k CJK code points in ≤ 20 ms (median, trace on)', (id) => {
    const tokenizer = spmTokenizer(id);
    expect(Array.from(CJK_10K)).toHaveLength(10_000);
    const { cold, median } = time(() => tokenizer.encode(CJK_10K), 15);
    console.log(`${id}: 10k CJK encode median ${median.toFixed(2)} ms (cold ${cold.toFixed(2)} ms)`);
    expect(median).toBeLessThanOrEqual(20);
  });
});
