/**
 * @tsbs/core — public entry point.
 *
 * Re-exports the FROZEN v1 contracts (docs/design/07-implementation-plan.md §1) and the implementations per work package:
 * model builders, text analysis, agenda loop and fixture bridge (WP01), Unicode tables and the TSBV1 reader (WP02), and the
 * engine factories `createByteLevelTokenizer` (WP05A) / `createSpmTokenizer` (WP05B), whose presence here is what
 * `tsbs-vocab build --conformance skip-missing-engine` checks (AD-32).
 *
 * `apps/web` imports values from the `@tsbs/core/{model,text,layout,timeline,fixture}/…` subpaths only (02 §2.1).
 */
export * from './model/result.ts';
export type * from './model/view-types.ts';
export type * from './model/engine.ts';
export type * from './protocol.ts';
export type * from './format/types.ts';
export * from './agenda/types.ts';
export type * from './fixture/fixture-types.ts';

// ---- WP01: model, text analysis, agenda loop, timeline, layout, fixture bridge ----
export * from './model/build-result.ts';
export * from './model/flags.ts';
export * from './model/invariants.ts';
export * from './model/view.ts';
export * from './text/analyze.ts';
export * from './text/nfkc.ts';
export * from './text/stand-ins.ts';
export * from './text/utf8.ts';
export * from './agenda/heap.ts';
export * from './agenda/merge-loop.ts';
export * from './agenda/part-list.ts';
export * from './timeline/timeline.ts';
export * from './timeline/trace-recorder.ts';
export * from './timeline/replay.ts';
export * from './layout/pack-rows.ts';
export * from './fixture/examples-wire.ts';
export * from './fixture/from-fixture-case.ts';
export * from './fixture/mock-client.ts';
export { createSpmTokenizer } from './engines/spm/index.ts';
