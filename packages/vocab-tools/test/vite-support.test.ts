import { mkdtemp, readFile, rm, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { copyTree, resolveUnder, writeIfChanged } from '../src/vite-support.ts';

describe('vite-support', () => {
  let dir = '';
  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), 'tsbs-vite-'));
  });
  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  it('resolveUnder maps only safe paths under the prefix', () => {
    const root = join(dir, 'tok');
    expect(resolveUnder(root, '/tok/', '/tok/xai-grok2/abc.bin?v=1')).toBe(join(root, 'xai-grok2', 'abc.bin'));
    for (const bad of [
      '/tok/../secret',
      '/tok/.env',
      '/tok/a//b',
      '/tok/',
      '/assets/x.js',
      '/tok/%E0%A4%A',
      '/tok/a%5C..%5Cb',
    ])
      expect(resolveUnder(root, '/tok/', bad), bad).toBeNull();
  });

  it('writeIfChanged leaves identical files untouched', async () => {
    const file = join(dir, 'g', 'x.json');
    expect(await writeIfChanged(file, '{}')).toBe(true);
    const first = (await stat(file)).mtimeMs;
    expect(await writeIfChanged(file, '{}')).toBe(false);
    expect((await stat(file)).mtimeMs).toBe(first);
    expect(await writeIfChanged(file, Uint8Array.of(0x5b, 0x5d))).toBe(true);
    expect(await readFile(file, 'utf8')).toBe('[]');
  });

  it('copyTree is a no-op for a missing source', async () => {
    expect(await copyTree(join(dir, 'none'), join(dir, 'out'))).toBe(false);
    await expect(stat(join(dir, 'out'))).rejects.toThrow();
  });
});
