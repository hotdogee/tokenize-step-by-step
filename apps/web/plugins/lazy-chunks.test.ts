import { describe, expect, it } from 'vitest';
import { chunkFileName, staticClosure } from './lazy-chunks.ts';

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

describe('chunkFileName', () => {
  const initial = staticClosure('index.html', (id) => GRAPH[id]);

  it('keeps the plain name for any chunk holding a module of the initial shell', () => {
    expect(chunkFileName(['registry.ts', 'registry-details.ts'], initial, 'assets')).toBe('assets/[name]-[hash].js');
  });

  it('prefixes lazy- for chunks `/` can only reach by import() or never loads', () => {
    expect(chunkFileName(['PickerDialog.svelte'], initial, 'assets')).toBe('assets/lazy-[name]-[hash].js');
    expect(chunkFileName(['registry-details.ts'], initial, 'static')).toBe('static/lazy-[name]-[hash].js');
  });
});
