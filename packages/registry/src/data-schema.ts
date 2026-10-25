/**
 * Types and zod schemas for the registry data files that the FROZEN `schema.ts` (03 §B.7) does not type: the
 * hand-written display strings of `licences.json`, the shared accessibility/BYOK strings of `strings.json`, and the
 * file-level shapes of all six `packages/registry/data/*.json` files.
 *
 * Browser code imports the types only (`export type *` in `index.ts`); the schemas are build/test only (AD-28).
 */
import { z } from 'zod';
import {
  ByokConfigSchema,
  ExampleChipSchema,
  L10nSchema,
  ModelRowSchema,
  NoticeKeySchema,
  TokenizerEntrySchema,
} from './schema.ts';
import type { ByokConfig, ExampleChip, L10n, ModelRow, NoticeKey, TokenizerEntry } from './schema.ts';

/** A link shown next to a notice: an absolute `https://` URL, a licence text served from `/licenses/…`, or `/about/`. */
export interface NoticeLink {
  href: string;
  label: L10n;
}

/**
 * One required notice (05 §15). `legal` notices carry `verbatim`, the exact legal string that is rendered untranslated
 * in every UI locale (xAI notice, "Powered by xAI", Llama 3 / Gemma notices); `explanatory` notices are translated prose
 * only. `title` and `body` are the UI-language text around the notice; `prominent` asks for heading-size rendering
 * ("Powered by xAI", "Built with Meta Llama 3", 05 §14).
 */
export interface NoticeEntry {
  kind: 'legal' | 'explanatory';
  title: L10n;
  body: L10n;
  verbatim?: string;
  prominent?: true;
  links?: readonly NoticeLink[];
}

/** Display strings for one shipped asset's licence, keyed in `licences.json` by the oracle-manifest asset id. */
export interface LicenceDisplay {
  /** Short licence tag for the picker row ("MIT", "Apache-2.0", "xAI Community License"); a name, never translated. */
  tag: string;
  /** Must equal `license.spdx` of the asset in `tools/oracle/manifest.json` (registry:check). */
  spdx: string;
  /** One or two sentences per locale; the governing texts are served verbatim from `/licenses/<assetId>/`. */
  summary: L10n;
}

/** `licences.json`: hand-written display strings (03 §B.7). `licences.generated.json` (WP03) carries the verbatim side. */
export interface LicencesFile {
  schema: 1;
  /** Keyed by `TokenizerEntry.licence` (= the oracle-manifest asset id). */
  licences: Readonly<Record<string, LicenceDisplay>>;
  /** Every `NoticeKey` has an entry with strings in all three locales. */
  notices: Readonly<Partial<Record<NoticeKey, NoticeEntry>>>;
  /**
   * The MODIFIED statement template (03 §B.7), English and verbatim, with exactly the placeholders `{file}`, `{sha256}`,
   * `{version}` and `{date}`; rendered per asset on About and written by the converter next to each `.bin`.
   */
  modifiedTemplate: string;
}

/** Screen-reader text for the board's semantic markers (05 §10 `a11y.marker.*`, AD-36). */
export type MarkerKey =
  | 'continued'
  | 'continues'
  | 'zeroWidthDummy'
  | 'zeroWidthBos'
  | 'splits'
  | 'partialCut'
  | 'byteFallback'
  | 'userDefined'
  | 'special'
  | 'justMerged'
  | 'combining';

/** `strings.json`: data-driven strings that are not legal notices — marker SR text and the BYOK messages of AD-24. */
export interface RegistryStrings {
  schema: 1;
  marker: Readonly<Record<MarkerKey, L10n>>;
  byok: {
    /** Network/CORS failure of the Anthropic call: zero-data-retention organisations get no CORS (05 §13). */
    zdrCors: L10n;
    /** HTTP 400 because the key is not scoped to a workspace (`anthropic-workspace-id`, AD-24). */
    workspaceRequired: L10n;
    /** The fixed per-message frame the count includes; placeholder `{frame}` (AD-24 frame-token note). */
    frameNote: L10n;
  };
}

// ---- schemas ----

const nonEmpty = z.string().min(1);

export const NoticeLinkSchema = z.strictObject({
  href: z.string().regex(/^(https:\/\/\S+|\/licenses\/[A-Za-z0-9._-]+\/[A-Za-z0-9._/-]+|\/about\/)$/),
  label: L10nSchema,
}) satisfies z.ZodType<NoticeLink>;

export const NoticeEntrySchema = z.strictObject({
  kind: z.enum(['legal', 'explanatory']),
  title: L10nSchema,
  body: L10nSchema,
  verbatim: nonEmpty.exactOptional(),
  prominent: z.literal(true).exactOptional(),
  links: z.array(NoticeLinkSchema).readonly().exactOptional(),
}) satisfies z.ZodType<NoticeEntry>;

export const LicenceDisplaySchema = z.strictObject({
  tag: nonEmpty,
  spdx: nonEmpty,
  summary: L10nSchema,
}) satisfies z.ZodType<LicenceDisplay>;

export const LicencesFileSchema = z.strictObject({
  schema: z.literal(1),
  licences: z.record(nonEmpty, LicenceDisplaySchema),
  notices: z.partialRecord(NoticeKeySchema, NoticeEntrySchema),
  modifiedTemplate: nonEmpty,
}) satisfies z.ZodType<LicencesFile>;

export const MARKER_KEYS = [
  'continued',
  'continues',
  'zeroWidthDummy',
  'zeroWidthBos',
  'splits',
  'partialCut',
  'byteFallback',
  'userDefined',
  'special',
  'justMerged',
  'combining',
] as const satisfies readonly MarkerKey[];

export const RegistryStringsSchema = z.strictObject({
  schema: z.literal(1),
  marker: z.record(z.enum(MARKER_KEYS), L10nSchema),
  byok: z.strictObject({ zdrCors: L10nSchema, workspaceRequired: L10nSchema, frameNote: L10nSchema }),
}) satisfies z.ZodType<RegistryStrings>;

/** File-level shapes: `tokenizers.json`, `models.json` and `examples.json` are plain arrays; the others are objects. */
export const TokenizersFileSchema = z.array(TokenizerEntrySchema) satisfies z.ZodType<TokenizerEntry[]>;
export const ModelsFileSchema = z.array(ModelRowSchema) satisfies z.ZodType<ModelRow[]>;
export const ExamplesFileSchema = z.array(ExampleChipSchema) satisfies z.ZodType<ExampleChip[]>;
export const ByokFileSchema = ByokConfigSchema satisfies z.ZodType<ByokConfig>;
