/**
 * @tsbs/registry — public entry point (browser-safe).
 *
 * Only the FROZEN registry types are re-exported here, type-only, so importing this module can never pull zod into a
 * browser bundle (AD-28). Node tools and tests import the zod schemas from `@tsbs/registry/schema`. The data files
 * (`data/*.json`) and `registry:check` arrive with WP04.
 */
export type * from './schema.ts';
