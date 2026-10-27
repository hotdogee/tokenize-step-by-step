/**
 * `examples()` (WP03; AD-16, 03 §C.7) — precomputed example results from the golden fixtures:
 *
 * - `buildStart`: writes `src/generated/examples-default.json` (an array of one wire per default row: the default chip
 *   on each lab's primary tokenizer, PA-19; inlined in the main bundle, ≤ 4 KB gzip together) and
 *   `src/generated/examples-index.json` (lazy file per tokenizer, the default pairs, chips that split a character).
 * - `generateBundle`: emits `dist/examples/<tokenizerId>.<sha8>.json` (`ExamplesWire`, ≤ 16 KB gzip each; paragraph
 *   chips without `merges`).
 * - `vite dev`: serves the same files under `/examples/`.
 *
 * Chips come from `packages/registry/data/examples.json` (WP04) or, until it exists, the 19 chips of 05 §6.
 */
import { join, resolve } from 'node:path';
import { generateExamples, type GeneratedJson } from '@tsbs/vocab-tools';
import { sendBytes, writeIfChanged } from '@tsbs/vocab-tools/vite-support';
import type { Plugin } from 'vite';

export interface ExamplesPluginOptions {
  /** Paths relative to the Vite root. */
  readonly fixtures?: string;
  readonly chips?: string;
  readonly generatedDir?: string;
}

/** Site directory of the lazy files (`_headers` gives `/examples/*` immutable caching). */
export const EXAMPLES_PREFIX = '/examples/';

export function examples(options: ExamplesPluginOptions = {}): Plugin {
  let fixtures = '';
  let chips = '';
  let generatedDir = '';
  let lazy: readonly GeneratedJson[] = [];

  return {
    name: 'tsbs:examples',
    configResolved(config) {
      fixtures = resolve(config.root, options.fixtures ?? '../../fixtures');
      chips = resolve(config.root, options.chips ?? '../../packages/registry/data/examples.json');
      generatedDir = resolve(config.root, options.generatedDir ?? 'src/generated');
    },
    async buildStart() {
      const { output, warning } = await generateExamples({ fixtures, chips }, EXAMPLES_PREFIX);
      if (warning !== null) this.warn(warning);
      await writeIfChanged(join(generatedDir, output.defaultExamples.name), output.defaultExamples.json);
      await writeIfChanged(join(generatedDir, output.index.name), output.index.json);
      lazy = output.perTokenizer;
    },
    generateBundle() {
      for (const file of lazy) this.emitFile({ type: 'asset', fileName: `examples/${file.name}`, source: file.json });
    },
    configureServer(server) {
      server.middlewares.use((req, res, next) => {
        const path = (req.url ?? '').split('?')[0] ?? '';
        const file = path.startsWith(EXAMPLES_PREFIX)
          ? lazy.find((f) => `${EXAMPLES_PREFIX}${f.name}` === path)
          : undefined;
        if (file === undefined) {
          next();
          return;
        }
        sendBytes(res, new TextEncoder().encode(file.json), 'application/json');
      });
    },
  };
}
