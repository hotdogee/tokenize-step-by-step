/**
 * `ByteVocab` on every raw upstream vocabulary (07 WP02 acceptance): every entry round-trips (bytes → index → bytes),
 * the 9 BOM-prefixed o200k keys included, the probe length stays bounded, and o200k stays within 8 MB resident. With
 * `TSBS_PERF=1` o200k must also initialise in ≤ 25 ms in Node (06 §3; the phone budget is ×4, see `../helpers/perf.ts`).
 *
 * The raw files are gitignored (`pnpm vocab:fetch`); the suite looks in `$TSBS_VOCAB_RAW`, this checkout's
 * `data/vocab/raw`, then the main checkout's when running in a git worktree, and skips when none is present.
 */
import { describe, expect, it } from 'vitest';
import { encodePieces } from '../../src/format/__tests__/tsbv1-writer.ts';
import { byteVocabFromBuffer, MAX_PROBE_LENGTH } from '../../src/format/byte-vocab.ts';
import { NODE_CEILING_MS } from '../helpers/ceilings.ts';
import { PERF_BUDGETS, time } from '../helpers/perf.ts';
import { RAW_VOCABS, rawVocabPath, readRawVocab, type RawVocabSource } from '../helpers/raw-vocab.ts';
import { findRawVocabDir } from '../helpers/repo.ts';

const RAW_DIR = findRawVocabDir();
const available = RAW_VOCABS.flatMap((source) => {
  const path = RAW_DIR === null ? null : rawVocabPath(RAW_DIR, source);
  return path === null ? [] : [[source.asset, source, path] as const];
});
const o200kPath = RAW_DIR === null ? null : rawVocabPath(RAW_DIR, RAW_VOCABS[0]!);

/** Expected entry counts (03 §C.3, research §3). */
const COUNTS: Readonly<Record<string, number>> = {
  'openai-o200k_base': 199_998,
  'openai-cl100k_base': 100_256,
  'meta-llama3-model': 128_000,
  'meta-muse-glimmer': 200_000,
  'xai-grok2': 130_944,
  'anthropic-claude-legacy': 64_995,
  'google-gemma4': 262_144,
  'google-gemma2': 256_000,
  'xai-grok1': 131_072,
  'meta-llama4-model': 200_000,
  'google-gemma3-spiece': 262_144,
};

describe.skipIf(available.length === 0)('ByteVocab over the raw vocabularies', () => {
  it('finds every shipped vocabulary', () => {
    const shipped = RAW_VOCABS.filter((s: RawVocabSource) => s.shipped).map((s) => s.asset);
    expect(available.map(([asset]) => asset)).toEqual(expect.arrayContaining(shipped));
  });

  it.each(available)('%s: every entry round-trips through indexOf / bytesOf', (asset, source, path) => {
    const pieces = readRawVocab(path, source);
    expect(pieces).toHaveLength(COUNTS[asset]!);
    const vocab = byteVocabFromBuffer(encodePieces(pieces));
    expect(vocab.count).toBe(pieces.length);
    expect(vocab.maxProbe).toBeLessThanOrEqual(MAX_PROBE_LENGTH);
    for (let i = 0; i < pieces.length; i++) {
      const piece = pieces[i]!;
      if (vocab.indexOf(piece, 0, piece.length) !== i) expect.fail(`${asset}: entry ${String(i)} not found`);
      const back = vocab.bytesOf(i);
      if (back.length !== piece.length || back.some((b, k) => b !== piece[k]))
        expect.fail(`${asset}: entry ${String(i)} differs`);
    }
    expect(vocab.maxEntryBytes).toBe(pieces.reduce((max, p) => Math.max(max, p.length), 0));
    // A slice that is never an entry: one byte longer than the longest entry.
    const long = new Uint8Array(vocab.maxEntryBytes + 1).fill(0x61);
    expect(vocab.indexOf(long, 0, long.length)).toBe(-1);
  });
});

describe.skipIf(o200kPath === null)('o200k_base specifics', () => {
  const pieces = o200kPath === null ? [] : readRawVocab(o200kPath, RAW_VOCABS[0]!);
  const payload = encodePieces(pieces);

  it('keys the 9 BOM-prefixed ranks by bytes, and pieceOf keeps the BOM', () => {
    const vocab = byteVocabFromBuffer(payload);
    const encoder = new TextEncoder();
    const bom = pieces.flatMap((p, i) => (p[0] === 0xef && p[1] === 0xbb && p[2] === 0xbf ? [i] : []));
    expect(bom).toHaveLength(9);
    for (const rank of bom) {
      expect(vocab.indexOf(pieces[rank]!, 0, pieces[rank]!.length)).toBe(rank);
      const piece = vocab.pieceOf(rank);
      expect(piece?.startsWith('\ufeff')).toBe(true);
      // A BOM-stripping (or otherwise lossy) decoder would not re-encode to the entry's bytes.
      expect(encoder.encode(piece ?? '')).toEqual(pieces[rank]);
    }
    expect(vocab.maxEntryBytes).toBe(128);
  });

  it('keeps ≤ 8 MB resident', () => {
    expect(byteVocabFromBuffer(payload).residentBytes).toBeLessThanOrEqual(8 * 2 ** 20);
  });

  it.runIf(PERF_BUDGETS)('initialises in ≤ 25 ms (median, Node; TSBS_PERF=1)', () => {
    const { cold, median } = time(() => byteVocabFromBuffer(payload));
    const vocab = byteVocabFromBuffer(payload);
    console.info(
      `[bench] o200k ByteVocab init: median ${median.toFixed(1)} ms (cold ${cold.toFixed(1)} ms); resident ` +
        `${(vocab.residentBytes / 2 ** 20).toFixed(2)} MB; max probe ${String(vocab.maxProbe)}`,
    );
    expect(median).toBeLessThanOrEqual(NODE_CEILING_MS.initO200k);
  });
});
