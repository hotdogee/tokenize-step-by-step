import { describe, expect, it } from 'vitest';
import {
  applyRenames,
  chunkFileName,
  initialChunkFiles,
  plannedRenames,
  staticClosure,
  type AssetLike,
  type BundleLike,
  type ChunkLike,
} from './lazy-chunks.ts';

/** index.html → main.ts → {App, registry}; App imports the picker with import() (not an importedId); about is separate. */
const GRAPH: Readonly<Record<string, readonly string[]>> = {
  'index.html': ['main.ts'],
  'main.ts': ['App.svelte', 'registry.ts'],
  'App.svelte': ['registry.ts', 'Header.svelte'],
  'Header.svelte': ['App.svelte'],
  'PickerDialog.svelte': ['registry.ts', 'registry-details.ts'],
  'about/index.html': ['about.ts'],
  'about.ts': ['registry.ts', 'registry-details.ts'],
};

describe('staticClosure', () => {
  it('follows static imports only, through cycles', () => {
    expect([...staticClosure('index.html', (id) => GRAPH[id])].sort()).toEqual([
      'App.svelte',
      'Header.svelte',
      'index.html',
      'main.ts',
      'registry.ts',
    ]);
  });
});

describe('chunkFileName (pass 1, before rendering)', () => {
  const initial = staticClosure('index.html', (id) => GRAPH[id]);

  it('keeps the plain name for any chunk holding a module of the initial shell', () => {
    expect(chunkFileName(['registry.ts', 'registry-details.ts'], initial, 'assets')).toBe('assets/[name]-[hash].js');
  });

  it('prefixes lazy- for chunks `/` can only reach by import() or never loads', () => {
    expect(chunkFileName(['PickerDialog.svelte'], initial, 'assets')).toBe('assets/lazy-[name]-[hash].js');
    expect(chunkFileName(['registry-details.ts'], initial, 'static')).toBe('static/lazy-[name]-[hash].js');
  });
});

/** A rendered chunk. */
function chunk(fileName: string, code: string, imports: string[] = [], extra: Partial<ChunkLike> = {}): ChunkLike {
  return {
    type: 'chunk',
    fileName,
    isEntry: false,
    facadeModuleId: null,
    code,
    imports,
    dynamicImports: [],
    implicitlyLoadedBefore: [],
    importedBindings: Object.fromEntries(imports.map((name) => [name, ['x']])),
    referencedFiles: [],
    map: { file: fileName.slice(fileName.lastIndexOf('/') + 1) },
    ...extra,
  };
}

function asset(fileName: string, source: string): AssetLike {
  return { type: 'asset', fileName, source };
}

/**
 * The case pass 1 gets wrong: the drawer body (lazy) is the only user of Svelte's `bind:value`, so Rollup puts Svelte's
 * bindings module into the drawer's chunk — and that module IS in index.html's pre-tree-shaking closure (Svelte's
 * internal index re-exports it), so pass 1 named the chunk plain. On the rendered graph `/` never imports it statically.
 */
function bindingsBundle(): BundleLike {
  const files: Array<ChunkLike | AssetLike> = [
    chunk(
      'assets/main-AAAA1111.js',
      'import{h}from"./Header-BBBB2222.js";const d=()=>import("./LiveCheckBody-CCCC3333.js");',
      ['assets/Header-BBBB2222.js'],
      {
        isEntry: true,
        facadeModuleId: '/repo/apps/web/index.html',
        dynamicImports: ['assets/LiveCheckBody-CCCC3333.js'],
      },
    ),
    chunk('assets/Header-BBBB2222.js', 'export const h=1;'),
    chunk('assets/LiveCheckBody-CCCC3333.js', 'import{h}from"./Header-BBBB2222.js";export function bind_value(){}', [
      'assets/Header-BBBB2222.js',
    ]),
    chunk('assets/lazy-PickerDialog-DDDD4444.js', 'import{h}from"./Header-BBBB2222.js";', [
      'assets/Header-BBBB2222.js',
    ]),
    chunk(
      'assets/about-EEEE5555.js',
      'import{h}from"./Header-BBBB2222.js";import"./LiveCheckBody-CCCC3333.js";',
      ['assets/Header-BBBB2222.js', 'assets/LiveCheckBody-CCCC3333.js'],
      { isEntry: true, facadeModuleId: '/repo/apps/web/about/index.html' },
    ),
    asset(
      'about/index.html',
      '<link rel="modulepreload" href="/assets/Header-BBBB2222.js"><link rel="modulepreload" href="/assets/LiveCheckBody-CCCC3333.js">',
    ),
    asset('assets/main-FFFF6666.css', '.x{}'),
  ];
  return Object.fromEntries(files.map((file) => [file.fileName, file]));
}

describe('initialChunkFiles (pass 2, the rendered graph)', () => {
  it('is the index.html entry chunk and its static imports, never its dynamic ones', () => {
    expect([...initialChunkFiles(bindingsBundle(), '/repo/apps/web/index.html')].sort()).toEqual([
      'assets/Header-BBBB2222.js',
      'assets/main-AAAA1111.js',
    ]);
  });

  it('is empty when the entry is not in the bundle', () => {
    expect(initialChunkFiles(bindingsBundle(), '/elsewhere/index.html').size).toBe(0);
  });
});

describe('plannedRenames + applyRenames', () => {
  it('renames a lazy chunk that holds Svelte bindings to lazy-* and rewrites every reference', () => {
    const bundle = bindingsBundle();
    const initial = initialChunkFiles(bundle, '/repo/apps/web/index.html');
    const renames = plannedRenames(bundle, initial, 'assets');
    expect([...renames]).toEqual([['assets/LiveCheckBody-CCCC3333.js', 'assets/lazy-LiveCheckBody-CCCC3333.js']]);
    applyRenames(bundle, renames);

    expect(Object.keys(bundle)).toContain('assets/lazy-LiveCheckBody-CCCC3333.js');
    expect(Object.keys(bundle)).not.toContain('assets/LiveCheckBody-CCCC3333.js');
    const body = bundle['assets/lazy-LiveCheckBody-CCCC3333.js'];
    expect(body?.fileName).toBe('assets/lazy-LiveCheckBody-CCCC3333.js');
    expect(body?.type === 'chunk' ? body.map?.file : null).toBe('lazy-LiveCheckBody-CCCC3333.js');

    const main = bundle['assets/main-AAAA1111.js'];
    if (main?.type !== 'chunk') throw new Error('main');
    expect(main.code).toContain('import("./lazy-LiveCheckBody-CCCC3333.js")');
    expect(main.dynamicImports).toEqual(['assets/lazy-LiveCheckBody-CCCC3333.js']);

    const about = bundle['assets/about-EEEE5555.js'];
    if (about?.type !== 'chunk') throw new Error('about');
    expect(about.code).toContain('import"./lazy-LiveCheckBody-CCCC3333.js"');
    expect(about.imports).toContain('assets/lazy-LiveCheckBody-CCCC3333.js');
    expect(Object.keys(about.importedBindings)).toContain('assets/lazy-LiveCheckBody-CCCC3333.js');

    const html = bundle['about/index.html'];
    expect(html?.type === 'asset' ? html.source : '').toContain('href="/assets/lazy-LiveCheckBody-CCCC3333.js"');
    // Already-correct names are untouched.
    expect(Object.keys(bundle)).toContain('assets/Header-BBBB2222.js');
    expect(Object.keys(bundle)).toContain('assets/lazy-PickerDialog-DDDD4444.js');
  });

  it('drops the prefix from a lazy-* chunk that `/` loads at startup', () => {
    const bundle = bindingsBundle();
    const header = bundle['assets/Header-BBBB2222.js'];
    if (header?.type !== 'chunk') throw new Error('header');
    const renames = plannedRenames(
      bundle,
      new Set(['assets/main-AAAA1111.js', 'assets/lazy-PickerDialog-DDDD4444.js']),
      'assets',
    );
    expect(renames.get('assets/lazy-PickerDialog-DDDD4444.js')).toBe('assets/PickerDialog-DDDD4444.js');
    // Header is not in that (synthetic) initial set, so it would become lazy; entries never change.
    expect(renames.get('assets/Header-BBBB2222.js')).toBe('assets/lazy-Header-BBBB2222.js');
    expect(renames.has('assets/main-AAAA1111.js')).toBe(false);
    expect(renames.has('assets/about-EEEE5555.js')).toBe(false);
  });

  it('applies a chain of renames exactly once', () => {
    const bundle: BundleLike = {
      'assets/a-1.js': chunk('assets/a-1.js', 'import"./b-2.js";import"./lazy-c-3.js";', [
        'assets/b-2.js',
        'assets/lazy-c-3.js',
      ]),
      'assets/b-2.js': chunk('assets/b-2.js', ''),
      'assets/lazy-c-3.js': chunk('assets/lazy-c-3.js', ''),
    };
    applyRenames(
      bundle,
      new Map([
        ['assets/b-2.js', 'assets/lazy-b-2.js'],
        ['assets/lazy-c-3.js', 'assets/c-3.js'],
      ]),
    );
    const a = bundle['assets/a-1.js'];
    expect(a?.type === 'chunk' ? a.code : '').toBe('import"./lazy-b-2.js";import"./c-3.js";');
    expect(Object.keys(bundle).sort()).toEqual(['assets/a-1.js', 'assets/c-3.js', 'assets/lazy-b-2.js']);
  });
});
