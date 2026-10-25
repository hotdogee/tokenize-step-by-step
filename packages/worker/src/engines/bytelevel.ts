/**
 * The byte-level engine chunk (PA-8: Vite emits it as `assets/bytelevel-[hash].js`). The host imports this module
 * lazily, `await import('./engines/bytelevel.ts')`, on the first load of a `bytelevel-bpe` tokenizer (04 §6 rule 5), so
 * Engine A (WP05A), its Unicode tables and the TSBV1 reader's byte vocabulary never reach the Worker's host chunk.
 */
export { createByteLevelTokenizer } from '@tsbs/core/engines/bytelevel/index';
