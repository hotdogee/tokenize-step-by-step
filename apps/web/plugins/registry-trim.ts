/**
 * `registryTrim()` (PA-7) — keeps the registry data that `/` does not render at startup out of the JSON the browser
 * bundles, so its initial chunks carry only what first paint shows. `@tsbs/registry` keeps one source of truth (AD-14);
 * the converter, `registry:check`, `pnpm generate` and the Worker's engine config read the files from disk and still see
 * every field. Trimmed:
 *
 * - `tokenizers.json` › each entry's `asset` (oracle-manifest id, source file and sha256 — the converter's inputs; About
 *   shows provenance from `licences.generated.json`) and `fixture` (the conformance path) — no page reads them;
 * - `licences.json` › each licence's `spdx` and `summary` (About renders the verbatim side, `licences.generated.json`) and
 *   the converter's `modifiedTemplate` — no page reads them;
 * - `examples.json` › the `why` sentence of every chip but the default one: `/` shows one sentence, the selected chip's,
 *   and `app/example-why.svelte.ts` loads the others (a `?raw` import of the full file, which this plugin leaves alone)
 *   the first time another chip is selected. The site types the trimmed chips as `SiteExampleChip` (`why` optional).
 *
 * `registry-trim.test.ts` scans `src/` so no page starts reading a trimmed field. Applied before Vite's JSON plugin
 * (`enforce: 'pre'`) in `vite build` and `vite dev`; unit tests import the full files.
 */
import { normalizePath, type Plugin } from 'vite';

export type TrimmedFile = 'tokenizers' | 'licences' | 'examples';

/** Which trimmed registry file a module id is (a `?raw` import is the untouched text, never trimmed). */
export function registryFileOf(id: string): TrimmedFile | null {
  const match = /\/packages\/registry\/data\/(tokenizers|licences|examples)\.json(\?.*)?$/.exec(normalizePath(id));
  if (match === null || (match[2] ?? '').includes('raw')) return null;
  const file = match[1];
  return file === 'tokenizers' || file === 'licences' || file === 'examples' ? file : null;
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

/** A copy of `record` without `keys`. */
function without(record: Record<string, unknown>, keys: readonly string[]): Record<string, unknown> {
  return Object.fromEntries(Object.entries(record).filter(([key]) => !keys.includes(key)));
}

/** Fields dropped per tokenizer entry. */
export const TOKENIZER_FIELDS = ['asset', 'fixture'] as const;
/** Fields dropped per licence display entry. */
export const LICENCE_FIELDS = ['spdx', 'summary'] as const;
/** Top-level fields dropped from `licences.json`. */
export const LICENCES_FILE_FIELDS = ['modifiedTemplate'] as const;
/** Fields dropped from every example chip but the first (the default example, 05 §6). */
export const EXAMPLE_FIELDS = ['why'] as const;

/** Maps the records of an array (anything else passes through). */
function mapRecords(json: unknown, map: (record: Record<string, unknown>, index: number) => unknown): unknown {
  if (!Array.isArray(json)) return json;
  return (json as unknown[]).map((entry, index) => (isRecord(entry) ? map(entry, index) : entry));
}

/** The site's view of one registry file (input is the parsed JSON; anything unexpected passes through unchanged). */
export function trimRegistryJson(file: TrimmedFile, json: unknown): unknown {
  if (file === 'tokenizers') return mapRecords(json, (entry) => without(entry, TOKENIZER_FIELDS));
  if (file === 'examples')
    return mapRecords(json, (chip, index) => (index === 0 ? chip : without(chip, EXAMPLE_FIELDS)));
  if (!isRecord(json)) return json;
  const licences = json['licences'];
  return {
    ...without(json, LICENCES_FILE_FIELDS),
    ...(isRecord(licences)
      ? {
          licences: Object.fromEntries(
            Object.entries(licences).map(([key, value]) => [
              key,
              isRecord(value) ? without(value, LICENCE_FIELDS) : value,
            ]),
          ),
        }
      : {}),
  };
}

export function registryTrim(): Plugin {
  return {
    name: 'tsbs:registry-trim',
    enforce: 'pre',
    transform(code, id) {
      const file = registryFileOf(id);
      if (file === null) return null;
      return { code: JSON.stringify(trimRegistryJson(file, JSON.parse(code))), map: null };
    },
  };
}
