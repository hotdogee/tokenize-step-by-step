import { createHash } from 'node:crypto';
import { readdirSync, readFileSync } from 'node:fs';
import { gunzipSync } from 'node:zlib';
import { expect, test } from '@playwright/test';
import type { TiktokenFixture } from '@tsbs/core';
import { readTsbv1 } from '@tsbs/core/format/tsbv1';
import type { PatternKey } from '@tsbs/core/unicode/patterns';
import { pieceDigest } from '../parity/digest.ts';
import { openHarness } from '../parity/serve.ts';
import { PARITY_TAG } from '../projects.ts';

// Browser parity (06 §1, 07 §5 risk 1): the same checks in every engine project — chromium, firefox and webkit — through
// the production code paths, against the oracle's fixtures and the built vocabulary asset.
const repo = new URL('../../', import.meta.url);
const readJson = (path: string): unknown => JSON.parse(readFileSync(new URL(path, repo), 'utf8'));
const readFixture = (id: string): TiktokenFixture => readJson(`fixtures/${id}.json`) as TiktokenFixture;

const o200k = readFixture('openai-o200k_base');

/** Byte-level tokenizers and their pre-tokenizer template, from the registry (04 §2.2 "Used by"). */
const PATTERNS = (
  readJson('packages/registry/data/tokenizers.json') as Array<{ id: string; engine: { pattern?: PatternKey } }>
).flatMap(({ id, engine }) => (engine.pattern === undefined ? [] : [{ id, pattern: engine.pattern }]));

/** The o200k `.bin` of the build under test (`vite preview` serves `apps/web/dist`, so `/tok/...` is that file). */
function o200kAsset(): { path: string; bytes: Buffer } {
  const dir = new URL('apps/web/dist/tok/openai-o200k_base/', repo);
  const [name, ...others] = readdirSync(dir).filter((file) => file.endsWith('.bin'));
  if (name === undefined || others.length > 0) throw new Error(`expected one o200k .bin in ${dir.pathname}`);
  return { path: `/tok/openai-o200k_base/${name}`, bytes: readFileSync(new URL(name, dir)) };
}

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
    const texts = o200k.cases.map((entry) => entry.text);
    const hex = await page.evaluate((all) => window.tsbsParity?.utf8Hex(all), texts);
    expect(hex).toHaveLength(o200k.cases.length);
    o200k.cases.forEach((entry, index) => {
      const expected = entry.tokens.map((token) => token.bytes).join('');
      expect.soft(hex?.[index], entry.name).toBe(expected);
      expect.soft((hex?.[index]?.length ?? 0) / 2, `${entry.name} utf8Len`).toBe(entry.utf8Len);
    });
  });

  test('round-trips bytes through CompressionStream and DecompressionStream (gzip)', async ({ page }) => {
    const sample = Array.from({ length: 4096 }, (_, i) => ((i * 131) % 256).toString(16).padStart(2, '0')).join('');
    expect(await page.evaluate((hex) => window.tsbsParity?.gzipRoundTrip(hex), sample)).toBe(sample);
  });

  test('chunks every fixture text exactly like the oracle (compilePattern)', async ({ page }) => {
    expect(PATTERNS.map(({ id }) => id)).toHaveLength(6);
    for (const { id, pattern } of PATTERNS) {
      const fixture = readFixture(id);
      // claude-legacy also carries the NFKC forms of its cases (152), which the engine chunks after normalizing.
      const cases = [...fixture.cases, ...(fixture.normalizedNFKC ?? [])];
      const spans = await page.evaluate(({ key, texts }) => window.tsbsParity?.chunkSpans(key, texts), {
        key: pattern,
        texts: cases.map((entry) => entry.text),
      });
      expect(spans, id).toHaveLength(cases.length);
      const mismatches = cases
        .filter((entry, index) => JSON.stringify(spans?.[index]) !== JSON.stringify(entry.chunks))
        .map((entry) => entry.name);
      expect(mismatches, `${id} (${pattern}): cases whose chunks differ from the oracle`).toEqual([]);
      test.info().annotations.push({ type: 'chunks', description: `${id}: ${String(cases.length)} cases` });
    }
  });

  test('gunzips the o200k .bin with DecompressionStream and reads it with readTsbv1 like Node', async ({ page }) => {
    const asset = o200kAsset();
    const node = readTsbv1(new Uint8Array(gunzipSync(asset.bytes)).buffer);
    // Every token the oracle produced in the o200k fixture must be found at its id (o200k: index = rank = id).
    const lookups = new Map<string, number>();
    for (const entry of o200k.cases) for (const token of entry.tokens) lookups.set(token.bytes, token.id);
    const hex = [...lookups.keys()];
    const report = await page.evaluate(({ path, keys }) => window.tsbsParity?.readVocab(path, keys), {
      path: asset.path,
      keys: hex,
    });
    const sha256 = createHash('sha256').update(asset.bytes).digest('hex');
    expect(asset.path).toContain(`/${sha256.slice(0, 12)}.bin`);
    expect(report).toMatchObject({
      sha256,
      compressedBytes: asset.bytes.length,
      rawBytes: gunzipSync(asset.bytes).length,
      magic: 'TSBV',
      tokenizerId: 'openai-o200k_base',
      family: node.family,
      count: node.vocab.count,
      maxPieceBytes: node.meta.maxPieceBytes,
      specials: node.specials.map(({ id, text }) => ({ id, text })),
      pieceDigest: pieceDigest(node.vocab.count, (index) => node.vocab.bytesOf(index)),
    });
    expect(report?.indices).toEqual([...lookups.values()]);
    test.info().annotations.push({
      type: 'vocab',
      description: `${String(report?.count)} pieces, ${String(hex.length)} oracle tokens looked up`,
    });
  });
});
