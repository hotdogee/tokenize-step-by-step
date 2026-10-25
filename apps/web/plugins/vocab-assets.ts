/**
 * `vocabAssets()` (WP03; 02 §5, AD-11) — connects the converter output to the site:
 *
 * - `buildStart` (build and dev): writes `src/generated/vocab-manifest.json` (gitignored) for the Worker chunk to import,
 *   copied from `data/vocab/dist/vocab-manifest.generated.json` (`pnpm vocab:build` writes it before `vite build`).
 * - `writeBundle`: copies `data/vocab/dist/tok/**` into `dist/tok/`.
 * - `vite dev`: serves `/tok/*` from `data/vocab/dist`; when that does not exist, converts the raw vocabularies in
 *   memory with the dev loaders' pipeline (`buildInMemory`, SHA-256-verified, conformance off) so engine work never
 *   waits for the converter. Without raw files either, the manifest is empty.
 */
import { readFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { MANIFEST_FILE } from '@tsbs/vocab-tools';
import { buildInMemory } from '@tsbs/vocab-tools/dev';
import { copyTree, isFile, resolveUnder, sendBytes, writeIfChanged } from '@tsbs/vocab-tools/vite-support';
import type { Plugin } from 'vite';

export interface VocabAssetsOptions {
  /** Converter output directory, relative to the Vite root. */
  readonly vocabDist?: string;
  /** Raw vocabularies and the oracle manifest (dev fallback), relative to the Vite root. */
  readonly raw?: string;
  readonly oracleManifest?: string;
  /** Generated manifest for the Worker, relative to the Vite root. */
  readonly out?: string;
}

const OCTET = 'application/octet-stream';

/** The manifest written when nothing has been converted yet (a `VocabManifest` with no assets). */
export function emptyManifest(): { schema: 1; builtOn: string; generator: string; assets: Record<string, never> } {
  return { schema: 1, builtOn: '1970-01-01', generator: 'none', assets: {} };
}

export function vocabAssets(options: VocabAssetsOptions = {}): Plugin {
  let distDir = '';
  let rawDir = '';
  let oracleManifest = '';
  let out = '';
  let outDir = '';
  let serving = false;
  let memory: Map<string, Uint8Array> | null = null;

  return {
    name: 'tsbs:vocab-assets',
    configResolved(config) {
      distDir = resolve(config.root, options.vocabDist ?? '../../data/vocab/dist');
      rawDir = resolve(config.root, options.raw ?? '../../data/vocab/raw');
      oracleManifest = resolve(config.root, options.oracleManifest ?? '../../tools/oracle/manifest.json');
      out = resolve(config.root, options.out ?? 'src/generated/vocab-manifest.json');
      outDir = resolve(config.root, config.build.outDir);
      serving = config.command === 'serve';
    },
    async buildStart() {
      const built = join(distDir, MANIFEST_FILE);
      if (await isFile(built)) {
        await writeIfChanged(out, await readFile(built));
        return;
      }
      if (serving && memory === null) {
        const result = await buildInMemory({ raw: rawDir, manifest: oracleManifest });
        memory = new Map(result.files);
        for (const line of result.skipped) this.warn(`dev fallback skipped ${line}`);
        await writeIfChanged(out, `${JSON.stringify(result.manifest, null, 2)}\n`);
        return;
      }
      if (!serving) this.warn(`${built} is missing — run pnpm vocab:build; the site is built without vocabularies`);
      if (memory === null) await writeIfChanged(out, `${JSON.stringify(emptyManifest(), null, 2)}\n`);
    },
    async writeBundle() {
      await copyTree(join(distDir, 'tok'), join(outDir, 'tok'));
    },
    configureServer(server) {
      server.middlewares.use((req, res, next) => {
        const url = req.url ?? '';
        if (!url.startsWith('/tok/')) {
          next();
          return;
        }
        const fromMemory = memory?.get(url.split('?')[0] ?? '');
        if (fromMemory !== undefined) {
          sendBytes(res, fromMemory, OCTET);
          return;
        }
        const file = resolveUnder(join(distDir, 'tok'), '/tok/', url);
        if (file === null) {
          next();
          return;
        }
        readFile(file).then(
          (body) => {
            sendBytes(res, body, OCTET);
          },
          () => {
            next();
          },
        );
      });
    },
  };
}
