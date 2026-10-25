/**
 * The SentencePiece engine chunk (PA-8: Vite emits it as `assets/spm-[hash].js`). The host imports this module lazily,
 * `await import('./engines/spm.ts')`, on the first load of an `spm-bpe` tokenizer (04 §6 rule 5).
 *
 * TODO(WP-integration): replace the body with
 *   `export { createSpmTokenizer } from '@tsbs/core/engines/spm/index';`
 * once WP05B merges, and delete `./mock-engine.ts` with the byte-level stand-in.
 */
import type { Tsbv1 } from '@tsbs/core/format/types';
import type { Tokenizer } from '@tsbs/core/model/engine';
import { createMockTokenizer } from './mock-engine.ts';

/** Stand-in for WP05B's factory (same name and call shape, AD-32). */
export function createSpmTokenizer(tsbv: Tsbv1, entry: unknown): Tokenizer {
  if (tsbv.family !== 'spm-bpe') throw new TypeError(`createSpmTokenizer got a ${tsbv.family} asset`);
  return createMockTokenizer(tsbv, entry);
}
