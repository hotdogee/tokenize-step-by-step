/**
 * Locates WP02's TSBV1 reader for the conformance gate and the joint WP02/WP03 test. The design places it under
 * `@tsbs/core/format` (03 §C.2, 07 WP02 row): WP02 ships `packages/core/src/format/tsbv1.ts`, which core's `"./*"` export
 * makes the subpath `@tsbs/core/format/tsbv1`. A `readTsbv1` re-exported from the `@tsbs/core` root is accepted as a
 * fallback, so neither placement needs a change here.
 *
 * Only an unresolvable subpath counts as "absent" (the reader has not merged yet). A module that resolves but fails to
 * load, or that does not export a `readTsbv1` function, throws: a broken reader must never look like a missing one.
 */
import { createRequire } from 'node:module';
import type { Tsbv1 } from '@tsbs/core';

/** WP02's `readTsbv1(buf)` (03 §C.2). */
export type ReadTsbv1 = (buf: ArrayBuffer) => Tsbv1;

/** The design's module for the reader. */
export const READER_SUBPATH = '@tsbs/core/format/tsbv1';

export type ReaderLookup =
  | { readonly kind: 'found'; readonly read: ReadTsbv1; readonly from: string }
  | { readonly kind: 'absent'; readonly reason: string };

/** How the lookup resolves and loads modules (tests inject fakes). */
export interface ReaderLoader {
  /** Resolves a specifier to a path; throws an error with code `MODULE_NOT_FOUND` when it does not exist. */
  readonly resolve: (specifier: string) => string;
  readonly load: (specifier: string) => Promise<unknown>;
}

const nodeLoader: ReaderLoader = {
  resolve: (specifier) => createRequire(import.meta.url).resolve(specifier),
  load: (specifier) => import(/* @vite-ignore */ specifier),
};

function isNotFound(error: unknown): boolean {
  return (
    typeof error === 'object' &&
    error !== null &&
    'code' in error &&
    (error.code === 'MODULE_NOT_FOUND' || error.code === 'ERR_MODULE_NOT_FOUND')
  );
}

function readerExport(module: unknown): unknown {
  return typeof module === 'object' && module !== null && 'readTsbv1' in module ? module.readTsbv1 : undefined;
}

/**
 * Finds `readTsbv1`: `READER_SUBPATH` first, then `core` (pass `import * as core from '@tsbs/core'`). Resolves `absent`
 * only when the subpath does not resolve and the root has no `readTsbv1`.
 */
export async function loadReadTsbv1(
  core: Readonly<Record<string, unknown>>,
  loader: ReaderLoader = nodeLoader,
): Promise<ReaderLookup> {
  let resolved = true;
  try {
    loader.resolve(READER_SUBPATH);
  } catch (error: unknown) {
    if (!isNotFound(error)) throw error;
    resolved = false;
  }
  if (resolved) {
    const read = readerExport(await loader.load(READER_SUBPATH));
    if (typeof read !== 'function')
      throw new Error(`${READER_SUBPATH} exists but does not export a readTsbv1 function`);
    return { kind: 'found', read: read as ReadTsbv1, from: READER_SUBPATH };
  }
  const root = core['readTsbv1'];
  if (typeof root === 'function') return { kind: 'found', read: root as ReadTsbv1, from: '@tsbs/core' };
  return {
    kind: 'absent',
    reason: `${READER_SUBPATH} does not exist and @tsbs/core exports no readTsbv1 (WP02 has not merged)`,
  };
}
