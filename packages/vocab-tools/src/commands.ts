/**
 * The `licences` and `examples` subcommands as functions (the CLI and the Vite plugins share them).
 */
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import type { VocabManifest } from '@tsbs/core';
import type { ExamplesOptions, LicencesOptions } from './args.ts';
import { generatorId, modificationStatements, resolveBuiltOn } from './build.ts';
import { buildExamples, loadChips, loadFixtures, type ExamplesOutput } from './examples.ts';
import { buildLicences, stableJson, type LicencesGenerated } from './licences.ts';
import { readOracleManifest } from './oracle-manifest.ts';

/** Reads a vocab manifest, or null when it does not exist (yet). */
export async function readVocabManifest(path: string): Promise<VocabManifest | null> {
  try {
    return JSON.parse(await readFile(path, 'utf8')) as VocabManifest;
  } catch {
    return null;
  }
}

/** Generates the licences document (with `.bin` facts when the vocab manifest exists). */
export async function generateLicences(
  options: Omit<LicencesOptions, 'out'>,
  env: Readonly<Record<string, string | undefined>>,
): Promise<LicencesGenerated> {
  const { manifest: oracle, json } = await readOracleManifest(options.manifest);
  const vocab = await readVocabManifest(options.vocabManifest);
  const generator = await generatorId();
  return buildLicences({
    oracle,
    licensesDir: options.licenses,
    generator,
    builtOn: vocab?.builtOn ?? resolveBuiltOn(env, json),
    vocab,
    statements: modificationStatements(oracle, vocab, generator, env),
  });
}

/** `tsbs-vocab licences`: writes `options.out`. */
export async function runLicences(
  options: LicencesOptions,
  env: Readonly<Record<string, string | undefined>>,
): Promise<LicencesGenerated> {
  const licences = await generateLicences(options, env);
  await mkdir(dirname(options.out), { recursive: true });
  await writeFile(options.out, stableJson(licences), 'utf8');
  return licences;
}

/** Builds the examples outputs from fixtures + chips (no writes); `warning` is set when the chip list fell back. */
export async function generateExamples(
  options: Omit<ExamplesOptions, 'out'>,
  pathPrefix = '/examples/',
): Promise<{ output: ExamplesOutput; warning: string | null }> {
  const fixtures = await loadFixtures(options.fixtures);
  const { chips, warning } = await loadChips(options.chips);
  return { output: buildExamples(fixtures, chips, pathPrefix), warning };
}

/** `tsbs-vocab examples`: writes every per-tokenizer file, `examples-default.json` and `examples-index.json` into `out`. */
export async function runExamples(
  options: ExamplesOptions,
): Promise<{ output: ExamplesOutput; warning: string | null }> {
  const result = await generateExamples(options);
  await mkdir(options.out, { recursive: true });
  const { perTokenizer, defaultExample, index } = result.output;
  for (const file of [...perTokenizer, defaultExample, index])
    await writeFile(join(options.out, file.name), file.json, 'utf8');
  return result;
}
