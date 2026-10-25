/**
 * The registry data as typed constants (browser-safe: plain JSON, no zod — AD-28).
 *
 * JSON imports are typed structurally by TypeScript (strings widen to `string`), so each file is asserted to its FROZEN
 * type here. That assertion is sound because `pnpm registry:check` validates every file against the zod schemas and the
 * cross-file rules in CI (03 §B.7) — the schemas are the runtime proof, this module is only the typed view of it.
 */
import byokJson from '../data/byok.json' with { type: 'json' };
import examplesJson from '../data/examples.json' with { type: 'json' };
import licencesJson from '../data/licences.json' with { type: 'json' };
import modelsJson from '../data/models.json' with { type: 'json' };
import stringsJson from '../data/strings.json' with { type: 'json' };
import tokenizersJson from '../data/tokenizers.json' with { type: 'json' };
import type { LicencesFile, RegistryStrings } from './data-schema.ts';
import type { ByokConfig, ExampleChip, ModelRow, TokenizerEntry } from './schema.ts';
import type { TokenizerId } from '@tsbs/core';

/** The nine tokenizers in the brief's lab order (OpenAI, Anthropic, Google, Meta, xAI), withdrawn ones included. */
export const tokenizers: readonly TokenizerEntry[] = tokenizersJson as unknown as readonly TokenizerEntry[];

/** Model → tokenizer mapping rows with fidelity, status and dated evidence (PD-6). */
export const models: readonly ModelRow[] = modelsJson as unknown as readonly ModelRow[];

/** Licence display strings, required notices and the MODIFIED template. */
export const licences: LicencesFile = licencesJson as unknown as LicencesFile;

/** The 19 example chips (05 §6); the first one is the default example. */
export const examples: readonly ExampleChip[] = examplesJson as unknown as readonly ExampleChip[];

/** BYOK endpoints, headers and model lists (AD-24). */
export const byok: ByokConfig = byokJson as unknown as ByokConfig;

/** Marker screen-reader text and BYOK messages in three locales. */
export const strings: RegistryStrings = stringsJson as unknown as RegistryStrings;

/** The tokenizer selected on first visit (`default: true`, registry:check guarantees exactly one). */
export const defaultTokenizerId: TokenizerId = tokenizers.find((t) => t.default === true)?.id ?? 'openai-o200k_base';

/** The entry for `id`, or undefined when it is not in the registry. */
export function tokenizerById(id: string): TokenizerEntry | undefined {
  return tokenizers.find((t) => t.id === id);
}
