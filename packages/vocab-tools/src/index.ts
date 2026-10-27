/**
 * @tsbs/vocab-tools — Node-only vocabulary converter (03 §C.5). The `tsbs-vocab` CLI lives in `cli.ts`; this entry
 * exposes its building blocks for tests and for the Vite plugins (`vocabAssets()`, `licences()`, `examples()`).
 * The dev loaders are a separate entry: `@tsbs/vocab-tools/dev`.
 */
export { COMMANDS, DEFAULTS, DEFAULT_CONFORMANCE, USAGE, parseCommand } from './args.ts';
export type {
  BuildOptions,
  CommandName,
  ExamplesOptions,
  GuardCliOptions,
  LicencesOptions,
  MissingRawPolicy,
  ParsedCommand,
  VerifyOptions,
} from './args.ts';
export {
  LICENCES_FILE,
  MANIFEST_FILE,
  conversionDate,
  convertAsset,
  generatorId,
  modificationStatements,
  refusalReason,
  resolveBuiltOn,
  runBuild,
} from './build.ts';
export type { AssetReport, BuildDeps, BuildResult, ConvertedAsset } from './build.ts';
export { generateExamples, generateLicences, readVocabManifest, runExamples, runLicences } from './commands.ts';
export { gunzip, gzipDeterministic, gzipSize, sha256Hex } from './compress.ts';
export { checkConformance, reportPassed } from './conformance-gate.ts';
export type { ConformanceDeps, ConformanceOutcome, ConformanceTarget } from './conformance-gate.ts';
export { READER_SUBPATH, loadReadTsbv1 } from './core-reader.ts';
export type { ReadTsbv1, ReaderLoader, ReaderLookup } from './core-reader.ts';
export {
  DEFAULT_CHIP_CASES,
  DEFAULT_EXAMPLE,
  DEFAULT_EXAMPLES,
  DEFAULT_EXAMPLE_BUDGET_GZ,
  EXAMPLES_BUDGET_GZ,
  buildExamples,
  caseToWire,
  loadChips,
  loadFixtures,
} from './examples.ts';
export type {
  ChipRef,
  ExampleCaseWire,
  ExamplesIndex,
  ExamplesOutput,
  ExamplesWire,
  GeneratedJson,
} from './examples.ts';
export { GUARD_LIMITS, runGuard } from './guard.ts';
export type { GuardOptions, GuardReport } from './guard.ts';
export { decodeContainer, inspectReport, unwrap } from './inspect.ts';
export type { DecodedContainer } from './inspect.ts';
export { LLAMA3_SPECIALS_NOTE, buildLicences, modificationNotice, stableJson } from './licences.ts';
export type { LicenceAsset, LicenceTextFile, LicencesGenerated } from './licences.ts';
export { isSnapshotted, parseOracleManifest, readOracleManifest } from './oracle-manifest.ts';
export type { OracleAsset, OracleFile, OracleManifest } from './oracle-manifest.ts';
export { ASSET_SOURCES, findSource } from './sources/index.ts';
export type { AssetSource, ParserName } from './sources/index.ts';
export { PieceType } from './tables.ts';
export type { MergeTable, SpecialEntry, TableConfig, VocabTables } from './tables.ts';
export { FAMILY_CODE, SECTION_ORDER, encodeTsbv1 } from './tsbv-writer.ts';
export type { EncodedContainer, WriteContext } from './tsbv-writer.ts';
export { runVerify } from './verify.ts';
export type { VerifyReport } from './verify.ts';
