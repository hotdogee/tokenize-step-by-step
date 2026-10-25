// FROZEN v1 — see docs/design/03-data-model-and-assets.md §B.7. The types below are the design text verbatim (only the
// imports are added); the zod schemas after them validate the JSON in packages/registry/data/ and are checked against the
// types with `satisfies` (and the reverse direction in test/schema.test.ts), so schema and type cannot drift. Type changes
// need an ADR in docs/adr/ and one PR that updates every dependent (docs/design/07-implementation-plan.md §1); WP04 owns
// the schemas' cross-file rules (check.ts). zod is build/test only (AD-28): browser code imports types from '@tsbs/registry'.
// Excluded from Prettier on purpose (verbatim layout).
import { z } from 'zod';
import type { EncodeOptions, Family, TextLangChoice, TokenizerId } from '@tsbs/core';

// packages/registry/src/schema.ts — FROZEN v1 (zod schemas derive these types; JSON is imported as-is at runtime)
export type Locale = 'en' | 'zh-TW' | 'ja';
export type L10n = Readonly<Record<Locale, string>>;
export type Fidelity = 'confirmed' | 'inferred' | 'legacy' | 'reconstruction';
export type Lab = 'openai' | 'anthropic' | 'google' | 'meta' | 'xai';
export type NoticeKey = 'powered-by-xai' | 'xai-materials-notice' | 'built-with-meta-llama-3' | 'llama3-notice' | 'gemma-terms'
  | 'gemma-notice' | 'claude-legacy-disclaimer' | 'tiktoken-rank-file-basis' | 'modified-asset';
export type { TextLangChoice, ResolvedTextLang } from '@tsbs/core';   // defined once in core/model/view-types.ts (B.2); registry depends on core for types only

export interface TokenizerEntry {
  id: TokenizerId; lab: Lab; family: Family; tier: 'primary' | 'secondary'; default?: true;   // exactly one default: openai-o200k_base
  displayName: L10n;                                   // "o200k_base (GPT-4o → GPT-5.x)"
  vocabSize: number; rankCount: number;                // 200019 / 199998
  asset: { manifestId: string; sourceFile: string; sourceSha256: string };   // oracle manifest asset id + file; resolved to a path via vocab-manifest
  engine: ByteLevelConfig | SpmConfig;
  defaults: Partial<EncodeOptions>;
  toggles: ReadonlyArray<'specialTokens' | 'addBos' | 'normalize'>;   // which toggles the UI shows
  fidelity: Fidelity; fidelityNote: L10n;              // badge + sentence for the tokenizer itself (e.g. "Claude 1/2-era vocabulary — not the Claude 3+ tokenizer")
  licence: string;                                     // key into licences.json / licences.generated.json
  requiredNotices: NoticeKey[];                        // rendered persistently while selected (05 §15)
  fixture: string;                                     // "fixtures/openai-o200k_base.json"
  byok?: 'anthropic-count' | 'xai-tokenize';
  withdrawn?: true;                                    // hides from the picker; converter skips the asset (xAI revocability)
}
export interface ByteLevelConfig {
  kind: 'bytelevel-bpe';
  pattern: 'o200k' | 'cl100k' | 'llama3' | 'grok2-v1' | 'claude-legacy';   // key into core/engines/bytelevel/patterns.ts
  idOffset: number;                                    // rank r ↦ id r + idOffset (0 OpenAI/Meta, 128 Grok-2, 5 Claude)
  maxTokenBytes: number;                               // informational (picker/About); the ENGINE reads META.maxPieceBytes from the asset (04 §2.1) and registry:check asserts equality
  bosId: number | null;                                // Llama 3 128000, Llama 4/Muse 200000; null for OpenAI/Grok-2/Claude
}
export interface SpmConfig {
  kind: 'spm-bpe';
  priority: 'score' | 'merge-rank';                    // Grok-1, Gemma 2: score (.model); Gemma 4: merge-rank (HF merges)
  fallbackOrder: 'after-merge' | 'before-merge';       // SentencePiece: after; HF: before
  addDummyPrefix: boolean;                             // Grok-1 true; Gemma false
  escapeWhitespace: true;
  byteFirstId: number;                                 // 238 Gemma 4, 217 Gemma 2, 69 Grok-1 (also in META; must agree)
  unkId: number; bosId: number; eosId: number; padId: number;
  userDefinedPolicy: 'atomic';                         // USER_DEFINED always frozen (fixture policy user-defined-atomic)
  controlPolicy: 'as-text-unless-match';               // CONTROL/special strings are text unless specialTokens:'match'
}
export interface ModelRow {
  model: string; lab: Lab;
  tokenizer: TokenizerId | null;                       // null = no public tokenizer (Claude 3 → 5.5 / Fable / Mythos); such rows MUST carry `byok`
  byok?: 'anthropic-count' | 'xai-tokenize';           // the live-check panel the row points to
  fidelity: Fidelity | 'unavailable';                  // 'unavailable' iff tokenizer === null
  status: 'current' | 'previous' | 'historical';
  evidenceUrl: string; checkedOn: string;              // ISO date; registry:check fails if an inferred row lacks either
  note: L10n;
}
export interface ExampleChip {
  key: string;
  fixtureCase: string;                                 // a case name present in EVERY shipping fixture
  text: string;                                        // MUST equal the fixture case's text byte-for-byte (registry:check: chip.text === case.text)
  label?: L10n;                                        // display label when the text is long (paragraph chips); default = text
  lang: TextLangChoice;                                // what the chip sets the text-language chip to ('auto' for mixed-script cases)
  why: L10n;
}
export interface ByokConfig {
  checkedOn: string;
  anthropic: { endpoint: 'https://api.anthropic.com/v1/messages/count_tokens'; version: string;   // "2026-10-21"
    authSchemes: ReadonlyArray<'bearer' | 'x-api-key'>; defaultAuth: 'bearer'; browserAccessHeader: 'anthropic-dangerous-direct-browser-access';
    workspaceHeader: 'anthropic-workspace-id'; models: ReadonlyArray<{ id: string; label: string; frameTokens: number; generation: 'v3' | 'v4.7' | 'v4.8' | 'v5.5' }>; };
  xai: { endpoint: 'https://api.x.ai/v1/tokenize-text'; defaultModel: string; models: ReadonlyArray<{ id: string; label: string }>; };
}

// ---- zod schemas (added; validated against the types above) ----

const nonEmpty = z.string().min(1);
const isoDate = z.iso.date();
const count = z.number().int().nonnegative();
const tokenId = z.number().int().nonnegative();

export const TokenizerIdSchema = z.enum([
  'openai-o200k_base', 'openai-cl100k_base', 'anthropic-claude-legacy', 'google-gemma4', 'google-gemma2',
  'meta-llama4-muse', 'meta-llama3', 'xai-grok2', 'xai-grok1',
]) satisfies z.ZodType<TokenizerId>;
export const FamilySchema = z.enum(['bytelevel-bpe', 'spm-bpe']) satisfies z.ZodType<Family>;
export const LocaleSchema = z.enum(['en', 'zh-TW', 'ja']) satisfies z.ZodType<Locale>;
export const L10nSchema = z.strictObject({ en: nonEmpty, 'zh-TW': nonEmpty, ja: nonEmpty }) satisfies z.ZodType<L10n>;
export const FidelitySchema = z.enum(['confirmed', 'inferred', 'legacy', 'reconstruction']) satisfies z.ZodType<Fidelity>;
export const LabSchema = z.enum(['openai', 'anthropic', 'google', 'meta', 'xai']) satisfies z.ZodType<Lab>;
export const NoticeKeySchema = z.enum([
  'powered-by-xai', 'xai-materials-notice', 'built-with-meta-llama-3', 'llama3-notice', 'gemma-terms',
  'gemma-notice', 'claude-legacy-disclaimer', 'tiktoken-rank-file-basis', 'modified-asset',
]) satisfies z.ZodType<NoticeKey>;
export const TextLangChoiceSchema = z.enum(['auto', 'zh-Hant', 'ja', 'en']) satisfies z.ZodType<TextLangChoice>;
const ByokPanelSchema = z.enum(['anthropic-count', 'xai-tokenize']);

/** `Partial<EncodeOptions>`: every key optional but never `undefined` (exactOptionalPropertyTypes). */
export const EncodeOptionsPartialSchema = z.strictObject({
  specialTokens: z.enum(['as-text', 'match']).exactOptional(),
  addBos: z.boolean().exactOptional(),
  normalize: z.enum(['none', 'NFKC']).exactOptional(),
  trace: z.union([z.boolean(), z.strictObject({ maxSteps: z.number().int().positive() })]).exactOptional(),
}) satisfies z.ZodType<Partial<EncodeOptions>>;

export const ByteLevelConfigSchema = z.strictObject({
  kind: z.literal('bytelevel-bpe'),
  pattern: z.enum(['o200k', 'cl100k', 'llama3', 'grok2-v1', 'claude-legacy']),
  idOffset: count,
  maxTokenBytes: z.number().int().positive(),
  bosId: tokenId.nullable(),
}) satisfies z.ZodType<ByteLevelConfig>;

export const SpmConfigSchema = z.strictObject({
  kind: z.literal('spm-bpe'),
  priority: z.enum(['score', 'merge-rank']),
  fallbackOrder: z.enum(['after-merge', 'before-merge']),
  addDummyPrefix: z.boolean(),
  escapeWhitespace: z.literal(true),
  byteFirstId: tokenId,
  unkId: z.number().int(), bosId: z.number().int(), eosId: z.number().int(), padId: z.number().int(),
  userDefinedPolicy: z.literal('atomic'),
  controlPolicy: z.literal('as-text-unless-match'),
}) satisfies z.ZodType<SpmConfig>;

export const TokenizerEntrySchema = z.strictObject({
  id: TokenizerIdSchema, lab: LabSchema, family: FamilySchema, tier: z.enum(['primary', 'secondary']), default: z.literal(true).exactOptional(),
  displayName: L10nSchema,
  vocabSize: z.number().int().positive(), rankCount: z.number().int().positive(),
  asset: z.strictObject({ manifestId: nonEmpty, sourceFile: nonEmpty, sourceSha256: z.string().regex(/^[0-9a-f]{64}$/) }),
  engine: z.discriminatedUnion('kind', [ByteLevelConfigSchema, SpmConfigSchema]),
  defaults: EncodeOptionsPartialSchema,
  toggles: z.array(z.enum(['specialTokens', 'addBos', 'normalize'])).readonly(),
  fidelity: FidelitySchema, fidelityNote: L10nSchema,
  licence: nonEmpty,
  requiredNotices: z.array(NoticeKeySchema),
  fixture: z.string().regex(/^fixtures\/[a-z0-9._-]+\.json$/),
  byok: ByokPanelSchema.exactOptional(),
  withdrawn: z.literal(true).exactOptional(),
}) satisfies z.ZodType<TokenizerEntry>;

/** Row rule from the type's comments: `tokenizer === null` ⇔ `fidelity === 'unavailable'`, and such rows carry `byok`. */
export const ModelRowSchema = z.strictObject({
  model: nonEmpty, lab: LabSchema,
  tokenizer: TokenizerIdSchema.nullable(),
  byok: ByokPanelSchema.exactOptional(),
  fidelity: z.union([FidelitySchema, z.literal('unavailable')]),
  status: z.enum(['current', 'previous', 'historical']),
  evidenceUrl: z.url(), checkedOn: isoDate,
  note: L10nSchema,
}).superRefine((row, ctx) => {
  if ((row.tokenizer === null) !== (row.fidelity === 'unavailable')) {
    ctx.addIssue({ code: 'custom', path: ['fidelity'], message: "fidelity is 'unavailable' iff tokenizer is null" });
  }
  if (row.tokenizer === null && row.byok === undefined) {
    ctx.addIssue({ code: 'custom', path: ['byok'], message: 'a row without a public tokenizer must point to a live-check panel (byok)' });
  }
}) satisfies z.ZodType<ModelRow>;

export const ExampleChipSchema = z.strictObject({
  key: nonEmpty,
  fixtureCase: nonEmpty,
  text: z.string(),
  label: L10nSchema.exactOptional(),
  lang: TextLangChoiceSchema,
  why: L10nSchema,
}) satisfies z.ZodType<ExampleChip>;

export const ByokConfigSchema = z.strictObject({
  checkedOn: isoDate,
  anthropic: z.strictObject({
    endpoint: z.literal('https://api.anthropic.com/v1/messages/count_tokens'), version: isoDate,
    authSchemes: z.array(z.enum(['bearer', 'x-api-key'])).readonly(), defaultAuth: z.literal('bearer'),
    browserAccessHeader: z.literal('anthropic-dangerous-direct-browser-access'),
    workspaceHeader: z.literal('anthropic-workspace-id'),
    models: z.array(z.strictObject({ id: nonEmpty, label: nonEmpty, frameTokens: count, generation: z.enum(['v3', 'v4.7', 'v4.8', 'v5.5']) })).readonly(),
  }),
  xai: z.strictObject({
    endpoint: z.literal('https://api.x.ai/v1/tokenize-text'), defaultModel: nonEmpty,
    models: z.array(z.strictObject({ id: nonEmpty, label: nonEmpty })).readonly(),
  }),
}) satisfies z.ZodType<ByokConfig>;
