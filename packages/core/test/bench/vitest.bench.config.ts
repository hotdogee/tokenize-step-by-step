/**
 * `pnpm bench` (WP12): the `vitest bench` suites of `@tsbs/core` (vocab init, 10k/20k CJK encode) on the built assets.
 * Timing is serial — one file at a time in one worker — because parallel files share the CPU and once pushed a ceiling
 * over (06 §3; docs/dev.md § Performance). The JSON report feeds `check-bench.ts`.
 */
import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    name: 'core-bench',
    root: fileURLToPath(new URL('../..', import.meta.url)),
    include: [],
    environment: 'node',
    fileParallelism: false,
    maxWorkers: 1,
    benchmark: { include: ['test/bench/**/*.bench.ts'] },
  },
});
