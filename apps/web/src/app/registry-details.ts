/**
 * The registry data that `/` shows only inside the tokenizer picker — the model rows (PD-6) and the licence tags — and
 * that the About page renders in full (fidelity table). Kept apart from `registry.ts` so it loads with the picker dialog
 * (an `import()` on first open) and the About entry, never in the initial Main JS of `/` (06 §3).
 */
import type { ModelRow } from '@tsbs/registry';
import { licences } from '@tsbs/registry/licences';
import { models } from '@tsbs/registry/models';

/** Model → tokenizer rows with fidelity and dated evidence (PD-6). */
export const MODELS: readonly ModelRow[] = models;

/** Short licence tag per `licence` key, for the picker (licences.json display strings). */
export const LICENCE_TAGS: Readonly<Record<string, string>> = Object.fromEntries(
  Object.entries(licences.licences).map(([key, display]) => [key, display.tag]),
);
