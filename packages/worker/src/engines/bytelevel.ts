/**
 * The byte-level engine chunk (PA-8: Vite emits it as `assets/bytelevel-[hash].js`). The host imports this module
 * lazily, `await import('./engines/bytelevel.ts')`, on the first load of a `bytelevel-bpe` tokenizer (04 §6 rule 5).
 *
 * TODO(WP-integration): replace the body with
 *   `export { createByteLevelTokenizer } from '@tsbs/core/engines/bytelevel/index';`
 * once WP05A merges, and delete `./mock-engine.ts` with the spm stand-in.
 */
import type { Tsbv1 } from '@tsbs/core/format/types';
import type { Tokenizer } from '@tsbs/core/model/engine';
import { createMockTokenizer } from './mock-engine.ts';

/** Stand-in for WP05A's factory (same name and call shape, AD-32). */
export function createByteLevelTokenizer(tsbv: Tsbv1, entry: unknown): Tokenizer {
  if (tsbv.family !== 'bytelevel-bpe') throw new TypeError(`createByteLevelTokenizer got a ${tsbv.family} asset`);
  return createMockTokenizer(tsbv, entry);
}
