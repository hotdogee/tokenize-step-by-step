/**
 * @tsbs/vocab-tools — Node-only vocabulary converter (03 §C.5). The `tsbs-vocab` CLI lives in `cli.ts`; this entry exposes
 * its building blocks for tests and for the Vite plugins of WP03 (`vocabAssets()`, `licences()`, `examples()`).
 */
export { COMMANDS, DEFAULT_CONFORMANCE, parseCommand } from './args.ts';
export type { BuildOptions, CommandName, ParsedCommand } from './args.ts';
export { MANIFEST_FILE, conformanceWarnings, emptyManifest, resolveBuiltOn, runBuild } from './build.ts';
export type { BuildResult } from './build.ts';
