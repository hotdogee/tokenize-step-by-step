/** `tokenizers.json` as typed constants (see `../data.ts` for why the assertion is sound). */
import type { TokenizerId } from '@tsbs/core';
import tokenizersJson from '../../data/tokenizers.json' with { type: 'json' };
import type { TokenizerEntry } from '../schema.ts';

/** The nine tokenizers in the brief's lab order (OpenAI, Anthropic, Google, Meta, xAI), withdrawn ones included. */
export const tokenizers: readonly TokenizerEntry[] = tokenizersJson as unknown as readonly TokenizerEntry[];

/** The tokenizer selected on first visit (`default: true`, registry:check guarantees exactly one). */
export const defaultTokenizerId: TokenizerId = tokenizers.find((t) => t.default === true)?.id ?? 'openai-o200k_base';

/** The entry for `id`, or undefined when it is not in the registry. */
export function tokenizerById(id: string): TokenizerEntry | undefined {
  return tokenizers.find((t) => t.id === id);
}
