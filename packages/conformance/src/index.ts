/**
 * @tsbs/conformance — golden-fixture conformance shared by the engine tests and `tsbs-vocab build` (AD-13).
 *
 * `runFixture(fixture, tokenizer)` arrives with WP01 (04 §7). WP00 provides the conformance modes and the engine probe
 * that implements the interim gate (AD-32): under `skip-missing-engine`, conformance is skipped only for a family whose
 * engine factory `@tsbs/core` does not export yet.
 */
import type { Family } from '@tsbs/core';

/** Modes of `tsbs-vocab build --conformance` (03 §C.5). `off` is for local development only and never used in CI. */
export const CONFORMANCE_MODES = ['strict', 'skip-missing-engine', 'off'] as const;
export type ConformanceMode = (typeof CONFORMANCE_MODES)[number];

/** True iff `value` names a conformance mode. */
export function isConformanceMode(value: string): value is ConformanceMode {
  return (CONFORMANCE_MODES as readonly string[]).includes(value);
}

/** The `@tsbs/core` export that constructs each family's engine (WP05A / WP05B). */
export const ENGINE_FACTORIES = {
  'bytelevel-bpe': 'createByteLevelTokenizer',
  'spm-bpe': 'createSpmTokenizer',
} as const satisfies Readonly<Record<Family, string>>;

const FAMILIES = Object.keys(ENGINE_FACTORIES) as readonly Family[];

/**
 * Families whose engine factory is exported by `coreModule` (pass `import * as core from '@tsbs/core'`), in a fixed order.
 * A family counts as available only when its export is a function.
 */
export function familiesWithEngine(coreModule: Readonly<Record<string, unknown>>): Family[] {
  return FAMILIES.filter((family) => typeof coreModule[ENGINE_FACTORIES[family]] === 'function');
}

/** Families whose engine factory is missing from `coreModule` (the ones `skip-missing-engine` skips, with a warning). */
export function familiesMissingEngine(coreModule: Readonly<Record<string, unknown>>): Family[] {
  const available = new Set(familiesWithEngine(coreModule));
  return FAMILIES.filter((family) => !available.has(family));
}
