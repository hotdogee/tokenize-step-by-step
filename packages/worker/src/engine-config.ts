/**
 * The engine configuration the Worker hands to an engine factory (PA-8). `@tsbs/worker` may import neither `apps/web`
 * nor `@tsbs/registry` (02 §2.1) and the FROZEN `load` message carries only the tokenizer id, so the registry fields an
 * engine needs are generated into `src/generated/engine-config.json` by `apps/web/plugins/{vocab-assets,generate}.ts`
 * and imported by `entry.ts` alone. The types below mirror the registry's `TokenizerEntry` / `ByteLevelConfig` /
 * `SpmConfig` (03 §B.7) structurally, without zod, so a registry entry and a generated entry both satisfy them.
 */
import type { EncodeOptions, Family, TokenizerId } from '@tsbs/core/model/result';
import type { Tokenizer } from '@tsbs/core/model/engine';
import type { Tsbv1 } from '@tsbs/core/format/types';

/** Engine A settings (03 §B.7 `ByteLevelConfig`). */
export interface ByteLevelEngineConfig {
  readonly kind: 'bytelevel-bpe';
  readonly pattern: 'o200k' | 'cl100k' | 'llama3' | 'grok2-v1' | 'claude-legacy';
  readonly idOffset: number;
  readonly maxTokenBytes: number;
  readonly bosId: number | null;
}

/** Engine B settings (03 §B.7 `SpmConfig`). */
export interface SpmEngineConfig {
  readonly kind: 'spm-bpe';
  readonly priority: 'score' | 'merge-rank';
  readonly fallbackOrder: 'after-merge' | 'before-merge';
  readonly addDummyPrefix: boolean;
  readonly escapeWhitespace: true;
  readonly byteFirstId: number;
  readonly unkId: number;
  readonly bosId: number;
  readonly eosId: number;
  readonly padId: number;
  readonly userDefinedPolicy: 'atomic';
  readonly controlPolicy: 'as-text-unless-match';
}

/** One tokenizer's entry: the `TokenizerEntry` fields an engine factory reads (PA-8). */
export interface EngineConfigEntry {
  readonly id: TokenizerId;
  readonly family: Family;
  readonly vocabSize: number;
  readonly rankCount: number;
  readonly engine: ByteLevelEngineConfig | SpmEngineConfig;
  readonly defaults: Partial<EncodeOptions>;
  readonly toggles: ReadonlyArray<'specialTokens' | 'addBos' | 'normalize'>;
}

/** `engine-config.json`: entries by tokenizer id (withdrawn or unknown ids may be absent). */
export type EngineConfig = Readonly<Partial<Record<TokenizerId, EngineConfigEntry>>>;

/**
 * An engine factory as the host calls it: `createByteLevelTokenizer` / `createSpmTokenizer` (the names fixed by
 * `ENGINE_FACTORIES`, AD-32) with the decoded container and the tokenizer's engine-config entry. A factory may be
 * synchronous or asynchronous (the converter's conformance gate awaits it too).
 */
export type EngineFactory = (tsbv: Tsbv1, entry: EngineConfigEntry) => Tokenizer | Promise<Tokenizer>;

/** Any factory whose entry parameter is narrower than `EngineConfigEntry` (each engine types its own, PA-8). */
type AnyEngineFactory = (tsbv: Tsbv1, entry: never) => Tokenizer | Promise<Tokenizer>;

/**
 * Adapts an engine module's factory to {@link EngineFactory}. Each engine declares the entry type it reads in its own
 * folder (`engines/<family>/config.ts`), so its parameter type is not this package's; the runtime value it receives is
 * always the generated entry of the same tokenizer, which carries every field 03 §B.7 defines.
 */
export function asEngineFactory(factory: AnyEngineFactory): EngineFactory {
  return factory as EngineFactory;
}
