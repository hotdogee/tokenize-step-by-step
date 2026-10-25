/**
 * Engine A configuration (PA-8): the structural shape of the registry entry `createByteLevelTokenizer` takes, its run-time
 * validation against the TSBV1 asset, and the resolution of `EncodeOptions`.
 *
 * `@tsbs/core` may not import `@tsbs/registry` (02 §2.1), so `ByteLevelEntryLike` mirrors the fields of 03 §B.7
 * `TokenizerEntry` / `ByteLevelConfig` that the engine reads, with string-typed literals: a typed registry
 * `TokenizerEntry`, an entry of the Worker's generated `engine-config.json` (JSON imports widen literals to `string`) and
 * the raw JSON object the converter's conformance gate passes all satisfy it. {@link parseByteLevelEntry} then checks
 * the values at run time (no zod in the engine, AD-28) and cross-checks them with the asset's `META`.
 */
import { DEFAULT_OPTIONS, type EncodeOptions, type TokenizerId } from '../../model/result.ts';
import type { Tsbv1 } from '../../format/types.ts';
import { PATTERN_KEYS, type PatternKey } from '../../unicode/patterns.ts';

/** The fields of a 03 §B.7 `TokenizerEntry` that Engine A reads (structural; see the module comment). */
export interface ByteLevelEntryLike {
  readonly id: string;
  readonly family: string;
  readonly vocabSize: number;
  readonly rankCount: number;
  /** 03 §B.7 `ByteLevelConfig`: `kind: 'bytelevel-bpe'`, `pattern` (a `PatternKey`), `idOffset`, `bosId`. */
  readonly engine: {
    readonly kind: string;
    readonly pattern?: string;
    readonly idOffset?: number;
    readonly bosId?: number | null;
  };
  /** `Partial<EncodeOptions>` defaults of the tokenizer (merged under the caller's options). */
  readonly defaults?: {
    readonly specialTokens?: string;
    readonly addBos?: boolean;
    readonly normalize?: string;
  };
  /** Which toggles the UI shows (`'specialTokens' | 'addBos' | 'normalize'`). */
  readonly toggles?: readonly string[];
}

/** A validated entry: everything the engine needs, typed. */
export interface ByteLevelConfig {
  readonly id: TokenizerId;
  readonly vocabSize: number;
  readonly rankCount: number;
  readonly pattern: PatternKey;
  /** Rank r ↦ token id r + idOffset (0 OpenAI/Meta, 128 Grok-2, 5 Claude). */
  readonly idOffset: number;
  readonly bosId: number | null;
  /** Longest PCES entry in bytes, from `META` (never from the registry): the merge-window bound (04 §2.1). */
  readonly maxPieceBytes: number;
  readonly defaults: Partial<EncodeOptions>;
  readonly toggles: ReadonlySet<string>;
}

const isCount = (value: unknown): value is number => Number.isSafeInteger(value) && (value as number) >= 0;

/** Validates `entry` against the asset and returns the typed configuration; throws a TypeError naming the bad field. */
export function parseByteLevelEntry(tsbv: Tsbv1, entry: ByteLevelEntryLike): ByteLevelConfig {
  const fail = (reason: string): TypeError => new TypeError(`createByteLevelTokenizer(${entry.id}): ${reason}`);
  const { meta } = tsbv;
  if (tsbv.family !== 'bytelevel-bpe' || meta.family !== 'bytelevel-bpe') throw fail(`asset family is ${tsbv.family}`);
  if (entry.family !== 'bytelevel-bpe') throw fail(`entry family is ${entry.family}`);
  if (entry.id !== meta.tokenizerId) throw fail(`the asset was built for ${meta.tokenizerId}`);
  const { engine } = entry;
  if (engine.kind !== 'bytelevel-bpe') throw fail(`engine.kind is ${engine.kind}`);
  const pattern = PATTERN_KEYS.find((key) => key === engine.pattern);
  if (pattern === undefined) throw fail(`unknown engine.pattern ${String(engine.pattern)}`);
  const idOffset = engine.idOffset;
  if (!isCount(idOffset)) throw fail('engine.idOffset must be a non-negative integer');
  if (meta.idOffset !== undefined && meta.idOffset !== idOffset)
    throw fail(`engine.idOffset ${String(idOffset)} disagrees with META.idOffset ${String(meta.idOffset)}`);
  const bosId = engine.bosId ?? null;
  if (bosId !== null && !isCount(bosId)) throw fail('engine.bosId must be null or a non-negative integer');
  if (meta.bosId !== undefined && meta.bosId !== bosId)
    throw fail(`engine.bosId ${String(bosId)} disagrees with META.bosId ${String(meta.bosId)}`);
  if (!isCount(entry.rankCount) || entry.rankCount !== tsbv.vocab.count)
    throw fail(`rankCount ${String(entry.rankCount)} but the asset holds ${String(tsbv.vocab.count)} ranks`);
  if (!isCount(entry.vocabSize) || entry.vocabSize < idOffset + entry.rankCount)
    throw fail(`vocabSize ${String(entry.vocabSize)} cannot hold ${String(idOffset + entry.rankCount)} ranked ids`);
  if (!(isCount(meta.maxPieceBytes) && meta.maxPieceBytes > 0)) throw fail('META.maxPieceBytes is missing');
  return {
    id: meta.tokenizerId,
    vocabSize: entry.vocabSize,
    rankCount: entry.rankCount,
    pattern,
    idOffset,
    bosId,
    maxPieceBytes: meta.maxPieceBytes,
    defaults: parseDefaults(entry.defaults ?? {}, fail),
    toggles: new Set(entry.toggles ?? []),
  };
}

/** Validates the entry's `defaults` (only the keys a registry entry may carry). */
function parseDefaults(
  defaults: NonNullable<ByteLevelEntryLike['defaults']>,
  fail: (reason: string) => TypeError,
): Partial<EncodeOptions> {
  const out: { -readonly [K in keyof EncodeOptions]?: EncodeOptions[K] } = {};
  const { specialTokens, addBos, normalize } = defaults;
  if (specialTokens !== undefined) {
    if (specialTokens !== 'as-text' && specialTokens !== 'match') throw fail('defaults.specialTokens is invalid');
    out.specialTokens = specialTokens;
  }
  if (addBos !== undefined) {
    if (typeof addBos !== 'boolean') throw fail('defaults.addBos is invalid');
    out.addBos = addBos;
  }
  if (normalize !== undefined) {
    if (normalize !== 'none' && normalize !== 'NFKC') throw fail('defaults.normalize is invalid');
    out.normalize = normalize;
  }
  return out;
}

/**
 * `DEFAULT_OPTIONS` ← entry defaults ← the caller's options, key by key (an `undefined` value from a JavaScript caller
 * falls through to the next layer). Throws a TypeError for a value outside `EncodeOptions`.
 */
export function resolveOptions(defaults: Partial<EncodeOptions>, options: Partial<EncodeOptions> = {}): EncodeOptions {
  const resolved: EncodeOptions = {
    specialTokens: options.specialTokens ?? defaults.specialTokens ?? DEFAULT_OPTIONS.specialTokens,
    addBos: options.addBos ?? defaults.addBos ?? DEFAULT_OPTIONS.addBos,
    normalize: options.normalize ?? defaults.normalize ?? DEFAULT_OPTIONS.normalize,
    trace: options.trace ?? defaults.trace ?? DEFAULT_OPTIONS.trace,
  };
  const { specialTokens, addBos, normalize, trace } = resolved as Record<keyof EncodeOptions, unknown>;
  if (specialTokens !== 'as-text' && specialTokens !== 'match')
    throw new TypeError('specialTokens must be as-text | match');
  if (typeof addBos !== 'boolean') throw new TypeError('addBos must be a boolean');
  if (normalize !== 'none' && normalize !== 'NFKC') throw new TypeError('normalize must be none | NFKC');
  if (typeof trace !== 'boolean' && (typeof trace !== 'object' || trace === null))
    throw new TypeError('trace must be a boolean or { maxSteps }');
  return resolved;
}
