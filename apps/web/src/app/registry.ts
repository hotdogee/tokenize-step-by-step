/**
 * The shell's view of the registry: WP04's `@tsbs/registry` data (plain JSON validated by `pnpm registry:check`, AD-14)
 * plus, per tokenizer, the chips whose precomputed result splits a character (`examples-index.json`, written by WP03's
 * `examples()` plugin and `pnpm generate`, 03 §C.7).
 */
import type { TokenizerId } from '@tsbs/core';
import {
  defaultTokenizerId,
  examples,
  licences,
  models,
  tokenizers,
  type ExampleChip,
  type Locale,
  type ModelRow,
  type NoticeEntry,
  type NoticeKey,
  type TokenizerEntry,
} from '@tsbs/registry';
import examplesIndex from '../generated/examples-index.json';

/** The nine tokenizers in the brief's lab order (the picker hides `withdrawn` ones itself). */
export const TOKENIZERS: readonly TokenizerEntry[] = tokenizers;

/** Model → tokenizer rows with fidelity and dated evidence (PD-6). */
export const MODELS: readonly ModelRow[] = models;

/** The 19 example chips (05 §6); the first one is the default example. */
export const EXAMPLES: readonly ExampleChip[] = examples;

/** The selected tokenizer on first visit (exactly one `default: true`). */
export const DEFAULT_TOKENIZER: TokenizerId = defaultTokenizerId;

/** The subset of `examples-index.json` (03 §C.7) the shell reads. */
interface ExamplesIndexView {
  readonly default: { readonly tokenizer: TokenizerId; readonly case: string };
  readonly files: Readonly<Partial<Record<TokenizerId, string>>>;
  readonly partial: Readonly<Partial<Record<TokenizerId, readonly string[]>>>;
}

/** `examples-index.json`: lazy examples file per tokenizer and the chips that yield a partial-character token. */
export const EXAMPLES_INDEX: ExamplesIndexView = examplesIndex as unknown as ExamplesIndexView;

const chipKeyByCase = new Map(EXAMPLES.map((chip) => [chip.fixtureCase, chip.key]));

/** Chip keys whose precomputed result has a partial-character token, per tokenizer (the chip's hatch mark, 05 §6). */
export const CHIP_SPLITS: Readonly<Record<TokenizerId, readonly string[]>> = (() => {
  const splits: Partial<Record<TokenizerId, readonly string[]>> = {};
  for (const entry of TOKENIZERS)
    splits[entry.id] = (EXAMPLES_INDEX.partial[entry.id] ?? []).flatMap((name) => chipKeyByCase.get(name) ?? []);
  return splits as Record<TokenizerId, readonly string[]>;
})();

/** Short licence tag per `licence` key, for the picker (licences.json display strings). */
export const LICENCE_TAGS: Readonly<Record<string, string>> = Object.fromEntries(
  Object.entries(licences.licences).map(([key, display]) => [key, display.tag]),
);

/** The entry of `id` (every TokenizerId has one; registry:check). */
export function tokenizerEntry(id: TokenizerId): TokenizerEntry {
  const entry = TOKENIZERS.find((candidate) => candidate.id === id);
  if (entry === undefined) throw new Error(`no registry entry for ${id}`);
  return entry;
}

/** The licences.json entry of a notice (registry:check guarantees one per NoticeKey, in all three locales). */
export function notice(key: NoticeKey): NoticeEntry {
  const entry = licences.notices[key];
  if (entry === undefined) throw new Error(`licences.json has no notice ${key}`);
  return entry;
}

/**
 * The line a notice shows: a legal notice's exact `verbatim` string (never translated; render it with `lang="en"`), an
 * explanatory notice's `body` in the UI locale (05 §15).
 */
export function noticeText(entry: NoticeEntry, locale: Locale): string {
  return entry.kind === 'legal' && entry.verbatim !== undefined ? entry.verbatim : entry.body[locale];
}
