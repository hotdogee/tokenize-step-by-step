/**
 * `vocabAssets()` — WP00 minimal version. At build time it copies `data/vocab/dist/tok/**` (the converter's output, 03 §C.5)
 * into `dist/tok/`; before WP03 there is nothing to copy and `check:dist` cross-checks the empty manifest.
 *
 * WP03 completes it: emit `src/generated/vocab-manifest.json` for the Worker chunk (AD-11) and serve `/tok` from
 * `data/vocab/dist` in `vite dev` (falling back to the dev loaders when it is missing, 02 §5).
 */
import { cp, stat } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import type { Plugin } from 'vite';

export interface VocabAssetsOptions {
  /** Converter output directory, relative to the Vite root. */
  readonly vocabDist?: string;
}

async function isDirectory(path: string): Promise<boolean> {
  return stat(path).then(
    (s) => s.isDirectory(),
    () => false,
  );
}

export function vocabAssets(options: VocabAssetsOptions = {}): Plugin {
  let source = '';
  let target = '';
  return {
    name: 'tsbs:vocab-assets',
    apply: 'build',
    configResolved(config) {
      source = join(resolve(config.root, options.vocabDist ?? '../../data/vocab/dist'), 'tok');
      target = join(resolve(config.root, config.build.outDir), 'tok');
    },
    async writeBundle() {
      if (await isDirectory(source)) await cp(source, target, { recursive: true });
    },
  };
}
