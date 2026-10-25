import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import examplesJson from '../../../packages/registry/data/examples.json' with { type: 'json' };
import licencesJson from '../../../packages/registry/data/licences.json' with { type: 'json' };
import tokenizersJson from '../../../packages/registry/data/tokenizers.json' with { type: 'json' };
import { registryFileOf, registryTrim, trimRegistryJson } from './registry-trim.ts';

/** Site sources (app code only, never tests), read raw. */
const SRC = fileURLToPath(new URL('../src/', import.meta.url));
const SOURCES: Readonly<Record<string, string>> = Object.fromEntries(
  readdirSync(SRC, { recursive: true, encoding: 'utf8' })
    .filter((path) => /\.(ts|svelte)$/.test(path) && !/\.test(-helper)?\.ts$|\.test-helper\.svelte$/.test(path))
    .map((path) => [path.replaceAll('\\', '/'), readFileSync(join(SRC, path), 'utf8')]),
);

describe('registryFileOf', () => {
  it('matches the three trimmed registry files only, never a ?raw import', () => {
    expect(registryFileOf('I:\\repo\\packages\\registry\\data\\tokenizers.json')).toBe('tokenizers');
    expect(registryFileOf('/repo/packages/registry/data/licences.json?import')).toBe('licences');
    expect(registryFileOf('/repo/packages/registry/data/examples.json')).toBe('examples');
    expect(registryFileOf('/repo/packages/registry/data/examples.json?raw')).toBeNull();
    expect(registryFileOf('/repo/packages/registry/data/models.json')).toBeNull();
    expect(registryFileOf('/repo/apps/web/src/generated/licences.json')).toBeNull();
  });
});

describe('trimRegistryJson', () => {
  it('drops asset and fixture from every tokenizer and keeps what the site renders', () => {
    const trimmed = trimRegistryJson('tokenizers', tokenizersJson) as Array<Record<string, unknown>>;
    expect(trimmed).toHaveLength(tokenizersJson.length);
    for (const entry of trimmed) {
      expect(entry).not.toHaveProperty('asset');
      expect(entry).not.toHaveProperty('fixture');
      for (const key of ['id', 'displayName', 'fidelity', 'fidelityNote', 'engine', 'toggles', 'requiredNotices'])
        expect(entry).toHaveProperty(key);
    }
  });

  it('drops licence summaries, SPDX ids and the MODIFIED template, keeping tags and notices', () => {
    const trimmed = trimRegistryJson('licences', licencesJson) as {
      licences: Record<string, Record<string, unknown>>;
      notices: unknown;
    };
    expect(trimmed).not.toHaveProperty('modifiedTemplate');
    expect(trimmed.notices).toEqual(licencesJson.notices);
    for (const [key, display] of Object.entries(trimmed.licences)) {
      expect(display, key).toEqual({ tag: (licencesJson.licences as Record<string, { tag: string }>)[key]?.tag });
    }
  });

  it('keeps the default chip’s why sentence only; the others load from the full file (example-why.test.ts)', () => {
    const trimmed = trimRegistryJson('examples', examplesJson) as Array<Record<string, unknown>>;
    expect(trimmed).toHaveLength(examplesJson.length);
    expect(trimmed[0]).toEqual(examplesJson[0]);
    for (const chip of trimmed.slice(1)) {
      expect(chip).not.toHaveProperty('why');
      for (const key of ['key', 'fixtureCase', 'text', 'lang']) expect(chip).toHaveProperty(key);
    }
  });

  it('is smaller and passes unexpected shapes through', () => {
    expect(JSON.stringify(trimRegistryJson('licences', licencesJson)).length).toBeLessThan(
      JSON.stringify(licencesJson).length * 0.8,
    );
    expect(trimRegistryJson('tokenizers', { not: 'an array' })).toEqual({ not: 'an array' });
    expect(trimRegistryJson('licences', [1])).toEqual([1]);
  });

  it('is applied as a pre transform that returns JSON for Vite’s JSON plugin', () => {
    const plugin = registryTrim();
    expect(plugin.enforce).toBe('pre');
    const transform = plugin.transform as (code: string, id: string) => { code: string } | null;
    expect(transform('{"a":1}', '/x/src/y.json')).toBeNull();
    const out = transform(JSON.stringify(licencesJson), '/repo/packages/registry/data/licences.json');
    expect(JSON.parse(out?.code ?? 'null')).toEqual(trimRegistryJson('licences', licencesJson));
  });
});

describe('the site never reads a trimmed field', () => {
  it('has no asset/fixture reads, reads only tags from the licence displays and why only through its store', () => {
    expect(Object.keys(SOURCES).length).toBeGreaterThan(50);
    for (const [path, source] of Object.entries(SOURCES)) {
      expect(source, path).not.toMatch(/\.(asset|fixture)\b(?!\s*\()/);
      expect(source, path).not.toContain('modifiedTemplate');
      if (source.includes('@tsbs/registry/licences')) expect(source, path).not.toMatch(/\.(summary|spdx)\b/);
      if (!path.endsWith('app/example-why.svelte.ts')) expect(source, path).not.toMatch(/\.why\[/);
    }
  });
});
