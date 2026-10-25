/**
 * @tsbs/worker — Web Worker host, vocabulary loader and `TokenizerClient` (WP07).
 *
 * `apps/web` imports `@tsbs/worker/client` (the client, `WORKER_NAME`, the error classes) and constructs the Worker
 * from `@tsbs/worker/entry?worker` (02 §2.1, §5); this root module only re-exports the protocol types and the name.
 * The wire protocol is FROZEN in `@tsbs/core/protocol` (04 §6).
 */
export type { FromWorker, ToWorker, TokenizerClientLike } from '@tsbs/core/protocol';
export { WORKER_NAME } from './client.ts';
