/**
 * `pnpm generate`: writes the gitignored `src/generated/*.json` that app code imports — `examples-default.json`,
 * `examples-index.json` (the `examples()` plugin's `buildStart` output) and `licences.json` (the `licences()` plugin's),
 * plus the board's `src/board/grid-classes.css` — through the same `@tsbs/vocab-tools` functions, so lint, typecheck and
 * the unit tests work before any Vite build. The Vite plugins still regenerate these files at the start of every
 * `vite build`/`vite dev`; both write only on change.
 *
 * PA-8: it also writes the Worker's `packages/worker/src/generated/{vocab-manifest,engine-config}.json` (the built
 * manifest, or an empty shell when `data/vocab/dist` is absent, so typecheck never depends on a vocabulary build).
 */
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';
import { generateExamples, generateLicences, MANIFEST_FILE, stableJson } from '@tsbs/vocab-tools';
import { isFile, writeIfChanged } from '@tsbs/vocab-tools/vite-support';
import { gridClassesCss } from './grid-classes.ts';
import { emptyManifest, writeWorkerGenerated } from './vocab-assets.ts';

const repo = fileURLToPath(new URL('../../../', import.meta.url));
const generated = join(repo, 'apps', 'web', 'src', 'generated');

const { output, warning } = await generateExamples({
  fixtures: join(repo, 'fixtures'),
  chips: join(repo, 'packages', 'registry', 'data', 'examples.json'),
});
if (warning !== null) console.warn(`generate: ${warning}`);
await writeIfChanged(join(generated, output.defaultExample.name), output.defaultExample.json);
await writeIfChanged(join(generated, output.index.name), output.index.json);

const licences = await generateLicences(
  {
    manifest: join(repo, 'tools', 'oracle', 'manifest.json'),
    licenses: join(repo, 'docs', 'licenses'),
    vocabManifest: join(repo, 'data', 'vocab', 'dist', MANIFEST_FILE),
  },
  process.env,
);
await writeIfChanged(join(generated, 'licences.json'), stableJson(licences));

const builtManifest = join(repo, 'data', 'vocab', 'dist', MANIFEST_FILE);
await writeWorkerGenerated(
  join(repo, 'packages', 'worker', 'src', 'generated'),
  (await isFile(builtManifest)) ? await readFile(builtManifest) : `${JSON.stringify(emptyManifest(), null, 2)}\n`,
);

// The board's placement classes (.c1…c64 / .s1…s64, AD-15), also written by the gridClasses() plugin, so the component tests
// and svelte-check see the stylesheet without a Vite build.
await writeIfChanged(join(repo, 'apps', 'web', 'src', 'board', 'grid-classes.css'), gridClassesCss());
