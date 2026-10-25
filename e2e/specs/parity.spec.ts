import { readFileSync } from 'node:fs';
import { expect, test } from '@playwright/test';
import type { TiktokenFixture } from '@tsbs/core';
import { openHarness } from '../parity/serve.ts';
import { PARITY_TAG } from '../projects.ts';

// Browser parity (06 §1): the same checks in every engine project (chromium now; firefox/webkit with E2E_FULL_MATRIX=1).
const fixture = JSON.parse(
  readFileSync(new URL('../../fixtures/openai-o200k_base.json', import.meta.url), 'utf8'),
) as TiktokenFixture;

test.describe(`browser parity harness ${PARITY_TAG}`, () => {
  test.beforeEach(async ({ page }) => {
    await openHarness(page);
  });

  test('has the platform features the loader and engines rely on', async ({ page }) => {
    const features = await page.evaluate(() => window.tsbsParity?.features());
    expect(features).toMatchObject({
      textEncoder: true,
      decompressionGzip: true,
      compressionGzip: true,
      subtleCrypto: true,
    });
    test.info().annotations.push({ type: 'features', description: JSON.stringify(features) });
  });

  test('encodes every fixture text to the oracle UTF-8 bytes', async ({ page }) => {
    const texts = fixture.cases.map((entry) => entry.text);
    const hex = await page.evaluate((all) => window.tsbsParity?.utf8Hex(all), texts);
    expect(hex).toHaveLength(fixture.cases.length);
    fixture.cases.forEach((entry, index) => {
      const expected = entry.tokens.map((token) => token.bytes).join('');
      expect.soft(hex?.[index], entry.name).toBe(expected);
      expect.soft((hex?.[index]?.length ?? 0) / 2, `${entry.name} utf8Len`).toBe(entry.utf8Len);
    });
  });

  test('round-trips bytes through CompressionStream and DecompressionStream (gzip)', async ({ page }) => {
    const sample = Array.from({ length: 4096 }, (_, i) => ((i * 131) % 256).toString(16).padStart(2, '0')).join('');
    expect(await page.evaluate((hex) => window.tsbsParity?.gzipRoundTrip(hex), sample)).toBe(sample);
  });

  // WP11 wave 3, once WP02 exports `compilePattern` and WP03 ships the o200k `.bin`: chunk every fixture text with the
  // compiled pattern and compare with `cases[].chunks`; gunzip + `readTsbv1` the `.bin` in webkit.
  test.fixme('chunks every fixture text exactly like the oracle (compilePattern, WP02)', () => undefined);
});
