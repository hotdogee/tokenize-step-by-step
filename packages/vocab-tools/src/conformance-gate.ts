/**
 * The conformance hook of `tsbs-vocab build` (AD-13, AD-32, 03 §C.5): before an asset is written, the in-memory tables
 * (the encoded container, read back through WP02's `readTsbv1` from `@tsbs/core/format/tsbv1`, located by
 * `core-reader.ts` and injected) are wrapped by the family's engine and run against `fixtures/<tokenizerId>.json` with
 * `@tsbs/conformance`'s `runFixture`.
 *
 * Modes: `strict` refuses an asset whose engine is missing or whose fixture fails; `skip-missing-engine` skips (with a
 * WARNING per asset) only families whose engine factory `@tsbs/core` does not export yet; `off` skips everything
 * (local development only). The engine factories and `runFixture` are probed on the module objects, so this file needs
 * no change when WP01/WP02/WP05A/WP05B land.
 */
import { readFile } from 'node:fs/promises';
import type { Family, TokenizerId } from '@tsbs/core';
import { ENGINE_FACTORIES, type ConformanceMode } from '@tsbs/conformance';
import { READER_SUBPATH } from './core-reader.ts';

/** What the gate needs to know about one asset. */
export interface ConformanceTarget {
  readonly tokenizerId: TokenizerId;
  readonly family: Family;
  /** The uncompressed TSBV1 container that will be written. */
  readonly container: Uint8Array;
  readonly fixturePath: string;
}

export type ConformanceOutcome =
  | { readonly kind: 'passed'; readonly message: string }
  | { readonly kind: 'skipped'; readonly message: string }
  | { readonly kind: 'failed'; readonly message: string };

/** Injected module objects and loaders (tests pass fakes). */
export interface ConformanceDeps {
  /** `import * as core from '@tsbs/core'`. */
  readonly core: Readonly<Record<string, unknown>>;
  /** `import * as conformance from '@tsbs/conformance'`. */
  readonly conformance: Readonly<Record<string, unknown>>;
  /** WP02's `readTsbv1` (`loadReadTsbv1` in `core-reader.ts`), or null while it does not exist. */
  readonly readTsbv1: ((buf: ArrayBuffer) => unknown) | null;
  /** The registry `TokenizerEntry` the engine factory takes, or null when the registry has none (yet). */
  readonly registryEntry: (id: TokenizerId) => Promise<unknown>;
  readonly readFixture: (path: string) => Promise<unknown>;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/**
 * Whether a `ConformanceReport` (04 §7; shape owned by WP01) says the fixture passed. Accepted shapes: `{ ok: boolean }`,
 * `{ failures: unknown[] }` or `{ failed: number }`; anything else is treated as a failure so an unwired report can
 * never pass silently.
 */
export function reportPassed(report: unknown): { passed: boolean; summary: string } {
  if (!isRecord(report)) return { passed: false, summary: 'runFixture returned no report object' };
  if (typeof report['ok'] === 'boolean') return { passed: report['ok'], summary: `ok = ${String(report['ok'])}` };
  const failures = report['failures'];
  if (Array.isArray(failures)) return { passed: failures.length === 0, summary: `${String(failures.length)} failures` };
  if (typeof report['failed'] === 'number')
    return { passed: report['failed'] === 0, summary: `${String(report['failed'])} failed` };
  return { passed: false, summary: 'unrecognised ConformanceReport shape (expected ok, failures[] or failed)' };
}

/** Runs the gate for one asset under `mode`. Never throws for a conformance failure: it returns `failed`. */
export async function checkConformance(
  mode: ConformanceMode,
  target: ConformanceTarget,
  deps: ConformanceDeps,
): Promise<ConformanceOutcome> {
  const factoryName = ENGINE_FACTORIES[target.family];
  if (mode === 'off')
    return { kind: 'skipped', message: `conformance off for ${target.tokenizerId} (local development only, AD-13)` };
  const factory = deps.core[factoryName];
  if (typeof factory !== 'function') {
    return mode === 'skip-missing-engine'
      ? {
          kind: 'skipped',
          message: `CONFORMANCE SKIPPED for ${target.tokenizerId} (${target.family}): @tsbs/core does not export ${factoryName} yet (AD-32).`,
        }
      : {
          kind: 'failed',
          message: `strict conformance: @tsbs/core does not export ${factoryName}, so ${target.tokenizerId} cannot be checked`,
        };
  }
  const readTsbv1 = deps.readTsbv1;
  const runFixture = deps.conformance['runFixture'];
  if (readTsbv1 === null || typeof runFixture !== 'function')
    return {
      kind: 'failed',
      message: `${target.tokenizerId}: ${factoryName} exists but readTsbv1 (${READER_SUBPATH}) or @tsbs/conformance.runFixture is missing`,
    };
  const entry = await deps.registryEntry(target.tokenizerId);
  if (entry === null || entry === undefined)
    return {
      kind: 'failed',
      message: `${target.tokenizerId}: no registry TokenizerEntry to construct the engine with`,
    };
  let tokenizer: unknown = null;
  try {
    const fixture = await deps.readFixture(target.fixturePath);
    const tsbv = readTsbv1(target.container.slice().buffer);
    tokenizer = await (factory as (t: unknown, e: unknown) => unknown)(tsbv, entry);
    const report: unknown = await (runFixture as (f: unknown, t: unknown) => unknown)(fixture, tokenizer);
    const { passed, summary } = reportPassed(report);
    return passed
      ? { kind: 'passed', message: `${target.tokenizerId}: fixture conformance passed (${summary})` }
      : { kind: 'failed', message: `${target.tokenizerId}: fixture conformance FAILED (${summary})` };
  } catch (error: unknown) {
    return {
      kind: 'failed',
      message: `${target.tokenizerId}: conformance threw: ${error instanceof Error ? error.message : String(error)}`,
    };
  } finally {
    // Disposed whatever the outcome (a failing or throwing fixture run must not leak the engine).
    if (isRecord(tokenizer) && typeof tokenizer['dispose'] === 'function') (tokenizer['dispose'] as () => void)();
  }
}

/**
 * Loader for registry entries from `packages/registry/data/tokenizers.json` (WP04). Accepts an array of entries, an
 * object with a `tokenizers` array, or an object keyed by id; resolves null when the file does not exist yet.
 */
export function registryEntryLoader(tokenizersJsonPath: string): (id: TokenizerId) => Promise<unknown> {
  let cache: Promise<unknown> | undefined;
  return async (id) => {
    cache ??= readFile(tokenizersJsonPath, 'utf8').then(
      (text) => JSON.parse(text) as unknown,
      () => null,
    );
    const data = await cache;
    const list = Array.isArray(data)
      ? data
      : isRecord(data) && Array.isArray(data['tokenizers'])
        ? data['tokenizers']
        : null;
    if (list !== null) return (list as unknown[]).find((entry) => isRecord(entry) && entry['id'] === id) ?? null;
    if (isRecord(data) && isRecord(data[id])) return data[id];
    return null;
  };
}

/** Reads a fixture JSON file. */
export async function readFixtureFile(path: string): Promise<unknown> {
  return JSON.parse(await readFile(path, 'utf8')) as unknown;
}
