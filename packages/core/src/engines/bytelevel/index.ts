/**
 * Engine A entry point (WP05A): `createByteLevelTokenizer(tsbv, entry)` builds the `Tokenizer` for a `bytelevel-bpe` asset.
 * Its export from `@tsbs/core` is what `tsbs-vocab build --conformance` probes (AD-32), and the converter's gate calls it
 * with the decoded asset and the raw registry entry; the Worker calls it with an entry of its generated engine config
 * (PA-8). Synchronous: the asset is already decoded (`readTsbv1`), the pattern compiles in ≈ 1–2 ms.
 */
import type { Tsbv1 } from '../../format/types.ts';
import type { Tokenizer } from '../../model/engine.ts';
import type { ByteLevelEntryLike } from './config.ts';
import { ByteLevelTokenizer, type ByteLevelEngineOptions } from './engine.ts';

export type { ByteLevelEntryLike } from './config.ts';
export { ByteLevelTokenizer, DEFAULT_BUDGET_MS, type ByteLevelEngineOptions, type EncodeProgress } from './engine.ts';
export { PretokenizeError } from './pretokenize.ts';

/**
 * The byte-level BPE tokenizer for `tsbv` (a `bytelevel-bpe` TSBV1 asset) configured by `entry` (03 §B.7 fields, checked
 * at run time against the asset's META). Throws a TypeError when the entry and the asset do not belong together.
 * `options` are test/parity seams (native Unicode classes, a substitute pattern, the cache bound).
 */
export function createByteLevelTokenizer(
  tsbv: Tsbv1,
  entry: ByteLevelEntryLike,
  options?: ByteLevelEngineOptions,
): Tokenizer {
  return new ByteLevelTokenizer(tsbv, entry, options);
}
