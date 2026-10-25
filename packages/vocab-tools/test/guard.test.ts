import { mkdir, mkdtemp, rm, truncate, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { runGuard } from '../src/index.ts';

const MiB = 1024 * 1024;

describe('runGuard (03 §C.8)', () => {
  let dir = '';
  let dist = '';
  let manifest = '';
  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), 'tsbs-guard-'));
    dist = join(dir, 'dist');
    manifest = join(dir, 'vocab-manifest.generated.json');
    await mkdir(join(dist, 'tok', 'openai-o200k_base'), { recursive: true });
    await mkdir(join(dist, 'examples'), { recursive: true });
    await writeFile(join(dist, 'index.html'), '<!doctype html><title>x</title>');
    await writeFile(join(dist, '_headers'), '/*\n  X-Content-Type-Options: nosniff\n');
    await writeFile(join(dist, '.assetsignore'), '*.map\n');
    await writeFile(join(dist, 'tok', 'openai-o200k_base', 'abcdef012345.bin'), Uint8Array.of(0x1f, 0x8b));
    await writeFile(join(dist, 'examples', 'openai-o200k_base.01234567.json'), '{"schema":1}');
    await writeFile(
      manifest,
      JSON.stringify({ assets: { 'openai-o200k_base': { path: '/tok/openai-o200k_base/abcdef012345.bin' } } }),
    );
  });
  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  it('passes a clean dist', async () => {
    const report = await runGuard({ dist, manifest });
    expect(report.errors).toEqual([]);
    expect(report.files).toBe(5);
  });

  it('fails on a 21 MiB file and warns above 8 MiB', async () => {
    await writeFile(join(dist, 'big.bin'), '');
    await truncate(join(dist, 'big.bin'), 21 * MiB);
    await writeFile(join(dist, 'medium.bin'), '');
    await truncate(join(dist, 'medium.bin'), 9 * MiB);
    const report = await runGuard({ dist, manifest });
    expect(report.errors).toEqual(['big.bin is 21.0 MiB (hard limit 20 MiB)']);
    expect(report.warnings).toEqual(['medium.bin is 9.0 MiB (warn above 8 MiB)']);
  });

  it('fails on a dotfile other than .assetsignore', async () => {
    await writeFile(join(dist, '.env'), 'SECRET=1');
    await mkdir(join(dist, '.git'));
    await writeFile(join(dist, '.git', 'HEAD'), 'ref');
    const report = await runGuard({ dist, manifest });
    expect(report.errors).toEqual(['dotfile .env would be served', 'dotfile .git/HEAD would be served']);
  });

  it('cross-checks /tok files and the vocab manifest both ways', async () => {
    await writeFile(join(dist, 'tok', 'openai-o200k_base', 'ffffffffffff.bin'), 'x');
    await writeFile(
      manifest,
      JSON.stringify({ assets: { 'openai-o200k_base': { path: '/tok/openai-o200k_base/000000000000.bin' } } }),
    );
    const report = await runGuard({ dist, manifest });
    expect(report.errors).toEqual([
      'manifest lists /tok/openai-o200k_base/000000000000.bin but dist has no such file',
      'dist ships /tok/openai-o200k_base/abcdef012345.bin but the vocab manifest does not list it',
      'dist ships /tok/openai-o200k_base/ffffffffffff.bin but the vocab manifest does not list it',
    ]);
    expect((await runGuard({ dist, manifest: null })).errors).toEqual([]);
  });

  it('enforces the _headers rule count, unexcluded source maps, the examples and index.html budgets', async () => {
    await writeFile(join(dist, '_headers'), Array.from({ length: 101 }, (_, i) => `/p${String(i)}\n  X: y`).join('\n'));
    await writeFile(join(dist, '.assetsignore'), '');
    await writeFile(join(dist, 'app.js.map'), '{}');
    const random = Array.from({ length: 40_000 }, (_, i) => ((i * 2654435761) >>> 0).toString(36)).join('');
    await writeFile(join(dist, 'examples', 'big.json'), JSON.stringify({ random }));
    await writeFile(join(dist, 'index.html'), random);
    const report = await runGuard({ dist, manifest });
    expect(report.errors).toContain('_headers has 101 rules (limit 100)');
    expect(report.errors).toContain('source maps are in dist but .assetsignore does not exclude *.map');
    expect(report.errors.some((e) => e.startsWith('examples/big.json is'))).toBe(true);
    expect(report.errors.some((e) => e.startsWith('index.html is'))).toBe(true);
  });

  it('reports a missing dist or manifest', async () => {
    expect((await runGuard({ dist: join(dir, 'nope'), manifest })).errors[0]).toMatch(/does not exist/);
    expect((await runGuard({ dist, manifest: join(dir, 'nope.json') })).errors[0]).toMatch(
      /cannot read the vocab manifest/,
    );
  });
});
