/**
 * `lazyChunks()` — names every JS chunk that the `/` page does not load at startup `<assetsDir>/lazy-[name]-[hash].js`,
 * so size-limit.json can leave them out of the Main JS budget (06 §3: the initial shell of `/`, ≤ 55 KB brotli) by name.
 * A chunk is initial when it holds at least one module `index.html` reaches through static imports — `/` cannot import
 * any other chunk statically. The rest arrive by `import()` (the picker and help dialogs, the deferred tokenizer client,
 * the data only they and About use) or belong to the other pages. Entry chunks keep `entryFileNames`.
 */
import { normalizePath, type Plugin } from 'vite';

/** Module ids reachable from `entry` through static imports, `entry` included. */
export function staticClosure(entry: string, importedIds: (id: string) => readonly string[] | undefined): Set<string> {
  const seen = new Set<string>();
  const queue = [entry];
  for (let id = queue.pop(); id !== undefined; id = queue.pop()) {
    if (seen.has(id)) continue;
    seen.add(id);
    queue.push(...(importedIds(id) ?? []));
  }
  return seen;
}

/** The `chunkFileNames` pattern of a chunk holding `moduleIds`, given the initial modules of `/`. */
export function chunkFileName(moduleIds: readonly string[], initial: ReadonlySet<string>, assetsDir: string): string {
  const prefix = moduleIds.some((id) => initial.has(id)) ? '' : 'lazy-';
  return `${assetsDir}/${prefix}[name]-[hash].js`;
}

/** `entry`: the absolute path of `index.html` (the `main` Rollup input). */
export function lazyChunks(entry: string): Plugin {
  const entryId = normalizePath(entry);
  let assetsDir = 'assets';
  let initial: ReadonlySet<string> = new Set();
  return {
    name: 'tsbs:lazy-chunks',
    apply: 'build',
    configResolved(config) {
      assetsDir = config.build.assetsDir;
    },
    buildEnd() {
      initial = staticClosure(entryId, (id) => this.getModuleInfo(id)?.importedIds);
      if (initial.size === 1) this.error(`lazy-chunks: ${entryId} has no static imports (wrong entry path?)`);
    },
    outputOptions(options) {
      return { ...options, chunkFileNames: (chunk) => chunkFileName(chunk.moduleIds, initial, assetsDir) };
    },
  };
}
