/**
 * About (05 §14): lists every `shipIntent: ship` asset of the oracle manifest with its obligations verbatim, links each
 * licence text under /licenses/<assetId>/, renders the required notices exactly and renders in all three locales.
 */
import { render } from 'svelte/server';
import { afterAll, describe, expect, it } from 'vitest';
import { MANIFEST_ASSETS } from '../app/fixtures.test-helper.ts';
import { translateAbout } from '../i18n/about/t.ts';
import { i18n } from '../i18n/locale.svelte.ts';
import { LOCALES } from '../i18n/types.ts';
import About from './About.svelte';
import { GEMMA4_CROSS_CHECK } from './cross-check.ts';
import { LICENCES, licenceTextUrl } from './licences.ts';
import { detectUnicodeVersion } from './unicode.ts';

/** How Svelte's server renderer escapes text content. */
const escapeHtml = (text: string): string => text.replaceAll('&', '&amp;').replaceAll('<', '&lt;');

afterAll(() => {
  i18n.current = 'en';
});

describe('licence data (TODO(WP-integration): stub of licences.generated.json)', () => {
  const shipped = MANIFEST_ASSETS.filter((asset) => asset.shipIntent === 'ship');

  it('covers exactly the manifest ship assets', () => {
    expect(LICENCES.assets.map((asset) => asset.assetId).sort()).toEqual(shipped.map((asset) => asset.id).sort());
  });

  it('carries obligations, SPDX and description verbatim from the manifest', () => {
    for (const asset of shipped) {
      const licence = LICENCES.assets.find((candidate) => candidate.assetId === asset.id);
      expect(licence?.obligations, asset.id).toEqual(asset.license.obligations);
      expect(licence?.spdx, asset.id).toBe(asset.license.spdx);
      expect(licence?.description, asset.id).toBe(asset.description);
      expect(licence?.licenceFiles.length, asset.id).toBeGreaterThan(0);
    }
  });

  it('builds /licenses/<assetId>/<file> URLs', () => {
    expect(licenceTextUrl('meta-llama3-model', 'NOTICE.txt')).toBe('/licenses/meta-llama3-model/NOTICE.txt');
  });
});

describe('About page (server-rendered)', () => {
  for (const locale of LOCALES) {
    it(`lists every ship asset with its obligations in ${locale}`, () => {
      i18n.current = locale;
      const body = render(About).body;
      expect(body).toMatch(new RegExp(`<h1[^>]*>${translateAbout(locale, 'about.heading')}</h1>`));
      for (const licence of LICENCES.assets) {
        expect(body).toContain(`id="licence-${licence.assetId}"`);
        for (const obligation of licence.obligations) expect(body).toContain(escapeHtml(obligation));
        for (const file of licence.licenceFiles)
          expect(body).toContain(`href="${licenceTextUrl(licence.assetId, file)}"`);
      }
      expect(body).not.toMatch(/\{[A-Za-z]+\}/);
    });
  }

  it('renders the required notices exactly (05 §14 item 4)', () => {
    i18n.current = 'zh-TW';
    const body = render(About).body;
    expect(body).toContain('Powered by xAI');
    expect(body).toContain(
      'This product includes materials licensed under the xAI Community License. All rights reserved. Copyright © xAI 2026.',
    );
    expect(body).toContain('Built with Meta Llama 3');
    expect(body).toContain(
      'Meta Llama 3 is licensed under the Meta Llama 3 Community License, Copyright © Meta Platforms, Inc. All Rights Reserved.',
    );
    expect(body).toContain(
      'Gemma is provided under and subject to the Gemma Terms of Use found at ai.google.dev/gemma/terms',
    );
  });

  it('has the fidelity table and the keyboard setting', () => {
    i18n.current = 'en';
    const body = render(About).body;
    expect(body).toContain('Claude 3 → 5.5 / Fable / Mythos');
    expect(body).toContain('live check only');
    expect(body).toContain('role="switch"');
  });
});

describe('Gemma 4 cross-check (04 §8)', () => {
  const raw = import.meta.glob<string>('../../../../fixtures/google-gemma4.json', {
    query: '?raw',
    import: 'default',
    eager: true,
  });
  const fixture = JSON.parse(Object.values(raw)[0] ?? '{}') as {
    cases: unknown[];
    crossCheck: { agreedCases: number; disagreements: Array<{ name: string; explanation: string }> };
  };

  it('matches the fixture', () => {
    expect(GEMMA4_CROSS_CHECK.agreed).toBe(fixture.crossCheck.agreedCases);
    expect(GEMMA4_CROSS_CHECK.total).toBe(fixture.cases.length);
    expect(GEMMA4_CROSS_CHECK.disagreements).toEqual(
      fixture.crossCheck.disagreements.map(({ name, explanation }) => ({ name, explanation })),
    );
  });

  it('is listed on About › Engine', () => {
    i18n.current = 'en';
    const body = render(About).body;
    for (const item of GEMMA4_CROSS_CHECK.disagreements) expect(body).toContain(item.name);
  });
});

describe('detectUnicodeVersion', () => {
  it('reports at least 16.0 on Node 26 (Unicode 17 ICU)', () => {
    expect(['16.0', '17.0']).toContain(detectUnicodeVersion());
  });
});
