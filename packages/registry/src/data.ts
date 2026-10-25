/**
 * The registry data as typed constants (browser-safe: plain JSON, no zod — AD-28), one module per data file under
 * `./data/`, each also a package subpath (`@tsbs/registry/tokenizers`, `/models`, …). The site imports the subpaths, so
 * a bundle carries only the files it uses: the `/` shell needs tokenizers, examples and licences (notices) up front,
 * while the model rows arrive with the picker dialog and the About page (06 §3 Main JS budget). A single module
 * importing every file would put all of them in whichever chunk uses any one of them.
 *
 * JSON imports are typed structurally by TypeScript (strings widen to `string`), so each file is asserted to its FROZEN
 * type. That assertion is sound because `pnpm registry:check` validates every file against the zod schemas and the
 * cross-file rules in CI (03 §B.7) — the schemas are the runtime proof, these modules are only the typed view of it.
 */
export { byok } from './data/byok.ts';
export { examples } from './data/examples.ts';
export { licences } from './data/licences.ts';
export { models } from './data/models.ts';
export { strings } from './data/strings.ts';
export { defaultTokenizerId, tokenizerById, tokenizers } from './data/tokenizers.ts';
