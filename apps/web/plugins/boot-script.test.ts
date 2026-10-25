import { fileURLToPath } from 'node:url';
import { runInNewContext } from 'node:vm';
import { brotliCompressSync } from 'node:zlib';
import { beforeAll, describe, expect, it } from 'vitest';
import { bootFileName, compileBoot } from './boot-script.ts';

const ENTRY = fileURLToPath(new URL('../src/app/boot.ts', import.meta.url));

interface BootEnv {
  readonly search?: string;
  readonly languages?: readonly string[];
  readonly storage?: Readonly<Record<string, string>> | 'throws';
}

/** Runs the compiled boot script against a minimal fake browser and returns what it wrote on <html>. */
function run(code: string, env: BootEnv): { lang: string; theme: string | undefined; cellSize: string | undefined } {
  const html = { lang: '', dataset: {} as Record<string, string> };
  const store = env.storage;
  runInNewContext(code, {
    document: { documentElement: html },
    location: { search: env.search ?? '' },
    navigator: { languages: env.languages ?? [] },
    URLSearchParams,
    localStorage: {
      getItem(key: string): string | null {
        if (store === 'throws') throw new Error('SecurityError');
        return store?.[key] ?? null;
      },
    },
  });
  return { lang: html.lang, theme: html.dataset['theme'], cellSize: html.dataset['cellSize'] };
}

describe('bootScript()', () => {
  let code = '';
  beforeAll(async () => {
    code = await compileBoot(ENTRY);
  });

  it('compiles boot.ts to a self-contained IIFE within the 0.5 KB budget (06 §3)', () => {
    expect(code).not.toMatch(/\b(?:import|export)\b/);
    expect(brotliCompressSync(code).length).toBeLessThanOrEqual(512);
  });

  it('names the asset by content hash (deterministic)', () => {
    expect(bootFileName(code, 'assets')).toMatch(/^assets\/boot-[0-9a-f]{8}\.js$/);
    expect(bootFileName(code, 'assets')).toBe(bootFileName(code, 'assets'));
  });

  it('resolves the locale: ?lang, then storage, then navigator.languages, else en (05 §10)', () => {
    expect(run(code, { search: '?lang=ja', languages: ['zh-TW'] }).lang).toBe('ja');
    expect(run(code, { storage: { 'tsbs:locale': 'zh-TW' }, languages: ['en-US'] }).lang).toBe('zh-TW');
    expect(run(code, { languages: ['fr-FR', 'zh-Hant-HK'] }).lang).toBe('zh-TW');
    expect(run(code, { languages: ['zh'] }).lang).toBe('zh-TW');
    expect(run(code, { languages: ['ja-JP'] }).lang).toBe('ja');
    expect(run(code, { languages: ['de-DE'] }).lang).toBe('en');
  });

  it('sets data-theme from storage, defaulting to auto, and survives blocked storage', () => {
    expect(run(code, { storage: { 'tsbs:theme': 'dark' } }).theme).toBe('dark');
    expect(run(code, { storage: { 'tsbs:theme': 'purple' } }).theme).toBe('auto');
    expect(run(code, { storage: 'throws', languages: ['ja'] })).toEqual({ lang: 'ja', theme: 'auto', cellSize: 'M' });
  });

  it('sets data-cell-size from storage (S | M | L, default M) so the board height is right on first paint', () => {
    expect(run(code, { storage: { 'tsbs:cellSize': 'L' } }).cellSize).toBe('L');
    expect(run(code, { storage: { 'tsbs:cellSize': 'XL' } }).cellSize).toBe('M');
    expect(run(code, {}).cellSize).toBe('M');
  });
});
