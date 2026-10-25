/**
 * Engine configuration of the SentencePiece BPE engine (04 §3.1, PA-8).
 *
 * `SpmEntryLike` mirrors the registry `TokenizerEntry` / `SpmConfig` of 03 §B.7 structurally, without zod and without
 * importing `@tsbs/registry` (core depends on nothing, 02 §2.1): a registry entry, the Worker's generated engine-config
 * entry and the raw JSON the converter's conformance gate passes all satisfy it. `resolveSpmConfig` checks the entry
 * against the asset's own `META` (the configuration facts live in both places and must agree) and against the tables
 * the chosen priority provider needs, and returns the flat configuration the engine runs on.
 */
import { PieceType } from '../../format/tsbv1.ts';
import type { Tsbv1 } from '../../format/types.ts';
import type { EncodeOptions, Family, TokenizerId } from '../../model/result.ts';

/** The `engine` block of an spm registry entry (03 §B.7 `SpmConfig`). */
export interface SpmEngineLike {
  readonly kind: 'spm-bpe';
  /** Grok-1, Gemma 2: piece scores from the `.model`; Gemma 4: HF merge ranks. */
  readonly priority: 'score' | 'merge-rank';
  /** SentencePiece: after merging; HF tokenizers: before merging. */
  readonly fallbackOrder: 'after-merge' | 'before-merge';
  readonly addDummyPrefix: boolean;
  readonly escapeWhitespace: boolean;
  /** Id of the BYTE piece `<0x00>`; byte b is `byteFirstId + b`. */
  readonly byteFirstId: number;
  readonly unkId: number;
  readonly bosId: number | null;
  readonly eosId: number;
  readonly padId: number;
  readonly userDefinedPolicy?: 'atomic';
  readonly controlPolicy?: 'as-text-unless-match';
}

/** What `createSpmTokenizer` needs from a registry `TokenizerEntry` (structurally compatible with it, PA-8). */
export interface SpmEntryLike {
  readonly id: TokenizerId;
  readonly family: Family;
  readonly vocabSize: number;
  readonly rankCount: number;
  /** A byte-level engine block type-checks (the registry's union) but is rejected at run time. */
  readonly engine: SpmEngineLike | { readonly kind: 'bytelevel-bpe' };
  readonly defaults?: Partial<EncodeOptions>;
  readonly toggles?: ReadonlyArray<'specialTokens' | 'addBos' | 'normalize'>;
}

/** The resolved configuration the engine runs on. */
export interface SpmEngineConfig {
  readonly id: TokenizerId;
  readonly vocabSize: number;
  readonly rankCount: number;
  readonly priority: 'score' | 'merge-rank';
  readonly fallbackOrder: 'after-merge' | 'before-merge';
  readonly addDummyPrefix: boolean;
  readonly escapeWhitespace: boolean;
  readonly byteFirstId: number;
  readonly bosId: number | null;
  /** Options the entry overrides on top of `DEFAULT_OPTIONS`. */
  readonly defaults: Partial<EncodeOptions>;
}

function fail(id: string, message: string): never {
  throw new Error(`createSpmTokenizer(${id}): ${message}`);
}

/** A configuration fact (META value or entry value). */
type Fact = string | number | boolean | null | undefined;

/** A declared `META` fact must equal the entry's value (absent facts are not checked). */
function agree(id: string, name: string, meta: Fact, entry: Fact): void {
  if (meta !== undefined && meta !== entry)
    fail(id, `registry ${name} = ${String(entry)} but the asset says ${String(meta)}`);
}

/**
 * Validates `entry` against `tsbv` and returns the engine configuration. Throws when the entry is not an spm entry, names
 * another tokenizer, disagrees with a `META` fact, or the tables the priority provider or the byte fallback need are
 * missing.
 */
export function resolveSpmConfig(tsbv: Tsbv1, entry: SpmEntryLike): SpmEngineConfig {
  const engine = entry.engine;
  const id = entry.id;
  if (entry.family !== 'spm-bpe' || engine.kind !== 'spm-bpe' || tsbv.family !== 'spm-bpe')
    fail(id, 'needs an spm-bpe entry and an spm-bpe asset');
  const { meta, vocab, types } = tsbv;
  if (meta.tokenizerId !== id) fail(id, `the asset is ${meta.tokenizerId}`);
  if (entry.vocabSize !== vocab.count) fail(id, `vocabSize ${String(entry.vocabSize)} ≠ ${String(vocab.count)} pieces`);
  agree(id, 'priority', meta.priority, engine.priority);
  agree(id, 'fallbackOrder', meta.fallbackOrder, engine.fallbackOrder);
  agree(id, 'addDummyPrefix', meta.addDummyPrefix, engine.addDummyPrefix);
  agree(id, 'escapeWhitespace', meta.escapeWhitespace, engine.escapeWhitespace);
  agree(id, 'byteFirstId', meta.byteFirstId, engine.byteFirstId);
  agree(id, 'bosId', meta.bosId, engine.bosId);
  if (engine.priority === 'score' ? tsbv.scores === null : tsbv.merges === null)
    fail(id, `priority ${engine.priority} needs the ${engine.priority === 'score' ? 'PRIO/SCRF' : 'MRGS'} section`);
  if (types === null) fail(id, 'the asset has no TYPS section');
  for (let b = 0; b < 256; b++) {
    if (types[engine.byteFirstId + b] !== PieceType.Byte)
      fail(id, `piece ${String(engine.byteFirstId + b)} (byte ${String(b)}) is not a BYTE piece`);
  }
  return {
    id,
    vocabSize: entry.vocabSize,
    rankCount: entry.rankCount,
    priority: engine.priority,
    fallbackOrder: engine.fallbackOrder,
    addDummyPrefix: engine.addDummyPrefix,
    escapeWhitespace: engine.escapeWhitespace,
    byteFirstId: engine.byteFirstId,
    bosId: engine.bosId,
    defaults: entry.defaults ?? {},
  };
}
