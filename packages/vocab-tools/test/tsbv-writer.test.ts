import { describe, expect, it } from 'vitest';
import { gunzip, gzipDeterministic } from '../src/compress.ts';
import { decodeContainer } from '../src/inspect.ts';
import { parseTiktokenText } from '../src/sources/tiktoken-text.ts';
import { encodeTsbv1, META_MAX_BYTES, scoresAreIntegral } from '../src/tsbv-writer.ts';
import type { VocabTables } from '../src/tables.ts';
import { byteLevelPieces, spmTables, tiktokenText, UPSTREAM } from './support/synthetic.ts';
import { readTestContainer } from './support/tsbv-test-reader.ts';

const context = {
  upstream: UPSTREAM,
  modificationNotice: 'Converted for a test.',
  generator: '@tsbs/vocab-tools@0.0.0',
};

function byteLevel(): VocabTables {
  return parseTiktokenText(tiktokenText(byteLevelPieces()), {
    tokenizerId: 'openai-o200k_base',
    specials: [
      { id: 199999, text: '<|endoftext|>' },
      { id: 200018, text: '<|endofprompt|>' },
    ],
  });
}

describe('encodeTsbv1 (03 §C.1)', () => {
  it('writes the header, the sections in canonical order and zero padding', () => {
    const { bytes, sections } = encodeTsbv1(byteLevel(), context);
    expect(new TextDecoder().decode(bytes.subarray(0, 4))).toBe('TSBV');
    expect([bytes[4], bytes[5]]).toEqual([1, 0]);
    expect(sections.map((s) => s.tag)).toEqual(['META', 'PCES', 'SPCL']);
    expect(bytes.length % 4).toBe(0);
    const decoded = readTestContainer(bytes);
    expect(decoded.tags).toEqual(['META', 'PCES', 'SPCL']);
  });

  it('round-trips bytelevel tables through an independent reader', () => {
    const tables = byteLevel();
    const decoded = readTestContainer(encodeTsbv1(tables, context).bytes);
    expect(decoded.pieces).toEqual(tables.pieces);
    expect(decoded.specials).toEqual(tables.specials);
    expect(decoded.types).toBeNull();
    expect(decoded.scores).toBeNull();
    expect(decoded.merges).toBeNull();
    expect(decoded.meta).toMatchObject({
      tokenizerId: 'openai-o200k_base',
      family: 'bytelevel-bpe',
      counts: { pieces: 263, specials: 2 },
      maxPieceBytes: 5,
      unusedCount: 0,
      idOffset: 0,
      unicodeVersion: '16.0.0',
      generator: '@tsbs/vocab-tools@0.0.0',
      modificationNotice: 'Converted for a test.',
    });
  });

  it('writes META keys in the spec order and omits undefined optional keys', () => {
    const decoded = readTestContainer(encodeTsbv1(spmTables([0, 0, 0, -1, -2, -3, 0], true), context).bytes);
    expect(Object.keys(decoded.meta)).toEqual([
      'tokenizerId',
      'family',
      'upstream',
      'counts',
      'maxPieceBytes',
      'unusedCount',
      'byteFirstId',
      'bosId',
      'eosId',
      'unkId',
      'priority',
      'fallbackOrder',
      'modificationNotice',
      'unicodeVersion',
      'generator',
    ]);
    expect(Object.keys(decoded.meta['upstream'] as object)).toEqual([
      'assetId',
      'file',
      'sha256',
      'url',
      'revision',
      'retrievedOn',
    ]);
    expect(decoded.meta['counts']).toEqual({ pieces: 7, specials: 2, merges: 2 });
  });

  it('writes PRIO for integral scores, SCRF otherwise, plus TYPS and MRGS', () => {
    const integral = spmTables([0, 0, 0, -1, -2, -3, 0], true);
    const a = readTestContainer(encodeTsbv1(integral, context).bytes);
    expect(a.tags).toEqual(['META', 'PCES', 'TYPS', 'PRIO', 'MRGS', 'SPCL']);
    expect(a.scores).toEqual([0, 0, 0, -1, -2, -3, 0]);
    expect([...(a.types ?? [])]).toEqual([...(integral.types ?? [])]);
    expect(a.merges).toEqual({ resultId: [5, 3], splitUtf16: [2, 1] });
    expect(a.family).toBe(1);

    const fractional = spmTables([0, 0, 0, -1.5, -2.25, -3, 0.5], false);
    const b = readTestContainer(encodeTsbv1(fractional, context).bytes);
    expect(b.tags).toEqual(['META', 'PCES', 'TYPS', 'SCRF', 'SPCL']);
    expect(b.scoreSection).toBe('SCRF');
    expect(b.scores).toEqual([0, 0, 0, -1.5, -2.25, -3, 0.5]);
    expect(scoresAreIntegral(Float32Array.of(1, -2))).toBe(true);
    expect(scoresAreIntegral(Float32Array.of(1, 0.5))).toBe(false);
  });

  it('agrees with the package decoder used by inspect/verify', () => {
    const tables = spmTables([0, 0, 0, -1, -2, -3, 0], true);
    const decoded = decodeContainer(encodeTsbv1(tables, context).bytes);
    expect(decoded.pieces).toEqual(tables.pieces);
    expect(decoded.merges?.resultId).toEqual(tables.merges?.resultId);
  });

  it('is deterministic, also through gzip, and gzip round-trips', () => {
    const first = encodeTsbv1(byteLevel(), context).bytes;
    const second = encodeTsbv1(byteLevel(), context).bytes;
    expect(second).toEqual(first);
    const gz = gzipDeterministic(first);
    expect(gzipDeterministic(second)).toEqual(gz);
    expect([gz[0], gz[1], gz[4], gz[5], gz[6], gz[7], gz[8], gz[9]]).toEqual([0x1f, 0x8b, 0, 0, 0, 0, 2, 255]);
    expect(gunzip(gz)).toEqual(first);
  });

  it('refuses inconsistent or unsupported tables', () => {
    const base = spmTables([0, 0, 0, -1, -2, -3, 0], true);
    expect(() => encodeTsbv1({ ...base, types: Uint8Array.of(0) }, context)).toThrow(/TYPS/);
    expect(() => encodeTsbv1({ ...base, types: Uint8Array.of(5, 3, 3, 0, 0, 0, 1) }, context)).toThrow(/UNUSED/);
    expect(() =>
      encodeTsbv1({ ...base, merges: { resultId: Uint32Array.of(5), splitUtf16: Uint8Array.of(3) } }, context),
    ).toThrow(/split/);
    expect(() =>
      encodeTsbv1({ ...base, merges: { resultId: Uint32Array.of(99), splitUtf16: Uint8Array.of(1) } }, context),
    ).toThrow(/out of range/);
    expect(() =>
      encodeTsbv1(
        {
          ...base,
          specials: [
            { id: 1, text: 'a' },
            { id: 1, text: 'b' },
          ],
        },
        context,
      ),
    ).toThrow(/duplicate/);
    expect(() => encodeTsbv1({ ...byteLevel(), types: Uint8Array.of() }, context)).toThrow();
    const long = { ...context, modificationNotice: 'x'.repeat(META_MAX_BYTES) };
    expect(() => encodeTsbv1(byteLevel(), long)).toThrow(/META/);
  });
});
