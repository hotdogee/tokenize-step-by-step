import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { ENGINE_FACTORIES } from '@tsbs/conformance';
import type { BuildOptions } from '../src/index.ts';
import { MANIFEST_FILE, conformanceWarnings, parseCommand, resolveBuiltOn, runBuild } from '../src/index.ts';

const NO_ENGINES = {};

function buildOptions(argv: readonly string[], env: Record<string, string> = {}): BuildOptions {
  const parsed = parseCommand(argv, env);
  if (parsed.kind !== 'build') throw new Error(`expected a build command, got ${parsed.kind}`);
  return parsed.options;
}

describe('parseCommand', () => {
  it('uses the design defaults for build', () => {
    expect(buildOptions(['build'])).toEqual({
      manifest: 'tools/oracle/manifest.json',
      raw: 'data/vocab/raw',
      out: 'data/vocab/dist',
      only: null,
      conformance: 'strict',
      conformanceSource: 'default',
    });
  });

  it('takes the conformance mode from the flag, then CONFORMANCE_MODE (AD-32)', () => {
    const env = { CONFORMANCE_MODE: 'skip-missing-engine' };
    expect(buildOptions(['build'], env).conformance).toBe('skip-missing-engine');
    expect(buildOptions(['build', '--conformance', 'off'], env)).toMatchObject({
      conformance: 'off',
      conformanceSource: 'flag',
    });
    expect(buildOptions(['build'], { CONFORMANCE_MODE: '' }).conformanceSource).toBe('default');
  });

  it('rejects bad modes, unknown commands and unknown flags', () => {
    expect(parseCommand(['build', '--conformance', 'lenient'], {}).kind).toBe('usage-error');
    expect(parseCommand(['frobnicate'], {}).kind).toBe('usage-error');
    expect(parseCommand(['build', '--nope'], {}).kind).toBe('usage-error');
  });

  it('reports the other subcommands as pending and prints help without a command', () => {
    expect(parseCommand(['verify'], {})).toEqual({ kind: 'pending', command: 'verify' });
    expect(parseCommand([], {}).kind).toBe('help');
  });
});

describe('resolveBuiltOn', () => {
  const oracle = { assets: [{ files: [{ retrievedOn: '2026-10-24' }, { retrievedOn: '2026-10-25' }] }] };

  it('prefers SOURCE_DATE_EPOCH, else the newest retrievedOn', () => {
    expect(resolveBuiltOn({ SOURCE_DATE_EPOCH: '0' }, oracle)).toBe('1970-01-01');
    expect(resolveBuiltOn({}, oracle)).toBe('2026-10-25');
    expect(() => resolveBuiltOn({}, {})).toThrow(/SOURCE_DATE_EPOCH/);
  });
});

describe('conformanceWarnings', () => {
  it('warns once per family without an engine under skip-missing-engine', () => {
    const options = buildOptions(['build', '--conformance', 'skip-missing-engine']);
    expect(conformanceWarnings(options, NO_ENGINES)).toHaveLength(2);
    const oneEngine = { [ENGINE_FACTORIES['bytelevel-bpe']]: () => null };
    const warnings = conformanceWarnings(options, oneEngine);
    expect(warnings).toHaveLength(1);
    expect(warnings[0]).toMatch(/^CONFORMANCE SKIPPED for spm-bpe/);
  });
});

describe('runBuild (stub)', () => {
  let dir: string | undefined;
  afterEach(async () => {
    if (dir !== undefined) await rm(dir, { recursive: true, force: true });
  });

  it('writes an empty, schema-valid, deterministic vocab manifest', async () => {
    dir = await mkdtemp(join(tmpdir(), 'tsbs-vocab-'));
    const manifestPath = join(dir, 'manifest.json');
    await writeFile(manifestPath, JSON.stringify({ assets: [{ files: [{ retrievedOn: '2026-10-24' }] }] }));
    const options = buildOptions(['build', '--manifest', manifestPath, '--out', join(dir, 'dist')]);

    const first = await runBuild(options, {}, NO_ENGINES);
    const written = await readFile(join(dir, 'dist', MANIFEST_FILE), 'utf8');
    expect(JSON.parse(written)).toEqual({
      schema: 1,
      builtOn: '2026-10-24',
      generator: '@tsbs/vocab-tools@0.0.0',
      assets: {},
    });
    expect(first.manifest.assets).toEqual({});
    expect(written.endsWith('}\n')).toBe(true);

    await runBuild(options, {}, NO_ENGINES);
    expect(await readFile(join(dir, 'dist', MANIFEST_FILE), 'utf8')).toBe(written);
  });
});
