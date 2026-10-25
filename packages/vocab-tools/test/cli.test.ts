import { describe, expect, it } from 'vitest';
import type { BuildOptions } from '../src/index.ts';
import { parseCommand, resolveBuiltOn } from '../src/index.ts';

function buildOptions(argv: readonly string[], env: Record<string, string> = {}): BuildOptions {
  const parsed = parseCommand(argv, env);
  if (parsed.kind !== 'build') throw new Error(`expected a build command, got ${parsed.kind}`);
  return parsed.options;
}

describe('parseCommand: build', () => {
  it('uses the design defaults', () => {
    expect(buildOptions(['build'])).toEqual({
      manifest: 'tools/oracle/manifest.json',
      raw: 'data/vocab/raw',
      out: 'data/vocab/dist',
      only: null,
      conformance: 'strict',
      conformanceSource: 'default',
      missingRaw: 'fail',
      fixtures: 'fixtures',
      licenses: 'docs/licenses',
      registry: 'packages/registry/data/tokenizers.json',
    });
  });

  it('takes the conformance mode from the flag, then CONFORMANCE_MODE (AD-32)', () => {
    const env = { CONFORMANCE_MODE: 'skip-missing-engine' };
    expect(buildOptions(['build'], env)).toMatchObject({
      conformance: 'skip-missing-engine',
      conformanceSource: 'env',
    });
    expect(buildOptions(['build', '--conformance', 'off'], env)).toMatchObject({
      conformance: 'off',
      conformanceSource: 'flag',
    });
    expect(buildOptions(['build'], { CONFORMANCE_MODE: '' }).conformanceSource).toBe('default');
  });

  it('defaults --missing-raw to fail, except skip under skip-missing-engine (interim CI deviation)', () => {
    expect(buildOptions(['build', '--conformance', 'strict']).missingRaw).toBe('fail');
    expect(buildOptions(['build', '--conformance', 'off']).missingRaw).toBe('fail');
    expect(buildOptions(['build', '--conformance', 'skip-missing-engine']).missingRaw).toBe('skip');
    expect(buildOptions(['build'], { CONFORMANCE_MODE: 'skip-missing-engine' }).missingRaw).toBe('skip');
    expect(buildOptions(['build', '--conformance', 'skip-missing-engine', '--missing-raw', 'fail']).missingRaw).toBe(
      'fail',
    );
    expect(buildOptions(['build', '--conformance', 'off', '--missing-raw', 'skip']).missingRaw).toBe('skip');
    expect(parseCommand(['build', '--missing-raw', 'maybe'], {}).kind).toBe('usage-error');
  });

  it('accepts --only', () => {
    expect(buildOptions(['build', '--only', 'xai-grok2']).only).toBe('xai-grok2');
  });

  it('rejects bad modes, unknown commands, foreign flags and stray arguments', () => {
    expect(parseCommand(['build', '--conformance', 'lenient'], {}).kind).toBe('usage-error');
    expect(parseCommand(['frobnicate'], {}).kind).toBe('usage-error');
    expect(parseCommand(['build', '--nope'], {}).kind).toBe('usage-error');
    expect(parseCommand(['build', '--dist', 'x'], {}).kind).toBe('usage-error');
    expect(parseCommand(['build', 'extra'], {}).kind).toBe('usage-error');
  });
});

describe('parseCommand: other commands', () => {
  it('parses verify, guard, licences and examples with their defaults', () => {
    expect(parseCommand(['verify'], {})).toEqual({
      kind: 'verify',
      options: { out: 'data/vocab/dist', manifest: 'tools/oracle/manifest.json', raw: 'data/vocab/raw' },
    });
    expect(parseCommand(['guard'], {})).toEqual({
      kind: 'guard',
      options: { dist: 'apps/web/dist', vocabManifest: 'data/vocab/dist/vocab-manifest.generated.json' },
    });
    expect(parseCommand(['guard', '--vocab-manifest', 'none'], {})).toMatchObject({ options: { vocabManifest: null } });
    expect(parseCommand(['licences'], {})).toEqual({
      kind: 'licences',
      options: {
        out: 'packages/registry/data/licences.generated.json',
        manifest: 'tools/oracle/manifest.json',
        licenses: 'docs/licenses',
        vocabManifest: 'data/vocab/dist/vocab-manifest.generated.json',
      },
    });
    expect(parseCommand(['examples', '--out', 'x'], {})).toEqual({
      kind: 'examples',
      options: { fixtures: 'fixtures', chips: 'packages/registry/data/examples.json', out: 'x' },
    });
  });

  it('inspect takes exactly one file', () => {
    expect(parseCommand(['inspect', 'a.bin'], {})).toEqual({ kind: 'inspect', file: 'a.bin' });
    expect(parseCommand(['inspect'], {}).kind).toBe('usage-error');
    expect(parseCommand(['inspect', 'a', 'b'], {}).kind).toBe('usage-error');
  });

  it('prints help without a command or with --help', () => {
    expect(parseCommand([], {}).kind).toBe('help');
    expect(parseCommand(['--help'], {}).kind).toBe('help');
    expect(parseCommand(['guard', '-h'], {}).kind).toBe('help');
  });
});

describe('resolveBuiltOn', () => {
  const oracle = { assets: [{ files: [{ retrievedOn: '2026-10-24' }, { retrievedOn: '2026-10-25' }] }] };

  it('prefers SOURCE_DATE_EPOCH, else the newest retrievedOn', () => {
    expect(resolveBuiltOn({ SOURCE_DATE_EPOCH: '0' }, oracle)).toBe('1970-01-01');
    expect(resolveBuiltOn({}, oracle)).toBe('2026-10-25');
    expect(() => resolveBuiltOn({}, {})).toThrow(/SOURCE_DATE_EPOCH/);
    expect(() => resolveBuiltOn({ SOURCE_DATE_EPOCH: '-1' }, oracle)).toThrow(/non-negative/);
  });
});
