/**
 * Engine B entry point (WP05B): `createSpmTokenizer(tsbv, entry)`, the factory `tsbs-vocab build --conformance` probes on
 * `@tsbs/core` (ENGINE_FACTORIES, AD-32) and the Worker's lazy `spm` chunk re-exports (PA-8).
 */
import type { Tsbv1 } from '../../format/types.ts';
import type { Tokenizer } from '../../model/engine.ts';
import { resolveSpmConfig, type SpmEntryLike } from './config.ts';
import { createSpmEngine } from './engine.ts';

export { AlignmentError, alignSpans } from './align.ts';
export { resolveSpmConfig, type SpmEngineConfig, type SpmEngineLike, type SpmEntryLike } from './config.ts';
export { createSpmEngine, type EncodeProgress } from './engine.ts';
export { MergeRankPriority, ScorePriority, type PriorityTables } from './priority.ts';

/**
 * A SentencePiece BPE `Tokenizer` (04 §3) over a decoded TSBV1 asset and its registry entry (or any structurally
 * equivalent engine-config entry). Synchronous; throws when the entry disagrees with the asset (`resolveSpmConfig`).
 */
export function createSpmTokenizer(tsbv: Tsbv1, entry: SpmEntryLike): Tokenizer {
  return createSpmEngine(tsbv, resolveSpmConfig(tsbv, entry));
}
