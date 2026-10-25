/**
 * `registry:check` (03 §B.7, AD-14): zod validation of the six registry data files plus the cross-file rules against the
 * oracle manifest, the golden fixtures, the licence texts and, when present, the built vocabulary assets.
 *
 * Pure: the caller loads every input (see `scripts/registry-check.ts`, the Node CLI behind `pnpm registry:check`) and gets
 * back the list of issues; an empty list means the registry is consistent. Build/test only — zod never reaches the
 * browser (AD-28).
 */
import type { z } from 'zod';
import {
  ByokFileSchema,
  ExamplesFileSchema,
  LicencesFileSchema,
  ModelsFileSchema,
  RegistryStringsSchema,
  TokenizersFileSchema,
} from './data-schema.ts';
import type { BuiltAsset } from './rules/built.ts';
import { checkBuilt } from './rules/built.ts';
import { checkByok } from './rules/byok.ts';
import { checkExamples } from './rules/examples.ts';
import type { FixtureSubset, OracleManifest } from './rules/inputs.ts';
import { OracleManifestSchema } from './rules/inputs.ts';
import { checkL10n } from './rules/l10n.ts';
import { checkLicences } from './rules/licences.ts';
import { checkModels } from './rules/models.ts';
import type { CheckIssue, Report } from './rules/report.ts';
import { checkFixtures, checkManifest } from './rules/sources.ts';
import { checkTokenizerEntries, checkTokenizerSet } from './rules/tokenizers.ts';

export type { BuiltAsset } from './rules/built.ts';
export type { CheckIssue, RuleId } from './rules/report.ts';

/** The six data files of `packages/registry/data/`, as parsed JSON (validated here, not by the caller). */
export interface RegistryFiles {
  readonly tokenizers: unknown;
  readonly models: unknown;
  readonly licences: unknown;
  readonly examples: unknown;
  readonly byok: unknown;
  readonly strings: unknown;
}

export interface RegistryInput {
  readonly files: RegistryFiles;
  /** `tools/oracle/manifest.json`. */
  readonly manifest: unknown;
  /** Parsed fixtures keyed by the path `TokenizerEntry.fixture` names ("fixtures/openai-o200k_base.json"). */
  readonly fixtures: ReadonlyMap<string, unknown>;
  /** Files under `docs/licenses/` as "<assetId>/<file>" (what `/licenses/…` links may point at). */
  readonly licenceFiles: ReadonlySet<string>;
  /** Built assets by TokenizerId from `data/vocab/dist`, or null when that directory does not exist. */
  readonly built: ReadonlyMap<string, BuiltAsset> | null;
}

/** Validates one file; reports every zod issue under `json-schema` and returns the data or null. */
function parse<T>(schema: z.ZodType<T>, value: unknown, name: string, report: Report): T | null {
  const result = schema.safeParse(value);
  if (result.success) return result.data;
  for (const issue of result.error.issues) {
    report('json-schema', [name, ...issue.path.map(String)].join('.'), issue.message);
  }
  return null;
}

/** Runs every registry rule and returns the issues found (empty = consistent). */
export function checkRegistry(input: RegistryInput): CheckIssue[] {
  const issues: CheckIssue[] = [];
  const report: Report = (rule, where, message) => {
    issues.push({ rule, where, message });
  };
  const { files } = input;
  const tokenizers = parse(TokenizersFileSchema, files.tokenizers, 'tokenizers', report);
  const models = parse(ModelsFileSchema, files.models, 'models', report);
  const licences = parse(LicencesFileSchema, files.licences, 'licences', report);
  const examples = parse(ExamplesFileSchema, files.examples, 'examples', report);
  const byok = parse(ByokFileSchema, files.byok, 'byok', report);
  const strings = parse(RegistryStringsSchema, files.strings, 'strings', report);
  const manifest: OracleManifest | null = parse(OracleManifestSchema, input.manifest, 'manifest', report);

  checkL10n({ tokenizers, models, licences, examples, strings }, report);
  if (byok !== null) checkByok(byok, report);
  if (tokenizers === null) return issues;

  checkTokenizerSet(tokenizers, report);
  checkTokenizerEntries(tokenizers, report);
  if (manifest !== null) checkManifest(tokenizers, manifest, report);
  const fixtures: ReadonlyMap<string, FixtureSubset> = checkFixtures(tokenizers, input.fixtures, report);
  if (licences !== null) checkLicences(tokenizers, licences, manifest, input.licenceFiles, report);
  if (models !== null) checkModels(models, tokenizers, report);
  if (examples !== null) checkExamples(examples, tokenizers, fixtures, report);
  checkBuilt(tokenizers, input.built, report);
  return issues;
}
