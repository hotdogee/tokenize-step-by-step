import { describe, expect, it } from 'vitest';
import { LLAMA3_SPECIALS_NOTE, buildLicences, modificationNotice, readOracleManifest } from '../src/index.ts';
import { LICENSES, ORACLE_MANIFEST } from './support/repo.ts';

describe('licences.generated.json from the real oracle manifest + docs/licenses', () => {
  it('covers every ship asset (incl. meta-llama3-model) with verbatim obligations and snapshot hashes', async () => {
    const { manifest } = await readOracleManifest(ORACLE_MANIFEST);
    const licences = await buildLicences({
      oracle: manifest,
      licensesDir: LICENSES,
      generator: '@tsbs/vocab-tools@0.0.0',
      builtOn: '2026-10-25',
      vocab: null,
      statements: new Map(),
    });
    const ship = manifest.assets.filter((a) => a.shipIntent === 'ship').map((a) => a.id);
    expect(ship).toHaveLength(9);
    expect(licences.assets.map((a) => a.assetId)).toEqual(ship);
    for (const asset of licences.assets) {
      const source = manifest.assets.find((a) => a.id === asset.assetId);
      expect(asset.obligations).toEqual(source?.license.obligations);
      expect(asset.spdx).toBe(source?.license.spdx);
      expect(asset.tokenizerId).not.toBeNull();
      expect(asset.licence.path).toBe(`/licenses/${asset.assetId}/${source?.license.file ?? ''}`);
      expect(asset.upstream?.sha256).toMatch(/^[0-9a-f]{64}$/);
      expect(asset.shipped).toBeNull();
    }
    const llama3 = licences.assets.find((a) => a.assetId === 'meta-llama3-model');
    expect(llama3?.tokenizerId).toBe('meta-llama3');
    expect(llama3?.specials.note).toBe(LLAMA3_SPECIALS_NOTE);
    expect(llama3?.notice?.text).toMatch(/^Meta Llama 3 is licensed under the Meta Llama 3 Community License/);
    expect(llama3?.texts.find((t) => t.name === 'NOTICE.txt')?.rendered).toBe(true);
    expect(llama3?.texts.map((t) => t.name)).toContain('xenova/LICENSE');
    expect(licences.assets.find((a) => a.assetId === 'meta-muse-glimmer')?.tokenizerId).toBe('meta-llama4-muse');
    // PA-4: the Gemma Terms HTML is recorded but not snapshotted.
    expect(licences.assets.find((a) => a.assetId === 'google-gemma2')?.texts.map((t) => t.name)).not.toContain(
      'gemma-terms-of-use.html',
    );
  });

  it('formats the MODIFIED statement from the licences.json template', () => {
    expect(modificationNotice('claude.json', 'ab'.repeat(32), '@tsbs/vocab-tools@1.2.3', '2026-10-25')).toBe(
      `Converted to the TSBV1 container from claude.json (sha256 ${'ab'.repeat(32)}) by @tsbs/vocab-tools 1.2.3 on 2026-10-25; vocabulary contents unchanged.`,
    );
  });
});
