/**
 * The tokenizer Worker's entry (02 §5, PA-8). `apps/web` constructs it with the Vite worker import
 * `import TokWorker from '@tsbs/worker/entry?worker'` (`worker.format: 'es'`), never a bare specifier inside
 * `new URL(…)`; Vite emits it as `assets/entry-[hash].js` (≤ 12 KB brotli, 06 §3).
 *
 * This is the ONLY module that imports the generated files: `./generated/vocab-manifest.json` (the converter's
 * manifest, bundled per AD-11) and `./generated/engine-config.json` (the registry fields the engine factories read),
 * both written by `apps/web/plugins/{vocab-assets,generate}.ts`. The engine families are separate chunks
 * (`bytelevel-[hash].js`, `spm-[hash].js`) imported on a family's first load, so no engine code is in this chunk.
 */
import type { VocabManifest } from '@tsbs/core/format/types';
import type { Family } from '@tsbs/core/model/result';
import { asEngineFactory, type EngineConfig, type EngineFactory } from './engine-config.ts';
import engineConfigJson from './generated/engine-config.json' with { type: 'json' };
import manifestJson from './generated/vocab-manifest.json' with { type: 'json' };
import { startHost } from './host.ts';

/** Lazy engine import per family (04 §6 rule 5). */
async function importEngine(family: Family): Promise<EngineFactory> {
  return family === 'bytelevel-bpe'
    ? asEngineFactory((await import('./engines/bytelevel.ts')).createByteLevelTokenizer)
    : asEngineFactory((await import('./engines/spm.ts')).createSpmTokenizer);
}

startHost(self, {
  // Both files are generated from validated sources: the converter's manifest (FROZEN `VocabManifest`) and the
  // zod-checked registry (`registry:check`); JSON imports widen literal types, hence the assertions.
  manifest: manifestJson as unknown as VocabManifest,
  engineConfig: engineConfigJson as unknown as EngineConfig,
  importEngine,
});
