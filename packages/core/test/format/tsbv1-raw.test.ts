/**
 * `readTsbv1` on full-size containers built from the raw files with the synthetic writer: o200k (META + PCES + SPCL)
 * reads back deep-equal, and Gemma 4's 514,906 merges (MRGS → CSR with UTF-16 → byte split offsets) read back so that
 * every merge's rank is found again, within 12 MB resident. With `TSBS_PERF=1` the 25 ms / 40 ms Node budgets are
 * asserted too (06 §3, see `../helpers/perf.ts`). Skips when the raw files are absent (see `byte-vocab-raw.test.ts`).
 */
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { syntheticMeta, utf8, writeTsbv1 } from '../../src/format/__tests__/tsbv1-writer.ts';
import type { ByteVocabStats } from '../../src/format/byte-vocab.ts';
import { mergeRankOf, PieceType, readTsbv1 } from '../../src/format/tsbv1.ts';
import { PERF_BUDGETS, time } from '../helpers/perf.ts';
import { RAW_VOCABS, rawVocabPath, readRawVocab } from '../helpers/raw-vocab.ts';
import { findRawVocabDir } from '../helpers/repo.ts';

const RAW_DIR = findRawVocabDir();
const o200kPath = RAW_DIR === null ? null : rawVocabPath(RAW_DIR, RAW_VOCABS[0]!);
const gemma4Path =
  RAW_DIR === null
    ? null
    : rawVocabPath(
        RAW_DIR,
        RAW_VOCABS.find((s) => s.asset === 'google-gemma4')!,
      );

/** Memoises `build`, so the tests of one suite share one expensive container and a skipped suite builds nothing. */
function once<T>(build: () => T): () => T {
  let cached: { value: T } | null = null;
  return () => (cached ??= { value: build() }).value;
}

describe.skipIf(o200kPath === null)('o200k_base container', () => {
  const fixture = once(() => {
    const pieces = readRawVocab(o200kPath!, RAW_VOCABS[0]!);
    const specials = [
      { id: 199_999, bytes: utf8('<|endoftext|>') },
      { id: 200_018, bytes: utf8('<|endofprompt|>') },
    ];
    const buf = writeTsbv1({
      family: 'bytelevel-bpe',
      meta: syntheticMeta('bytelevel-bpe', pieces, 2),
      pieces,
      specials,
    });
    return { pieces, buf };
  });

  it('reads back deep-equal', () => {
    const { pieces, buf } = fixture();
    const tsbv = readTsbv1(buf);
    expect(tsbv.meta.maxPieceBytes).toBe(128);
    expect(tsbv.vocab.count).toBe(199_998);
    expect(tsbv.specials.map((s) => s.text)).toEqual(['<|endoftext|>', '<|endofprompt|>']);
    for (let i = 0; i < pieces.length; i += 997) expect(tsbv.vocab.bytesOf(i)).toEqual(pieces[i]);
  });

  it.runIf(PERF_BUDGETS)('initialises in ≤ 25 ms (median, Node; TSBS_PERF=1)', () => {
    const { buf } = fixture();
    const { cold, median } = time(() => readTsbv1(buf), 7);
    console.info(`[bench] o200k readTsbv1: median ${median.toFixed(1)} ms (cold ${cold.toFixed(1)} ms)`);
    expect(median).toBeLessThanOrEqual(25);
  });
});

interface HfSpmJson {
  model: { vocab: Record<string, number>; merges: Array<[string, string]>; unk_token: string };
  added_tokens: Array<{ id: number; content: string; special: boolean }>;
}

describe.skipIf(gemma4Path === null)('google-gemma4 container with MRGS', () => {
  const fixture = once(() => {
    const doc = JSON.parse(readFileSync(gemma4Path!, 'utf8')) as HfSpmJson;
    const words: string[] = [];
    for (const [piece, id] of Object.entries(doc.model.vocab)) words[id] = piece;
    const pieces = words.map(utf8);
    const control = new Set(doc.added_tokens.filter((t) => t.special).map((t) => t.id));
    const unk = doc.model.vocab[doc.model.unk_token];
    const types = words.map((w, id) =>
      /^<0x[0-9A-F]{2}>$/.test(w)
        ? PieceType.Byte
        : id === unk
          ? PieceType.Unk
          : control.has(id)
            ? PieceType.Control
            : PieceType.Normal,
    );
    const merges = doc.model.merges.map(([left, right]) => ({
      result: doc.model.vocab[left + right]!,
      splitUtf16: left.length,
    }));
    const specials = doc.added_tokens.filter((t) => t.special).map((t) => ({ id: t.id, bytes: utf8(t.content) }));
    const meta = syntheticMeta('spm-bpe', pieces, specials.length, {
      priority: 'merge-rank',
      fallbackOrder: 'before-merge',
      counts: { pieces: pieces.length, specials: specials.length, merges: merges.length },
    });
    const buf = writeTsbv1({ family: 'spm-bpe', meta, pieces, types, merges, specials });
    return { doc, merges, buf };
  });

  it('reads 514,906 merges back into a CSR that finds every rank, with ≤ 12 MB resident', () => {
    const { doc, merges, buf } = fixture();
    expect(merges).toHaveLength(514_906);
    const tsbv = readTsbv1(buf);
    const csr = tsbv.merges!;
    const resident =
      (tsbv.vocab as ByteVocabStats).residentBytes +
      tsbv.types!.byteLength +
      csr.start.byteLength +
      csr.splitByteOffset.byteLength +
      csr.rank.byteLength;
    expect(tsbv.meta.maxPieceBytes).toBe(93);
    expect(Array.from(tsbv.types!.subarray(238, 494)).every((t) => t === PieceType.Byte)).toBe(true);
    doc.model.merges.forEach(([left], rank) => {
      const { result } = merges[rank]!;
      if (mergeRankOf(csr, result, utf8(left).length) !== rank)
        expect.fail(`merge ${String(rank)} (${left}|…) not found`);
    });
    expect(resident).toBeLessThanOrEqual(12 * 2 ** 20);
  });

  it.runIf(PERF_BUDGETS)('reads PCES + TYPS + MRGS → CSR in ≤ 40 ms (median, Node; TSBS_PERF=1)', () => {
    const { buf } = fixture();
    const { cold, median } = time(() => readTsbv1(buf), 7);
    console.info(
      `[bench] gemma4 readTsbv1 (PCES + TYPS + MRGS → CSR): median ${median.toFixed(1)} ms (cold ${cold.toFixed(1)} ms)`,
    );
    expect(median).toBeLessThanOrEqual(40);
  });
});
