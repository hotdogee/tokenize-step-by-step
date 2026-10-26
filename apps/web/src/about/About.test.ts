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

describe('licence data (licences.generated.json via src/generated/licences.json)', () => {
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

  it('builds /licenses/<assetId>/<file> URLs, the paths the licences() plugin serves the texts at', () => {
    expect(licenceTextUrl('meta-llama3-model', 'NOTICE.txt')).toBe('/licenses/meta-llama3-model/NOTICE.txt');
    const raw = import.meta.glob<string>('../generated/licences.json', {
      query: '?raw',
      import: 'default',
      eager: true,
    });
    const generated = JSON.parse(Object.values(raw)[0] ?? '{}') as {
      assets: Array<{ assetId: string; texts: Array<{ name: string; path: string }> }>;
    };
    expect(generated.assets.length).toBe(shipped.length);
    for (const asset of generated.assets)
      for (const text of asset.texts) expect(licenceTextUrl(asset.assetId, text.name)).toBe(text.path);
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
    // Gemma Terms §3.2 pass-through: the registry's verbatim restrictions, both limbs and Google's reservation.
    expect(body).toContain('Use restrictions (Gemma Terms of Use, Section 3.2)');
    expect(body).toContain('(2) in violation of applicable laws and regulations');
    expect(body).toContain('Google reserves the right to restrict');
  });

  it('links both an MIT and an Apache-2.0 text in the legacy Claude block (00 §D answer 4)', () => {
    const snapshots = import.meta.glob<string>('../../../../docs/licenses/anthropic-claude-legacy/*', {
      query: '?raw',
      import: 'default',
      eager: true,
    });
    const textOf = (file: string): string =>
      Object.entries(snapshots).find(([path]) => path.endsWith(`/anthropic-claude-legacy/${file}`))?.[1] ?? '';
    const isMit = (text: string): boolean => text.includes('Permission is hereby granted, free of charge');
    const isApache2 = (text: string): boolean =>
      text.includes('Apache License') && text.includes('Version 2.0, January 2004');
    const files = LICENCES.assets.find((licence) => licence.assetId === 'anthropic-claude-legacy')?.licenceFiles ?? [];
    const mit = files.filter((file) => isMit(textOf(file)));
    const apache = files.filter((file) => isApache2(textOf(file)));
    expect(mit.length).toBeGreaterThan(0);
    expect(apache.length).toBeGreaterThan(0);

    i18n.current = 'en';
    const body = render(About).body;
    const start = body.indexOf('id="licence-anthropic-claude-legacy"');
    const block = body.slice(start, body.indexOf('</article>', start));
    expect(start).toBeGreaterThan(-1);
    for (const file of [...mit, ...apache])
      expect(block).toContain(`href="${licenceTextUrl('anthropic-claude-legacy', file)}"`);
  });

  it('has the fidelity table and the keyboard setting', () => {
    i18n.current = 'en';
    const body = render(About).body;
    expect(body).toContain('Claude Opus 5.5');
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
