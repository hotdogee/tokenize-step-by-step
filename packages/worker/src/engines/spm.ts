/**
 * The SentencePiece engine chunk (PA-8: Vite emits it as `assets/spm-[hash].js`). The host imports this module lazily,
 * `await import('./engines/spm.ts')`, on the first load of an `spm-bpe` tokenizer (04 §6 rule 5), so Engine B (WP05B)
 * never reaches the Worker's host chunk.
 */
export { createSpmTokenizer } from '@tsbs/core/engines/spm/index';
