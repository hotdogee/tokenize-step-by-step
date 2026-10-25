/**
 * `licences()` (WP03; 03 §B.7, 05 §14) — the About page's licence data and texts:
 *
 * - `buildStart`: writes `src/generated/licences.json` (gitignored) — `licences.generated.json` content generated from
 *   `tools/oracle/manifest.json` + `docs/licenses/**`, with the shipped `.bin` facts when `data/vocab/dist` exists.
 * - `writeBundle`: copies every listed licence text of the `ship` assets to `dist/licenses/<assetId>/`, plus the
 *   converter's `MODIFIED-<assetId>.txt` notices.
 * - `vite dev`: serves the same paths under `/licenses/`.
 */
import { copyFile, mkdir, readFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { generateLicences, MANIFEST_FILE, stableJson, type LicencesGenerated } from '@tsbs/vocab-tools';
import { isFile, sendBytes, writeIfChanged } from '@tsbs/vocab-tools/vite-support';
import type { Plugin } from 'vite';

export interface LicencesPluginOptions {
  /** Paths relative to the Vite root. */
  readonly oracleManifest?: string;
  readonly licensesDir?: string;
  readonly vocabDist?: string;
  readonly out?: string;
}

/** Site path → source file for every text the licences document lists (+ MODIFIED notices that exist). */
export async function licenceFiles(
  licences: LicencesGenerated,
  licensesDir: string,
  vocabDist: string,
): Promise<Map<string, string>> {
  const files = new Map<string, string>();
  for (const asset of licences.assets) {
    for (const text of asset.texts) files.set(text.path, join(licensesDir, asset.assetId, ...text.name.split('/')));
    if (asset.modified !== null) {
      const source = join(vocabDist, 'licenses', asset.assetId, `MODIFIED-${asset.assetId}.txt`);
      if (await isFile(source)) files.set(asset.modified.path, source);
    }
  }
  return files;
}

export function licences(options: LicencesPluginOptions = {}): Plugin {
  let oracleManifest = '';
  let licensesDir = '';
  let vocabDist = '';
  let out = '';
  let outDir = '';
  let files = new Map<string, string>();

  return {
    name: 'tsbs:licences',
    configResolved(config) {
      oracleManifest = resolve(config.root, options.oracleManifest ?? '../../tools/oracle/manifest.json');
      licensesDir = resolve(config.root, options.licensesDir ?? '../../docs/licenses');
      vocabDist = resolve(config.root, options.vocabDist ?? '../../data/vocab/dist');
      out = resolve(config.root, options.out ?? 'src/generated/licences.json');
      outDir = resolve(config.root, config.build.outDir);
    },
    async buildStart() {
      const generated = await generateLicences(
        { manifest: oracleManifest, licenses: licensesDir, vocabManifest: join(vocabDist, MANIFEST_FILE) },
        process.env,
      );
      await writeIfChanged(out, stableJson(generated));
      files = await licenceFiles(generated, licensesDir, vocabDist);
    },
    async writeBundle() {
      for (const [path, source] of files) {
        const target = join(outDir, ...path.slice(1).split('/'));
        await mkdir(dirname(target), { recursive: true });
        await copyFile(source, target);
      }
    },
    configureServer(server) {
      server.middlewares.use((req, res, next) => {
        const source = files.get((req.url ?? '').split('?')[0] ?? '');
        if (source === undefined) {
          next();
          return;
        }
        readFile(source).then(
          (body) => {
            sendBytes(res, body, 'text/plain; charset=utf-8');
          },
          () => {
            next();
          },
        );
      });
    },
  };
}
