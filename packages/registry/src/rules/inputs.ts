/**
 * Lenient schemas for the two external inputs `registry:check` cross-references: the oracle manifest
 * (`tools/oracle/manifest.json`, curated by the oracle lane) and the golden fixtures (`fixtures/*.json`). Only the fields
 * the rules read are declared; everything else is ignored, so the oracle lane can add fields without breaking the check.
 */
import { z } from 'zod';

const ManifestFileSchema = z.object({ name: z.string(), role: z.string(), sha256: z.string() });

export const OracleManifestSchema = z.object({
  assets: z.array(
    z.object({
      id: z.string(),
      shipIntent: z.string(),
      files: z.array(ManifestFileSchema),
      license: z.object({
        spdx: z.string(),
        obligations: z.array(z.string()),
        notice: z.object({ text: z.string() }).optional(),
      }),
    }),
  ),
});
export type OracleManifest = z.output<typeof OracleManifestSchema>;
export type OracleAsset = OracleManifest['assets'][number];

const FixtureTokenSchema = z.object({
  id: z.number().int(),
  bytes: z.string(),
  zeroWidth: z.boolean(),
  type: z.string().optional(),
});

const FixtureCaseSchema = z.object({
  name: z.string(),
  text: z.string(),
  ids: z.array(z.number().int()),
  idsWithSpecials: z.array(z.number().int()).optional(),
  tokens: z.array(FixtureTokenSchema),
});

/** The subset of a golden fixture (`packages/core/src/fixture/fixture-types.ts`) that the registry rules read. */
export const FixtureSubsetSchema = z.object({
  tokenizer: z.string(),
  vocabAsset: z.string(),
  vocabSha256: z.string(),
  family: z.string(),
  cases: z.array(FixtureCaseSchema),
});
export type FixtureSubset = z.output<typeof FixtureSubsetSchema>;
