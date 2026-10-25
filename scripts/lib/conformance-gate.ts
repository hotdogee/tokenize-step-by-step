/**
 * The interim conformance gate check (AD-32, 07 §2 risk 13): `skip-missing-engine` is allowed only while an engine factory
 * is still missing from `@tsbs/core`; once both exist, CI must run `strict`. `off` is local-only and never allowed in CI.
 * An unset or empty mode means `strict` (the converter's default, AD-13).
 */
import { isConformanceMode, type ConformanceMode } from '@tsbs/conformance';
import type { Family } from '@tsbs/core';

/** Result of the gate: `ok` plus the lines to print (errors when not ok). */
export interface GateVerdict {
  readonly ok: boolean;
  readonly mode: ConformanceMode | null;
  readonly messages: readonly string[];
}

/**
 * Evaluates the gate for the raw `CONFORMANCE_MODE` value, the families whose engine `@tsbs/core` exports, all families,
 * and whether this is a CI run.
 */
export function evaluateGate(
  rawMode: string | undefined,
  available: readonly Family[],
  all: readonly Family[],
  ci: boolean,
): GateVerdict {
  const value = rawMode === undefined || rawMode === '' ? 'strict' : rawMode;
  if (!isConformanceMode(value))
    return {
      ok: false,
      mode: null,
      messages: [`CONFORMANCE_MODE="${value}" is not one of strict | skip-missing-engine | off.`],
    };
  const missing = all.filter((family) => !available.includes(family));
  const engines = `engines present: ${available.join(', ') || 'none'}; missing: ${missing.join(', ') || 'none'}`;
  if (value === 'off' && ci)
    return {
      ok: false,
      mode: value,
      messages: [`CONFORMANCE_MODE=off is local-only and never allowed in CI (AD-13). ${engines}.`],
    };
  if (value !== 'strict' && missing.length === 0)
    return {
      ok: false,
      mode: value,
      messages: [
        `Both engine factories exist, so CONFORMANCE_MODE must be "strict", not "${value}" (AD-32). ` +
          'Set the repository variable: gh variable set CONFORMANCE_MODE --body strict',
      ],
    };
  return { ok: true, mode: value, messages: [`conformance gate OK: mode ${value}; ${engines}.`] };
}
