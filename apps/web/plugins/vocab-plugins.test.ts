/**
 * Unit tests for WP03's three Vite plugins: `vocabAssets()`, `licences()` and `examples()`. Hooks are called directly
 * with a minimal resolved config and plugin context (no Vite build).
 */
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { Plugin, ResolvedConfig } from 'vite';
import { examples } from './examples.ts';
import { licences } from './licences.ts';
import { vocabAssets } from './vocab-assets.ts';

const REPO = fileURLToPath(new URL('../../../', import.meta.url));

interface Emitted {
  fileName: string;
  source: string;
}

/** Calls a plugin hook (function form) with a fake context that records warnings and emitted files. */
async function call(
  plugin: Plugin,
  name: keyof Plugin,
  context: { warnings: string[]; emitted: Emitted[] },
  ...args: unknown[]
): Promise<void> {
  const hook: unknown = plugin[name];
  if (typeof hook !== 'function') throw new Error(`${name} is not a function hook`);
  const ctx = {
    warn: (message: string) => context.warnings.push(message),
    emitFile: (file: Emitted) => {
      context.emitted.push(file);
      return file.fileName;
    },
  };
  await (hook as (...a: unknown[]) => unknown).apply(ctx, args);
}

function config(root: string, command: 'build' | 'serve'): ResolvedConfig {
  return { root, command, build: { outDir: 'dist' } } as unknown as ResolvedConfig;
}

describe('WP03 Vite plugins', () => {
  let dir = '';
  let root = '';
  let context: { warnings: string[]; emitted: Emitted[] };
  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), 'tsbs-plugins-'));
    root = join(dir, 'web');
    await mkdir(root, { recursive: true });
    context = { warnings: [], emitted: [] };
  });
  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  it('vocabAssets() copies the converter manifest for the Worker and /tok into dist', async () => {
    const vocabDist = join(dir, 'vocab');
    const manifest = {
      schema: 1,
      builtOn: '2026-10-25',
      generator: 'x',
      assets: { 'xai-grok2': { path: '/tok/xai-grok2/aaaaaaaaaaaa.bin' } },
    };
    await mkdir(join(vocabDist, 'tok', 'xai-grok2'), { recursive: true });
    await writeFile(join(vocabDist, 'vocab-manifest.generated.json'), JSON.stringify(manifest));
    await writeFile(join(vocabDist, 'tok', 'xai-grok2', 'aaaaaaaaaaaa.bin'), Uint8Array.of(0x1f, 0x8b, 8));
    const plugin = vocabAssets({ vocabDist });
    await call(plugin, 'configResolved', context, config(root, 'build'));
    await call(plugin, 'buildStart', context);
    await call(plugin, 'writeBundle', context);
    expect(JSON.parse(await readFile(join(root, 'src', 'generated', 'vocab-manifest.json'), 'utf8'))).toEqual(manifest);
    expect([...(await readFile(join(root, 'dist', 'tok', 'xai-grok2', 'aaaaaaaaaaaa.bin')))]).toEqual([0x1f, 0x8b, 8]);
    expect(context.warnings).toEqual([]);
  });

  it('vocabAssets() writes an empty manifest and warns when nothing was converted', async () => {
    const plugin = vocabAssets({ vocabDist: join(dir, 'none') });
    await call(plugin, 'configResolved', context, config(root, 'build'));
    await call(plugin, 'buildStart', context);
    const written = JSON.parse(await readFile(join(root, 'src', 'generated', 'vocab-manifest.json'), 'utf8')) as {
      assets: object;
    };
    expect(written.assets).toEqual({});
    expect(context.warnings[0]).toMatch(/run pnpm vocab:build/);
  });

  it('licences() writes the About data and copies the licence texts of every ship asset', async () => {
    const plugin = licences({
      oracleManifest: resolve(REPO, 'tools/oracle/manifest.json'),
      licensesDir: resolve(REPO, 'docs/licenses'),
      vocabDist: join(dir, 'no-vocab'),
    });
    await call(plugin, 'configResolved', context, config(root, 'build'));
    await call(plugin, 'buildStart', context);
    await call(plugin, 'writeBundle', context);
    const data = JSON.parse(await readFile(join(root, 'src', 'generated', 'licences.json'), 'utf8')) as {
      assets: Array<{ assetId: string }>;
    };
    expect(data.assets.map((a) => a.assetId)).toContain('meta-llama3-model');
    expect(data.assets).toHaveLength(9);
    const notice = await readFile(join(root, 'dist', 'licenses', 'meta-llama3-model', 'NOTICE.txt'), 'utf8');
    expect(notice).toMatch(/^Meta Llama 3 is licensed/);
    await expect(readFile(join(root, 'dist', 'licenses', 'meta-llama4-model', 'LICENSE'))).rejects.toThrow();
  });

  it('examples() writes the inlined default + index and emits one lazy file per tokenizer', async () => {
    const plugin = examples({ fixtures: resolve(REPO, 'fixtures'), chips: join(dir, 'missing-examples.json') });
    await call(plugin, 'configResolved', context, config(root, 'build'));
    await call(plugin, 'buildStart', context);
    await call(plugin, 'generateBundle', context);
    const index = JSON.parse(await readFile(join(root, 'src', 'generated', 'examples-index.json'), 'utf8')) as {
      files: Record<string, string>;
    };
    expect(Object.keys(index.files)).toHaveLength(9);
    expect(context.emitted.map((f) => `/${f.fileName}`).sort()).toEqual(Object.values(index.files).sort());
    const def = JSON.parse(await readFile(join(root, 'src', 'generated', 'examples-default.json'), 'utf8')) as {
      cases: Record<string, unknown>;
    };
    expect(Object.keys(def.cases)).toEqual(['zh-tw-tainan']);
    expect(context.warnings[0]).toMatch(/not found/);
  });
});
