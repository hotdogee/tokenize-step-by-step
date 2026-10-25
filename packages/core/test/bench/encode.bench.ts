/**
 * `vitest bench`: encode 10,000 and 20,000 CJK code points (one regex chunk / one SentencePiece word, the primary
 * audience's worst case, AD-21) with every engine over its BUILT asset, trace on (06 §3: ≤ 15 ms byte-level, ≤ 20 ms spm,
 * 20k byte-level ≤ 40 ms in Node ⇒ ×4 on the phone; spm 20k is recorded without a ceiling). The inputs are the ones the
 * `TSBS_PERF=1` tests time (`cjkText`, `spmCjkText`). Run with `pnpm bench`; `check-bench.ts` asserts the medians when
 * `TSBS_PERF=1`. Skips without `data/vocab/dist` (`pnpm vocab:build`).
 */
import { bench, describe } from 'vitest';
import type { Tokenizer } from '../../src/index.ts';
import { BYTELEVEL_IDS, cjkText, SKIP_REASON, tokenizerFor } from '../engines/bytelevel/assets.ts';
import { BUILT, SPM_IDS, spmCjkText, spmTokenizer } from '../engines/spm/helpers.ts';
import { encodeBench } from './benches.ts';

const OPTIONS = { time: 1000, warmupIterations: 10 } as const;

describe.skipIf(SKIP_REASON !== null)('encode CJK, byte-level (06 §3)', () => {
  const ten = cjkText(10_000);
  const twenty = cjkText(20_000);
  for (const id of BYTELEVEL_IDS) {
    let tokenizer: Tokenizer | undefined;
    const engine = (): Tokenizer => (tokenizer ??= tokenizerFor(id));
    bench(encodeBench(id, 10).name, () => void engine().encode(ten), OPTIONS);
    bench(encodeBench(id, 20).name, () => void engine().encode(twenty), OPTIONS);
  }
});

describe.skipIf(!BUILT)('encode CJK, SentencePiece (06 §3)', () => {
  const ten = spmCjkText(10_000);
  const twenty = spmCjkText(20_000);
  for (const id of SPM_IDS) {
    let tokenizer: Tokenizer | undefined;
    const engine = (): Tokenizer => (tokenizer ??= spmTokenizer(id));
    bench(encodeBench(id, 10).name, () => void engine().encode(ten), OPTIONS);
    bench(encodeBench(id, 20).name, () => void engine().encode(twenty), OPTIONS);
  }
});
