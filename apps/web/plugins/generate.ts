/**
 * `pnpm generate`: writes the gitignored `src/generated/*.json` that app code imports — `examples-default.json`,
 * `examples-index.json` (the `examples()` plugin's `buildStart` output) and `licences.json` (the `licences()` plugin's) —
 * through the same `@tsbs/vocab-tools` functions, so lint, typecheck and the unit tests work before any Vite build. The
 * Vite plugins still regenerate these files at the start of every `vite build`/`vite dev`; both write only on change.
 */
import { join } from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';
import { generateExamples, generateLicences, MANIFEST_FILE, stableJson } from '@tsbs/vocab-tools';
import { writeIfChanged } from '@tsbs/vocab-tools/vite-support';

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
