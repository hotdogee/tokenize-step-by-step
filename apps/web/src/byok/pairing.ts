/**
 * Which tokenizer each live-check panel is paired with (05 §13): the registry entry whose `byok` names the panel —
 * `anthropic-count` → the legacy Claude vocabulary (its count is the "vs legacy-vocabulary count"), `xai-tokenize` →
 * Grok-2 (the live token tier lines up under its tokens). Data-driven from `tokenizers.json`, never hard-coded ids.
 */
import type { TokenizerEntry } from '@tsbs/registry';
import { TOKENIZERS } from '../app/registry.ts';

/** A live-check panel (the registry's `byok` values). */
export type ByokPanel = NonNullable<TokenizerEntry['byok']>;

/** The registry entry paired with `panel` (registry:check pairs each panel with exactly one tokenizer of its lab). */
export function pairedEntry(panel: ByokPanel): TokenizerEntry {
  const entry = TOKENIZERS.find((candidate) => candidate.byok === panel);
  if (entry === undefined) throw new Error(`no tokenizer is paired with the ${panel} panel`);
  return entry;
}
