/**
 * `licences()` — placeholder (WP03). Will build `src/generated/licences.json` from `tools/oracle/manifest.json` and
 * `docs/licenses/**`, and copy the verbatim licence texts to `dist/licenses/<assetId>/` for the About page (05 §14).
 */
import type { Plugin } from 'vite';

export function licences(): Plugin {
  return { name: 'tsbs:licences' };
}
