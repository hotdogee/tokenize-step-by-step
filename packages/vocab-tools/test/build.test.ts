import { mkdir, mkdtemp, readdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, relative } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { VocabManifest } from '@tsbs/core';
import { gunzip, sha256Hex } from '../src/compress.ts';
import { inspectReport } from '../src/inspect.ts';
import { parseCommand, runBuild, runVerify, type BuildOptions, type LicencesGenerated } from '../src/index.ts';
import { ASSET_SOURCES } from '../src/sources/index.ts';
import { byteLevelPieces, grok2Json, tiktokenText } from './support/synthetic.ts';
import { readTestContainer } from './support/tsbv-test-reader.ts';

const NO_MODULES = { core: {}, conformance: {} };

interface Sandbox {
  root: string;
  options: (argv?: string[], env?: Record<string, string>) => BuildOptions;
  manifest: () => Promise<Record<string, unknown>>;
  writeManifest: (value: Record<string, unknown>) => Promise<void>;
}

async function files(dir: string): Promise<Map<string, Buffer>> {
  const out = new Map<string, Buffer>();
  for (const entry of await readdir(dir, { recursive: true, withFileTypes: true })) {
    if (!entry.isFile()) continue;
    const full = join(entry.parentPath, entry.name);
    out.set(relative(dir, full).split('\\').join('/'), await readFile(full));
  }
  return out;
}

/** A fake repository: a 9-asset oracle manifest, licence snapshots for all, raw files for o200k and Grok-2 only. */
async function sandbox(root: string): Promise<Sandbox> {
  const raw: Record<string, Record<string, Uint8Array>> = {
    'openai-o200k_base': { 'o200k_base.tiktoken': new TextEncoder().encode(tiktokenText(byteLevelPieces())) },
    'xai-grok2': { 'tokenizer.tok.json': new TextEncoder().encode(JSON.stringify(grok2Json(byteLevelPieces()))) },
  };
  const assets = ASSET_SOURCES.map((source) => {
    const licence = new TextEncoder().encode(`Licence text of ${source.assetId}\n`);
    const vocab = raw[source.assetId]?.[source.vocabFile] ?? new TextEncoder().encode('absent');
    const file = (name: string, role: string, data: Uint8Array): Record<string, unknown> => ({
      name,
      role,
      sha256: sha256Hex(data),
      bytes: data.length,
      url: `https://example.invalid/${source.assetId}/${name}`,
      revision: 'rev1',
      retrievedOn: '2026-10-24',
    });
    return {
      licence,
      entry: {
        id: source.assetId,
        lab: 'Lab',
        description: `${source.assetId} vocabulary`,
        notes: 'synthetic',
        shipIntent: 'ship',
        license: {
          spdx: 'MIT',
          file: 'LICENSE',
          sourceUrl: 'https://example.invalid/LICENSE',
          snapshotPath: `docs/licenses/${source.assetId}/LICENSE`,
          obligations: ['Keep the notice.'],
        },
        files: [
          file(source.vocabFile, 'vocab', vocab),
          ...source.configFiles.map((c) => file(c, 'config', vocab)),
          file('LICENSE', 'license', licence),
        ],
      },
    };
  });
  for (const [assetId, entries] of Object.entries(raw))
    for (const [name, data] of Object.entries(entries)) {
      await mkdir(join(root, 'raw', assetId), { recursive: true });
      await writeFile(join(root, 'raw', assetId, name), data);
    }
  for (const { entry, licence } of assets) {
    await mkdir(join(root, 'licenses', entry.id), { recursive: true });
    await writeFile(join(root, 'licenses', entry.id, 'LICENSE'), licence);
  }
  const manifestPath = join(root, 'manifest.json');
  const writeManifest = (value: Record<string, unknown>): Promise<void> =>
    writeFile(manifestPath, JSON.stringify(value));
  await writeManifest({ schemaVersion: 1, assets: assets.map((a) => a.entry) });
  return {
    root,
    writeManifest,
    manifest: async () => JSON.parse(await readFile(manifestPath, 'utf8')) as Record<string, unknown>,
    options: (argv = [], env = { CONFORMANCE_MODE: 'skip-missing-engine' }) => {
      const parsed = parseCommand(
        [
          'build',
          '--manifest',
          manifestPath,
          '--raw',
          join(root, 'raw'),
          '--out',
          join(root, 'out'),
          '--licenses',
          join(root, 'licenses'),
          '--registry',
          join(root, 'tokenizers.json'),
          ...argv,
        ],
        env,
      );
      if (parsed.kind !== 'build') throw new Error(parsed.kind);
      return parsed.options;
    },
  };
}

describe('runBuild (synthetic repository)', () => {
  let dir = '';
  let box: Sandbox;
  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), 'tsbs-vocab-build-'));
    box = await sandbox(dir);
  });
  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  it('builds the assets whose raw files exist, with root-relative paths and both hashes', async () => {
    const result = await runBuild(box.options(), {}, NO_MODULES);
    const manifest = JSON.parse(
      await readFile(join(dir, 'out', 'vocab-manifest.generated.json'), 'utf8'),
    ) as VocabManifest;
    expect(Object.keys(manifest.assets)).toEqual(['openai-o200k_base', 'xai-grok2']);
    const entry = manifest.assets['openai-o200k_base'];
    if (entry === undefined) throw new Error('no entry');
    expect(entry.path).toMatch(/^\/tok\/openai-o200k_base\/[0-9a-f]{12}\.bin$/);
    expect(entry.path).toBe(`/tok/openai-o200k_base/${entry.sha256.slice(0, 12)}.bin`);
    const gz = await readFile(join(dir, 'out', ...entry.path.slice(1).split('/')));
    expect(sha256Hex(gz)).toBe(entry.sha256);
    expect(sha256Hex(gunzip(gz))).toBe(entry.sha256Raw);
    expect(entry).toMatchObject({
      format: 'tsbv1',
      family: 'bytelevel-bpe',
      encoding: 'gzip',
      bytesCompressed: gz.length,
      counts: { pieces: 263, specials: 2 },
    });
    expect(readTestContainer(gunzip(gz)).meta['upstream']).toEqual(entry.upstream);
    expect(manifest).toMatchObject({ schema: 1, builtOn: '2026-10-24', generator: '@tsbs/vocab-tools@0.0.0' });
    expect(result.warnings.filter((w) => w.startsWith('ASSET SKIPPED'))).toHaveLength(7);
    expect(result.warnings.filter((w) => w.startsWith('CONFORMANCE SKIPPED'))).toHaveLength(2);

    const licences = JSON.parse(
      await readFile(join(dir, 'out', 'licences.generated.json'), 'utf8'),
    ) as LicencesGenerated;
    expect(licences.assets).toHaveLength(9);
    const o200k = licences.assets.find((a) => a.assetId === 'openai-o200k_base');
    expect(o200k?.shipped?.sha256).toBe(entry.sha256);
    expect(o200k?.modified?.path).toBe('/licenses/openai-o200k_base/MODIFIED-openai-o200k_base.txt');
    expect(o200k?.obligations).toEqual(['Keep the notice.']);
    expect(licences.assets.find((a) => a.assetId === 'google-gemma4')?.shipped).toBeNull();
    const modified = await readFile(
      join(dir, 'out', 'licenses', 'openai-o200k_base', 'MODIFIED-openai-o200k_base.txt'),
      'utf8',
    );
    expect(modified).toContain('Converted to the TSBV1 container from o200k_base.tiktoken');
    expect(modified).toContain('by @tsbs/vocab-tools 0.0.0 on 2026-10-24; vocabulary contents unchanged.');
  });

  it('is byte-identical across two builds', async () => {
    await runBuild(box.options(), {}, NO_MODULES);
    const first = await files(join(dir, 'out'));
    await runBuild(box.options(['--out', join(dir, 'out2')]), {}, NO_MODULES);
    const second = await files(join(dir, 'out2'));
    expect([...second.keys()]).toEqual([...first.keys()]);
    for (const [name, data] of first) expect(second.get(name)?.equals(data), name).toBe(true);
  });

  it('refuses to write anything under strict while an engine is missing', async () => {
    await expect(runBuild(box.options([], { CONFORMANCE_MODE: 'strict' }), {}, NO_MODULES)).rejects.toThrow(
      /strict conformance/,
    );
    await expect(readdir(join(dir, 'out'))).rejects.toThrow();
  });

  it('fails on missing raw files unless --missing-raw skip', async () => {
    await expect(
      runBuild(box.options(['--conformance', 'off', '--missing-raw', 'fail']), {}, NO_MODULES),
    ).rejects.toThrow(/missing raw file/);
    const result = await runBuild(box.options(['--conformance', 'off']), {}, NO_MODULES);
    expect(result.assets).toHaveLength(2);
  });

  it('refuses a raw SHA-256 mismatch in every mode', async () => {
    await writeFile(join(dir, 'raw', 'xai-grok2', 'tokenizer.tok.json'), '{}');
    await expect(runBuild(box.options(), {}, NO_MODULES)).rejects.toThrow(/SHA-256 mismatch for xai-grok2/);
    await expect(readdir(join(dir, 'out'))).rejects.toThrow();
  });

  it('writes nothing when a licence snapshot is stale', async () => {
    await writeFile(join(dir, 'licenses', 'xai-grok1', 'LICENSE'), 'edited by hand');
    await expect(runBuild(box.options(), {}, NO_MODULES)).rejects.toThrow(/differs from the manifest sha256/);
    await expect(readdir(join(dir, 'out'))).rejects.toThrow();
  });

  it('refuses shipIntent !== ship and withdrawn assets (manifest or registry)', async () => {
    const manifest = await box.manifest();
    const assets = manifest['assets'] as Array<Record<string, unknown>>;
    const o200k = assets.find((a) => a['id'] === 'openai-o200k_base');
    if (o200k === undefined) throw new Error('no o200k');
    o200k['shipIntent'] = 'oracle-only';
    await box.writeManifest(manifest);
    const result = await runBuild(box.options(), {}, NO_MODULES);
    expect(result.warnings).toContain(
      'ASSET SKIPPED: openai-o200k_base has shipIntent "oracle-only" (only "ship" assets are converted).',
    );
    expect(result.assets.map((a) => a.tokenizerId)).toEqual(['xai-grok2']);
    await expect(runBuild(box.options(['--only', 'openai-o200k_base']), {}, NO_MODULES)).rejects.toThrow(
      /refusing to convert/,
    );

    o200k['shipIntent'] = 'ship';
    o200k['withdrawn'] = true;
    await box.writeManifest(manifest);
    await expect(runBuild(box.options(['--only', 'openai-o200k_base']), {}, NO_MODULES)).rejects.toThrow(
      /withdrawn in the oracle manifest/,
    );

    delete o200k['withdrawn'];
    await box.writeManifest(manifest);
    await writeFile(join(dir, 'tokenizers.json'), JSON.stringify([{ id: 'xai-grok2', withdrawn: true }]));
    await expect(runBuild(box.options(['--only', 'xai-grok2']), {}, NO_MODULES)).rejects.toThrow(
      /withdrawn in the registry/,
    );
  });

  it('--only rebuilds one asset and keeps the other manifest entries', async () => {
    await runBuild(box.options(), {}, NO_MODULES);
    const before = await readFile(join(dir, 'out', 'vocab-manifest.generated.json'), 'utf8');
    const result = await runBuild(box.options(['--only', 'xai-grok2']), {}, NO_MODULES);
    expect(result.assets.map((a) => a.tokenizerId)).toEqual(['xai-grok2']);
    expect(await readFile(join(dir, 'out', 'vocab-manifest.generated.json'), 'utf8')).toBe(before);
    await expect(runBuild(box.options(['--only', 'nope']), {}, NO_MODULES)).rejects.toThrow(/no such shipped asset/);
  });

  it('verify accepts the output and catches tampering; inspect prints META', async () => {
    await runBuild(box.options(), {}, NO_MODULES);
    const verifyOptions = { out: join(dir, 'out'), manifest: join(dir, 'manifest.json'), raw: join(dir, 'raw') };
    const ok = await runVerify(verifyOptions);
    expect(ok.errors).toEqual([]);
    expect(ok.checked).toHaveLength(2);
    const manifest = JSON.parse(
      await readFile(join(dir, 'out', 'vocab-manifest.generated.json'), 'utf8'),
    ) as VocabManifest;
    const path = join(dir, 'out', ...(manifest.assets['xai-grok2']?.path ?? '').slice(1).split('/'));
    const report = inspectReport(new Uint8Array(await readFile(path)));
    expect(report).toContain('"tokenizerId": "xai-grok2"');
    expect(report).toContain('sections: META');
    await writeFile(path, Buffer.from('tampered'));
    const bad = await runVerify(verifyOptions);
    expect(bad.errors.join('\n')).toMatch(/xai-grok2: sha256 of the .bin differs/);
  });
});
