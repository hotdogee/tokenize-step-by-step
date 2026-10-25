/**
 * @tsbs/registry — public entry point (browser-safe).
 *
 * Exports the FROZEN registry types (`schema.ts`, 03 §B.7) and the types of the other data files (`data-schema.ts`),
 * type-only, plus the data itself as typed plain-JSON constants (`data.ts`). Nothing here imports zod at runtime, so
 * importing this module never pulls it into a browser bundle (AD-28). Node tools and tests import the zod schemas from
 * `@tsbs/registry/schema` and the rules from `@tsbs/registry/check` (`pnpm registry:check`).
 */
export type * from './schema.ts';
export type * from './data-schema.ts';
export { byok, defaultTokenizerId, examples, licences, models, strings, tokenizerById, tokenizers } from './data.ts';
