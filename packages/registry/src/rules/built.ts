/**
 * Agreement with the built assets when `data/vocab/dist` exists (03 §B.7, 04 §2.1, 04 §3.1): the engines read
 * `META.maxPieceBytes` and the id facts from the `.bin`, the registry repeats them for the picker/About and as engine
 * config, so the two must agree. Assets the converter has not built yet are not an error (the WP00 stub builds none).
 */
import type { TokenizerEntry } from '../schema.ts';
import type { Report } from './report.ts';
import { at } from './tokenizers.ts';

/** One built asset: its decoded META section, or why it could not be read. */
export type BuiltAsset = { readonly meta: Readonly<Record<string, unknown>> } | { readonly error: string };

/** Engine-config keys that may also appear in META and must then agree (03 §C.1). */
const SHARED_KEYS = [
  'idOffset',
  'byteFirstId',
  'bosId',
  'eosId',
  'unkId',
  'padId',
  'addDummyPrefix',
  'escapeWhitespace',
  'priority',
  'fallbackOrder',
] as const;

/** `value[key]` when `value` is a non-null object, else undefined (META is untrusted JSON). */
function nested(value: unknown, key: string): unknown {
  return typeof value === 'object' && value !== null
    ? new Map<string, unknown>(Object.entries(value)).get(key)
    : undefined;
}

/** Compares one entry with its built META. */
function checkMeta(entry: TokenizerEntry, meta: Readonly<Record<string, unknown>>, report: Report): void {
  if (meta['tokenizerId'] !== entry.id) {
    report('built-asset', at(entry), `META.tokenizerId is ${String(meta['tokenizerId'])}`);
  }
  if (nested(meta['upstream'], 'sha256') !== entry.asset.sourceSha256) {
    report('built-asset', at(entry), 'META.upstream.sha256 differs from asset.sourceSha256');
  }
  const pieces = nested(meta['counts'], 'pieces');
  if (pieces !== entry.rankCount) {
    report('built-asset', at(entry), `rankCount ${String(entry.rankCount)} !== META.counts.pieces ${String(pieces)}`);
  }
  if (entry.engine.kind === 'bytelevel-bpe' && meta['maxPieceBytes'] !== entry.engine.maxTokenBytes) {
    report(
      'built-asset',
      at(entry),
      `maxTokenBytes ${String(entry.engine.maxTokenBytes)} !== META.maxPieceBytes ${String(meta['maxPieceBytes'])}`,
    );
  }
  const engine = new Map<string, unknown>(Object.entries(entry.engine));
  for (const key of SHARED_KEYS) {
    if (!(key in meta) || !engine.has(key)) continue;
    if (meta[key] !== engine.get(key)) {
      report('built-asset', at(entry), `engine.${key} ${String(engine.get(key))} !== META.${key} ${String(meta[key])}`);
    }
  }
}

/** All built-asset rules; `built` is null when `data/vocab/dist` does not exist. */
export function checkBuilt(
  tokenizers: readonly TokenizerEntry[],
  built: ReadonlyMap<string, BuiltAsset> | null,
  report: Report,
): void {
  if (built === null) return;
  for (const [id, asset] of built) {
    const entry = tokenizers.find((t) => t.id === id);
    if (entry === undefined) {
      report('built-asset', `built[${id}]`, 'the vocab manifest lists an asset with no tokenizer entry');
      continue;
    }
    if (entry.withdrawn === true) report('built-asset', at(entry), 'a withdrawn tokenizer must not be built');
    if ('error' in asset) report('built-asset', at(entry), `cannot read the built asset: ${asset.error}`);
    else checkMeta(entry, asset.meta, report);
  }
}
