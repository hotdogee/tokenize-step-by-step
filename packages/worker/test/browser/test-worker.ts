/**
 * A Worker entry for the browser tests: the real host, loader and engine importer of `src/entry.ts`, but configured by
 * the first message (`__config`: a manifest the test may alter, e.g. a corrupted path) and reporting the host's test
 * hooks (`__hook`) and its own resource-timing entries (`__resources`, the engine chunks' network log) to the page.
 */
import type { VocabManifest } from '@tsbs/core/format/types';
import type { Family } from '@tsbs/core/model/result';
import type { ToWorker } from '@tsbs/core/protocol';
import { asEngineFactory, type EngineConfig, type EngineFactory } from '../../src/engine-config.ts';
import { createHost, type Host } from '../../src/host.ts';

/** Messages only this test entry understands. */
export type TestControl =
  | {
      readonly type: '__config';
      readonly manifest: VocabManifest;
      readonly engineConfig: EngineConfig;
      /** Prepends this many 4 ms busy slices (each yielding progress) to every encode: a slow engine. */
      readonly slowSlices?: number;
    }
  | { readonly type: '__resources' };

/** Wraps a factory so every encode first spends `slices` × 4 ms in slices that yield, like a long CJK merge. */
function slowed(factory: EngineFactory, slices: number): EngineFactory {
  return async (tsbv, entry) => {
    const tokenizer = await factory(tsbv, entry);
    return {
      info: tokenizer.info,
      encode: (text, options) => tokenizer.encode(text, options),
      tokenBytes: (id) => tokenizer.tokenBytes(id),
      pieceString: (id) => tokenizer.pieceString(id),
      idOf: (bytes) => tokenizer.idOf(bytes),
      pretokenize: (text) => tokenizer.pretokenize(text),
      dispose: () => {
        tokenizer.dispose();
      },
      *encodeIncremental(text, options, budgetMs = 4) {
        for (let i = 0; i < slices; i++) {
          const end = performance.now() + budgetMs;
          while (performance.now() < end) {
            // a merge slice
          }
          yield { bytesDone: i, bytesTotal: slices };
        }
        return yield* tokenizer.encodeIncremental(text, options, budgetMs);
      },
    };
  };
}

interface Scope {
  postMessage(message: unknown, transfer?: Transferable[]): void;
  addEventListener(type: 'message', listener: (event: MessageEvent) => void): void;
  readonly performance: { getEntriesByType(type: 'resource'): ReadonlyArray<{ readonly name: string }> };
}

const scope = self as unknown as Scope;

async function importEngine(family: Family): Promise<EngineFactory> {
  return family === 'bytelevel-bpe'
    ? asEngineFactory((await import('../../src/engines/bytelevel.ts')).createByteLevelTokenizer)
    : asEngineFactory((await import('../../src/engines/spm.ts')).createSpmTokenizer);
}

let host: Host | null = null;

scope.addEventListener('message', (event) => {
  const data = event.data as TestControl | ToWorker;
  if (data.type === '__resources') {
    scope.postMessage({
      type: '__resources',
      names: scope.performance.getEntriesByType('resource').map((e) => e.name),
    });
    return;
  }
  if (data.type === '__config') {
    const slices = data.slowSlices ?? 0;
    host = createHost({
      manifest: data.manifest,
      engineConfig: data.engineConfig,
      importEngine: slices === 0 ? importEngine : async (family) => slowed(await importEngine(family), slices),
      post: (message, transfer) => {
        scope.postMessage(message, transfer);
      },
      hooks: {
        onLoadStart: (e) => {
          scope.postMessage({
            type: '__hook',
            event: 'load-start',
            tokenizer: e.tokenizer,
            tablesReleased: e.tablesReleased,
          });
        },
        onRelease: (tokenizer) => {
          scope.postMessage({ type: '__hook', event: 'release', tokenizer });
        },
      },
    });
    return;
  }
  host?.handle(data);
});
