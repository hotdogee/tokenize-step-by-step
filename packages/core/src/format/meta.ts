/**
 * Validation of the `META` section (03 §C.1): UTF-8 JSON ≤ 4 KiB that makes a `.bin` self-describing. Unknown keys are
 * tolerated (forward compatibility); known keys must have the documented types, `unicodeVersion` must be `16.0.0` and
 * `unusedCount` must be 0 (SentencePiece UNUSED pieces are unsupported, 04 §3.2).
 */
import type { Family, TokenizerId } from '../model/result.ts';
import type { TsbvMeta } from './types.ts';
import { FormatError } from './format-error.ts';
import { createStrictUtf8Decoder, decodeUtf8OrNull } from './utf8.ts';

/** Largest `META` payload (03 §C.1). */
export const META_MAX_BYTES = 4096;

const TOKENIZER_IDS = [
  'openai-o200k_base',
  'openai-cl100k_base',
  'anthropic-claude-legacy',
  'google-gemma4',
  'google-gemma2',
  'meta-llama4-muse',
  'meta-llama3',
  'xai-grok2',
  'xai-grok1',
] as const satisfies readonly TokenizerId[];
/** Compile-time guard: the list above names every `TokenizerId`. */
const _allTokenizerIds: [Exclude<TokenizerId, (typeof TOKENIZER_IDS)[number]>] extends [never] ? true : never = true;

const FAMILIES: readonly Family[] = ['bytelevel-bpe', 'spm-bpe'];
const UPSTREAM_KEYS = ['assetId', 'file', 'sha256', 'url', 'revision', 'retrievedOn'] as const;
const OPTIONAL_INTEGERS = ['idOffset', 'byteFirstId', 'bosId', 'eosId', 'unkId', 'padId'] as const;
const OPTIONAL_BOOLEANS = [
  'addDummyPrefix',
  'escapeWhitespace',
  'normalScoresMonotone',
  'hfMergesRegenerable',
] as const;

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);
const isCount = (value: unknown): value is number => Number.isSafeInteger(value) && (value as number) >= 0;

/** Checks the decoded JSON value against {@link TsbvMeta}; `fail(reason)` builds the error to throw. */
function assertMeta(value: unknown, fail: (reason: string) => FormatError): asserts value is TsbvMeta {
  if (!isRecord(value)) throw fail('META is not a JSON object');
  const field = (key: string) => value[key];
  if (!(TOKENIZER_IDS as readonly unknown[]).includes(field('tokenizerId'))) throw fail('unknown tokenizerId');
  if (!(FAMILIES as readonly unknown[]).includes(field('family'))) throw fail('unknown family');
  const upstream = field('upstream');
  if (!isRecord(upstream) || UPSTREAM_KEYS.some((key) => typeof upstream[key] !== 'string')) {
    throw fail(`upstream must carry the strings ${UPSTREAM_KEYS.join(', ')}`);
  }
  const counts = field('counts');
  if (!isRecord(counts) || !isCount(counts['pieces']) || !isCount(counts['specials'])) {
    throw fail('counts.pieces and counts.specials must be non-negative integers');
  }
  if (counts['merges'] !== undefined && !isCount(counts['merges'])) throw fail('counts.merges must be an integer');
  if (!isCount(field('maxPieceBytes'))) throw fail('maxPieceBytes must be a non-negative integer');
  if (field('unusedCount') !== 0) throw fail(`unusedCount must be 0, got ${JSON.stringify(field('unusedCount'))}`);
  for (const key of OPTIONAL_INTEGERS) {
    if (field(key) !== undefined && !isCount(field(key))) throw fail(`${key} must be a non-negative integer`);
  }
  for (const key of OPTIONAL_BOOLEANS) {
    if (field(key) !== undefined && typeof field(key) !== 'boolean') throw fail(`${key} must be a boolean`);
  }
  const priority = field('priority');
  if (priority !== undefined && priority !== 'score' && priority !== 'merge-rank') throw fail('unknown priority');
  const order = field('fallbackOrder');
  if (order !== undefined && order !== 'after-merge' && order !== 'before-merge') throw fail('unknown fallbackOrder');
  if (typeof field('modificationNotice') !== 'string') throw fail('modificationNotice must be a string');
  if (field('unicodeVersion') !== '16.0.0') throw fail('unicodeVersion must be "16.0.0"');
  if (typeof field('generator') !== 'string') throw fail('generator must be a string');
}

/** Decodes and validates a `META` payload; `base` is its offset in the container (for errors). */
export function parseMeta(payload: Uint8Array, base: number): TsbvMeta {
  const fail = (reason: string) => new FormatError('META', base, reason);
  if (payload.length > META_MAX_BYTES) throw fail(`${String(payload.length)} bytes exceeds ${String(META_MAX_BYTES)}`);
  const text = decodeUtf8OrNull(createStrictUtf8Decoder(), payload);
  if (text === null) throw fail('not valid UTF-8');
  let value: unknown;
  try {
    value = JSON.parse(text);
  } catch {
    throw fail('not valid JSON');
  }
  assertMeta(value, fail);
  return value;
}
