/**
 * `lazyChunks()` — names every JS chunk that the `/` page does not load at startup `<assetsDir>/lazy-[name]-[hash].js`,
 * so size-limit.json can leave them out of the Main JS budget (06 §3: the initial shell of `/`) by name. Entry chunks
 * keep `entryFileNames`.
 *
 * Two passes:
 *
 * 1. `chunkFileNames` (before rendering) guesses from the module graph: a chunk is initial when it holds a module that
 *    `index.html` reaches through static imports. That closure is computed BEFORE tree-shaking, so it over-approximates:
 *    Svelte's `internal/client` index re-exports every binding helper, so a lazily imported component that is the only
 *    user of `bind:value` / `bind:group` gets a chunk holding Svelte's bindings module — "initial" by this test, although
 *    `/` never loads it (WP10 found it; byok avoided `bind:` for that reason).
 * 2. `generateBundle` (after rendering, `order: 'post'`) settles it on the rendered chunk graph: the initial chunks are
 *    the `index.html` entry chunk and every chunk it imports statically, transitively (`OutputChunk.imports`). Any chunk
 *    whose prefix disagrees is renamed, and every reference to its file name — chunk code (static and dynamic imports,
 *    Vite's preload dependency lists), chunk metadata, HTML and CSS assets — is rewritten. The file name carries the
 *    content hash, so a plain string replacement cannot hit anything else.
 */
import { normalizePath, type Plugin, type Rollup } from 'vite';

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

/** The `chunkFileNames` pattern of a chunk holding `moduleIds`, given the initial modules of `/` (pass 1). */
export function chunkFileName(moduleIds: readonly string[], initial: ReadonlySet<string>, assetsDir: string): string {
  const prefix = moduleIds.some((id) => initial.has(id)) ? '' : 'lazy-';
  return `${assetsDir}/${prefix}[name]-[hash].js`;
}

/** The fields of a Rollup output chunk that pass 2 reads and rewrites (an `OutputChunk` satisfies it). */
export interface ChunkLike {
  readonly type: 'chunk';
  fileName: string;
  readonly isEntry: boolean;
  readonly facadeModuleId: string | null;
  code: string;
  imports: string[];
  dynamicImports: string[];
  implicitlyLoadedBefore: string[];
  importedBindings: Record<string, string[]>;
  referencedFiles: string[];
  map: { file: string } | null;
}

/** The fields of a Rollup output asset that pass 2 reads and rewrites. */
export interface AssetLike {
  readonly type: 'asset';
  fileName: string;
  source: string | Uint8Array;
}

export type BundleLike = Record<string, ChunkLike | AssetLike>;

/** File names of the chunks `/` loads at startup: its entry chunk and everything that imports statically. */
export function initialChunkFiles(bundle: Readonly<BundleLike>, entryId: string): Set<string> {
  const entry = Object.values(bundle).find(
    (file): file is ChunkLike =>
      file.type === 'chunk' && file.isEntry && normalizePath(file.facadeModuleId ?? '') === entryId,
  );
  if (entry === undefined) return new Set();
  return staticClosure(entry.fileName, (name) => {
    const file = bundle[name];
    return file?.type === 'chunk' ? file.imports : undefined;
  });
}

const baseName = (fileName: string): string => fileName.slice(fileName.lastIndexOf('/') + 1);
const dirOf = (fileName: string): string => fileName.slice(0, fileName.lastIndexOf('/') + 1);

/**
 * Old → new file name for every non-entry chunk in `assetsDir` whose `lazy-` prefix disagrees with `initial`
 * (the rendered graph): plain-named chunks `/` does not load gain the prefix, `lazy-` chunks it does load lose it.
 */
export function plannedRenames(
  bundle: Readonly<BundleLike>,
  initial: ReadonlySet<string>,
  assetsDir: string,
): Map<string, string> {
  const renames = new Map<string, string>();
  for (const file of Object.values(bundle)) {
    if (file.type !== 'chunk' || file.isEntry || !file.fileName.startsWith(`${assetsDir}/`)) continue;
    const base = baseName(file.fileName);
    const lazy = base.startsWith('lazy-');
    const wantLazy = !initial.has(file.fileName);
    if (lazy === wantLazy) continue;
    renames.set(file.fileName, `${dirOf(file.fileName)}${wantLazy ? `lazy-${base}` : base.slice('lazy-'.length)}`);
  }
  return renames;
}

/** Replaces every occurrence of each old base name in `text` (longest first, so no name is a prefix of another hit). */
function rewrite(text: string, pairs: ReadonlyArray<readonly [string, string]>): string {
  let out = text;
  for (const [from, to] of pairs) out = out.split(from).join(to);
  return out;
}

/** Applies `renames` to `bundle` in place: keys, file names, code, chunk metadata and text assets. */
export function applyRenames(bundle: BundleLike, renames: ReadonlyMap<string, string>): void {
  if (renames.size === 0) return;
  // Placeholder tokens first, so a rename chain (a → b while b → c) can never apply twice.
  const pairs = [...renames].map(([from, to], i) => ({ from, to, token: `\u0000tsbs-lazy-${String(i)}\u0000` }));
  const toToken = pairs
    .map(({ from, token }) => [baseName(from), token] as const)
    .sort((a, b) => b[0].length - a[0].length);
  const fromToken = pairs.map(({ to, token }) => [token, baseName(to)] as const);
  const swap = (text: string): string => rewrite(rewrite(text, toToken), fromToken);
  const mapName = (name: string): string => renames.get(name) ?? name;
  const files = Object.values(bundle);
  for (const key of Object.keys(bundle)) Reflect.deleteProperty(bundle, key);
  for (const file of files) {
    file.fileName = mapName(file.fileName);
    if (file.type === 'chunk') {
      file.code = swap(file.code);
      file.imports = file.imports.map(mapName);
      file.dynamicImports = file.dynamicImports.map(mapName);
      file.implicitlyLoadedBefore = file.implicitlyLoadedBefore.map(mapName);
      file.referencedFiles = file.referencedFiles.map(mapName);
      file.importedBindings = Object.fromEntries(
        Object.entries(file.importedBindings).map(([name, bindings]) => [mapName(name), bindings]),
      );
      if (file.map !== null) file.map.file = baseName(file.fileName);
    } else if (typeof file.source === 'string') {
      file.source = swap(file.source);
    }
    bundle[file.fileName] = file;
  }
}

/** `entry`: the absolute path of `index.html` (the `main` Rollup input). */
export function lazyChunks(entry: string): Plugin {
  const entryId = normalizePath(entry);
  let assetsDir = 'assets';
  let initial: ReadonlySet<string> = new Set();
  return {
    name: 'tsbs:lazy-chunks',
    apply: 'build',
    enforce: 'post',
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
    generateBundle: {
      order: 'post',
      handler(_options, bundle: Rollup.OutputBundle) {
        // Rollup's output types are structurally ChunkLike / AssetLike (the fields pass 2 touches are all mutable).
        const files = bundle as unknown as BundleLike;
        const chunks = initialChunkFiles(files, entryId);
        if (chunks.size === 0) this.error(`lazy-chunks: no entry chunk for ${entryId}`);
        applyRenames(files, plannedRenames(files, chunks, assetsDir));
      },
    },
  };
}
