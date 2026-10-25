/**
 * The nine real vocabularies (skipped when `data/vocab/raw` is absent, e.g. in a CI job without the oracle cache):
 * known counts, META facts asserted by WP03's acceptance (maxPieceBytes, unusedCount, Gemma 4 TYPS), sizes against
 * 03 §C.3, the writer → independent reader round trip, and — once WP02 lands — the joint gate through `readTsbv1`.
 */
import { beforeAll, describe, expect, it } from 'vitest';
import * as core from '@tsbs/core';
import type { Tsbv1 } from '@tsbs/core';
import { gzipDeterministic } from '../src/compress.ts';
import { readOracleManifest, type OracleManifest } from '../src/oracle-manifest.ts';
import { loadSourceInputs } from '../src/raw.ts';
import { ASSET_SOURCES, type AssetSource } from '../src/sources/index.ts';
import { encodeTsbv1, type EncodedContainer } from '../src/tsbv-writer.ts';
import { PieceType, type VocabTables } from '../src/tables.ts';
import { upstreamOf } from '../src/licences.ts';
import { HAS_RAW, ORACLE_MANIFEST, RAW } from './support/repo.ts';
import { readTestContainer } from './support/tsbv-test-reader.ts';

/** Known facts per tokenizer: counts, maxPieceBytes and the 03 §C.3 sizes in KB (raw, gzip). Gemma 2 is the measured value. */
const EXPECTED: Record<
  string,
  { pieces: number; specials: number; maxPieceBytes: number; rawKb: number; gzKb: number }
> = {
  'openai-o200k_base': { pieces: 199_998, specials: 2, maxPieceBytes: 128, rawKb: 1560, gzKb: 1025 },
  'openai-cl100k_base': { pieces: 100_256, specials: 5, maxPieceBytes: 128, rawKb: 727, gzKb: 443 },
  'anthropic-claude-legacy': { pieces: 64_995, specials: 5, maxPieceBytes: 1024, rawKb: 464, gzKb: 277 },
  'google-gemma4': { pieces: 262_144, specials: 24, maxPieceBytes: 93, rawKb: 3782, gzKb: 1620 },
  'google-gemma2': { pieces: 256_000, specials: 4, maxPieceBytes: 93, rawKb: 2638, gzKb: 1277 },
  'meta-llama4-muse': { pieces: 200_000, specials: 2048, maxPieceBytes: 113, rawKb: 1615, gzKb: 1045 },
  'meta-llama3': { pieces: 128_000, specials: 256, maxPieceBytes: 128, rawKb: 942, gzKb: 572 },
  'xai-grok2': { pieces: 130_944, specials: 128, maxPieceBytes: 256, rawKb: 939, gzKb: 601 },
  'xai-grok1': { pieces: 131_072, specials: 4, maxPieceBytes: 48, rawKb: 1407, gzKb: 615 },
};

interface Built {
  source: AssetSource;
  tables: VocabTables;
  container: EncodedContainer;
  gzip: Uint8Array;
}

describe.skipIf(!HAS_RAW)('real vocabularies (data/vocab/raw)', () => {
  const built = new Map<string, Built>();
  let oracle: OracleManifest;

  beforeAll(async () => {
    oracle = (await readOracleManifest(ORACLE_MANIFEST)).manifest;
    for (const source of ASSET_SOURCES) {
      const tables = await source.parse(await loadSourceInputs(source, RAW, oracle));
      const asset = oracle.assets.find((a) => a.id === source.assetId);
      if (asset === undefined) throw new Error(source.assetId);
      const container = encodeTsbv1(tables, {
        upstream: upstreamOf(asset, source),
        modificationNotice: 'test',
        generator: 'test',
      });
      built.set(source.tokenizerId, { source, tables, container, gzip: gzipDeterministic(container.bytes) });
    }
  }, 180_000);

  const get = (id: string): Built => {
    const b = built.get(id);
    if (b === undefined) throw new Error(id);
    return b;
  };

  it('has the known counts, maxPieceBytes and unusedCount 0 (WP03 acceptance)', () => {
    for (const [id, expected] of Object.entries(EXPECTED)) {
      const { meta } = get(id).container;
      expect(meta.counts.pieces, id).toBe(expected.pieces);
      expect(meta.counts.specials, id).toBe(expected.specials);
      expect(meta.maxPieceBytes, id).toBe(expected.maxPieceBytes);
      expect(meta.unusedCount, id).toBe(0);
    }
    expect(get('google-gemma4').container.meta.counts.merges).toBe(514_906);
  });

  it('records the engine configuration facts in META (04 §3.1)', () => {
    expect(get('google-gemma4').container.meta).toMatchObject({
      byteFirstId: 238,
      bosId: 2,
      eosId: 1,
      unkId: 3,
      padId: 0,
      priority: 'merge-rank',
      fallbackOrder: 'before-merge',
      addDummyPrefix: false,
      hfMergesRegenerable: true,
    });
    expect(get('google-gemma2').container.meta).toMatchObject({
      byteFirstId: 217,
      bosId: 2,
      eosId: 1,
      unkId: 3,
      addDummyPrefix: false,
      priority: 'score',
    });
    expect(get('xai-grok1').container.meta).toMatchObject({
      byteFirstId: 69,
      addDummyPrefix: true,
      escapeWhitespace: true,
      priority: 'score',
    });
    expect(get('xai-grok2').container.meta.idOffset).toBe(128);
    expect(get('anthropic-claude-legacy').container.meta.idOffset).toBe(5);
    expect(get('meta-llama3').container.meta.bosId).toBe(128000);
    expect(get('meta-llama4-muse').container.meta.bosId).toBe(200000);
    for (const id of ['google-gemma2', 'xai-grok1'])
      expect(get(id).container.sections.map((s) => s.tag)).toContain('PRIO');
  });

  it('derives Gemma 4 TYPS without USER_DEFINED (AD-31)', () => {
    const types = get('google-gemma4').tables.types ?? new Uint8Array();
    expect(types.includes(PieceType.UserDefined)).toBe(false);
    expect(types.filter((t) => t === PieceType.Byte)).toHaveLength(256);
    expect(types[238]).toBe(PieceType.Byte);
    expect(types[493]).toBe(PieceType.Byte);
    expect(types[3]).toBe(PieceType.Unk);
    expect(types.filter((t) => t === PieceType.Control)).toHaveLength(23);
    for (const id of [107, 108, 138, 144, 255968, 255969]) expect(types[id], String(id)).toBe(PieceType.Normal);
  });

  it('keeps the .model types for Gemma 2 and Grok-1 (tab = BYTE 226 in Gemma 2)', () => {
    const gemma2 = get('google-gemma2').tables;
    expect(gemma2.types?.[226]).toBe(PieceType.Byte);
    expect(new TextDecoder().decode(gemma2.pieces[226])).toBe('<0x09>');
    expect(gemma2.types?.filter((t) => t === PieceType.UserDefined)).toHaveLength(245);
    expect(get('xai-grok1').tables.types?.filter((t) => t === PieceType.UserDefined)).toHaveLength(65);
  });

  it('sizes are within ±5 % of 03 §C.3', () => {
    for (const [id, expected] of Object.entries(EXPECTED)) {
      const { container, gzip } = get(id);
      expect(Math.abs(container.bytes.length / 1024 / expected.rawKb - 1), `${id} raw`).toBeLessThan(0.05);
      expect(Math.abs(gzip.length / 1024 / expected.gzKb - 1), `${id} gzip`).toBeLessThan(0.05);
      expect(gzip.length, id).toBeLessThan(1.7 * 1024 * 1024);
    }
  });

  it('round-trips every asset through the independent test reader', () => {
    for (const { source, tables, container } of built.values()) {
      const decoded = readTestContainer(container.bytes);
      expect(decoded.pieces.length, source.tokenizerId).toBe(tables.pieces.length);
      for (let i = 0; i < tables.pieces.length; i++)
        if (Buffer.compare(decoded.pieces[i] ?? new Uint8Array(), tables.pieces[i] ?? new Uint8Array()) !== 0)
          throw new Error(`${source.tokenizerId} piece ${String(i)} differs`);
      expect(decoded.specials, source.tokenizerId).toEqual(tables.specials);
      expect(decoded.types === null ? null : [...decoded.types], source.tokenizerId).toEqual(
        tables.types === null ? null : [...tables.types],
      );
      expect(decoded.scores, source.tokenizerId).toEqual(
        tables.scores === null ? null : [...tables.scores].map((s) => s + 0),
      );
      expect(decoded.merges?.resultId ?? null).toEqual(tables.merges === null ? null : [...tables.merges.resultId]);
      expect(decoded.merges?.splitUtf16 ?? null).toEqual(tables.merges === null ? null : [...tables.merges.splitUtf16]);
      expect(decoded.meta, source.tokenizerId).toEqual(JSON.parse(JSON.stringify(container.meta)));
    }
  });

  const readTsbv1 = (core as Readonly<Record<string, unknown>>)['readTsbv1'];
  it.skipIf(typeof readTsbv1 !== 'function')(
    'joint WP02/WP03 gate: every container reads back deep-equal through readTsbv1',
    () => {
      const read = readTsbv1 as (buf: ArrayBuffer) => Tsbv1;
      for (const { source, tables, container } of built.values()) {
        const tsbv = read(container.bytes.slice().buffer);
        const id = source.tokenizerId;
        expect(tsbv.family, id).toBe(tables.family);
        expect(tsbv.meta, id).toEqual(container.meta);
        expect(tsbv.vocab.count, id).toBe(tables.pieces.length);
        for (let i = 0; i < tables.pieces.length; i++)
          if (Buffer.compare(tsbv.vocab.bytesOf(i), tables.pieces[i] ?? new Uint8Array()) !== 0)
            throw new Error(`${id} piece ${String(i)}`);
        expect(tsbv.types === null ? null : [...tsbv.types], id).toEqual(
          tables.types === null ? null : [...tables.types],
        );
        expect(tsbv.scores === null ? null : [...tsbv.scores], id).toEqual(
          tables.scores === null ? null : [...tables.scores].map((s) => s + 0),
        );
        expect(
          tsbv.specials.map((s) => ({ id: s.id, text: s.text })),
          id,
        ).toEqual(tables.specials);
        if (tables.merges === null) expect(tsbv.merges, id).toBeNull();
        else {
          const m = tsbv.merges;
          if (m === null) throw new Error(`${id}: readTsbv1 returned no merges`);
          const byRank: Array<[number, number]> = [];
          for (let piece = 0; piece + 1 < m.start.length; piece++)
            for (let k = m.start[piece] ?? 0; k < (m.start[piece + 1] ?? 0); k++)
              byRank[m.rank[k] ?? -1] = [piece, m.splitByteOffset[k] ?? -1];
          tables.merges.resultId.forEach((resultId, rank) => {
            const text = new TextDecoder().decode(tables.pieces[resultId]);
            const splitBytes = Buffer.byteLength(text.slice(0, tables.merges?.splitUtf16[rank] ?? 0));
            const got = byRank[rank];
            if (got?.[0] !== resultId || got[1] !== splitBytes) throw new Error(`${id} merge rank ${String(rank)}`);
          });
        }
      }
    },
  );
});
