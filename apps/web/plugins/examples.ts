/**
 * `examples()` — placeholder (WP03). Will turn the golden fixtures into precomputed example results via
 * `fromFixtureCase` (03 §C.7): `src/generated/examples-default.json` (inlined, ≤ 4 KB gz) and
 * `dist/examples/<tokenizer>.<sha8>.json` (lazy, ≤ 16 KB gz each).
 */
import type { Plugin } from 'vite';

export function examples(): Plugin {
  return { name: 'tsbs:examples' };
}
