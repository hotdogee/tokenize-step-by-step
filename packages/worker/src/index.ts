/**
 * @tsbs/worker — Web Worker host, vocabulary loader and `TokenizerClient` (implemented by WP07).
 *
 * WP00 ships the package boundary only. The wire protocol is FROZEN in `@tsbs/core/protocol` (04 §6); `apps/web` will
 * import `@tsbs/worker/client` and nothing else from this package (02 §2.1).
 */
export type { FromWorker, ToWorker, TokenizerClientLike } from '@tsbs/core/protocol';

/** Name given to the tokenizer Worker (`new Worker(url, { name })`) so it is identifiable in devtools and crash reports. */
export const WORKER_NAME = 'tsbs-tokenizer';
