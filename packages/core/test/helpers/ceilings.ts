/**
 * The Node ceilings of 06 §3 — the design's single source of every CI-asserted performance number (AD-39); this module
 * is their single source in code. Each Node ceiling is the phone budget divided by the ×4 phone margin (06 §3: "≤ 25 ms
 * / ≤ 40 ms in Node (bench) ⇒ ≤ 100 ms / ≤ 160 ms on the phone"), so asserting the Node number on a quiet machine asserts
 * the phone budget with that margin. Used by the opt-in `TSBS_PERF=1` tests (`-t TSBS_PERF`, `pnpm test:perf`) and by
 * `pnpm bench` (`test/bench/check-bench.ts` over the `vitest bench` medians). Timing runs are serial: one file at a time
 * (`--no-file-parallelism`), because a parallel run once pushed `readTsbv1` past its ceiling (30.3 ms vs 25 ms).
 */

/** Phone budget = Node ceiling × this margin (06 §3, 07 §5 risk 3). */
export const PHONE_MARGIN = 4;

/** Node ceilings in milliseconds (medians of warm runs). */
export const NODE_CEILING_MS = {
  /** Vocab init in the Worker, o200k_base: `readTsbv1` of the decompressed container (+ the engine factory in the bench). */
  initO200k: 25,
  /** Vocab init in the Worker, Gemma 4: PCES + TYPS + MRGS → CSR (+ the engine factory in the bench). */
  initGemma4: 40,
  /** Encode 10,000 CJK code points (one chunk), byte-level tokenizers, trace on. */
  encode10kByteLevel: 15,
  /** Encode 20,000 CJK code points (one chunk), byte-level tokenizers, trace on. */
  encode20kByteLevel: 40,
  /** Encode 10,000 CJK code points, every spm tokenizer, trace on. */
  encode10kSpm: 20,
} as const;

export type CeilingKey = keyof typeof NODE_CEILING_MS;
