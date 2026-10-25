/**
 * `readTsbv1` against the test-only synthetic writer (07 WP02): round trips for both families and all three priority
 * forms deep-equal the written tables, and every negative format case throws `FormatError` with the section named.
 */
import { describe, expect, it } from 'vitest';
import type { Family } from '../../src/index.ts';
import {
  encodeSections,
  type RawSection,
  type SyntheticTables,
  syntheticMeta,
  utf8,
  varint,
  writeContainer,
  writeTsbv1,
  zigzag,
} from '../../src/format/__tests__/tsbv1-writer.ts';
import { FormatError } from '../../src/format/format-error.ts';
import { mergeRankOf, PieceType, readTsbv1 } from '../../src/format/tsbv1.ts';

const toBuffer = (bytes: Uint8Array): ArrayBuffer => bytes.slice().buffer;

/** A small byte-level asset: 256 single bytes + a few merges' results, 2 specials. */
function bytelevelTables(): SyntheticTables {
  const pieces = [
    ...Array.from({ length: 256 }, (_, b) => Uint8Array.of(b)),
    utf8('ab'),
    utf8(' the'),
    utf8('\ufeff'),
    Uint8Array.of(0xe7, 0x81),
  ];
  const specials = [
    { id: 260, bytes: utf8('<|endoftext|>') },
    { id: 261, bytes: utf8('<|endofprompt|>') },
  ];
  return { family: 'bytelevel-bpe', meta: syntheticMeta('bytelevel-bpe', pieces, 2), pieces, specials };
}

/** A small spm asset with the given priority form. */
function spmTables(priority: 'int' | 'float' | 'merge-rank'): SyntheticTables {
  const words = [
    '<unk>',
    '<s>',
    '</s>',
    '<0x00>',
    '<0xFF>',
    '▁',
    'a',
    'b',
    'ab',
    '▁ab',
    '台',
    '灣',
    '台灣',
    '𰻝',
    '𰻝a',
    '▁▁',
    '▁▁▁',
  ];
  const pieces = words.map(utf8);
  const types = words.map((w) =>
    w === '<unk>'
      ? PieceType.Unk
      : w.startsWith('<0x')
        ? PieceType.Byte
        : w.startsWith('<')
          ? PieceType.Control
          : PieceType.Normal,
  );
  const specials = [
    { id: 1, bytes: utf8('<s>') },
    { id: 2, bytes: utf8('</s>') },
  ];
  const base = { family: 'spm-bpe' as const, pieces, types, specials };
  if (priority === 'merge-rank') {
    // Rank order; '▁▁▁' is reachable by two splits (UTF-16 offsets 1 and 2), '𰻝a' splits after a surrogate pair.
    const merges = [
      { result: 8, splitUtf16: 1 }, // a|b
      { result: 15, splitUtf16: 1 }, // ▁|▁
      { result: 9, splitUtf16: 1 }, // ▁|ab
      { result: 12, splitUtf16: 1 }, // 台|灣
      { result: 16, splitUtf16: 2 }, // ▁▁|▁
      { result: 16, splitUtf16: 1 }, // ▁|▁▁
      { result: 14, splitUtf16: 2 }, // 𰻝|a
    ];
    const meta = syntheticMeta('spm-bpe', pieces, 2, {
      priority: 'merge-rank',
      fallbackOrder: 'before-merge',
      counts: { pieces: pieces.length, specials: 2, merges: merges.length },
    });
    return { ...base, meta, merges };
  }
  const values = words.map((_, i) => (priority === 'int' ? (i < 6 ? 0 : -i * 1000) : -i - 0.5));
  return {
    ...base,
    meta: syntheticMeta('spm-bpe', pieces, 2, {
      tokenizerId: 'xai-grok1',
      priority: 'score',
      fallbackOrder: 'after-merge',
      addDummyPrefix: true,
    }),
    scores: { kind: priority, values },
  };
}

/** Asserts that `readTsbv1(buf)` reproduces `tables` exactly. */
function expectRoundTrip(tables: SyntheticTables): void {
  const tsbv = readTsbv1(writeTsbv1(tables));
  expect(tsbv.family).toBe(tables.family);
  expect(tsbv.meta).toEqual(tables.meta);
  expect(tsbv.vocab.count).toBe(tables.pieces.length);
  tables.pieces.forEach((piece, i) => {
    expect(tsbv.vocab.bytesOf(i)).toEqual(piece);
    expect(tsbv.vocab.indexOf(piece, 0, piece.length)).toBe(i);
  });
  expect(tsbv.types === null ? null : Array.from(tsbv.types)).toEqual(tables.types ?? null);
  if (tables.scores === undefined) expect(tsbv.scores).toBeNull();
  else {
    expect(tsbv.scores).toBeInstanceOf(tables.scores.kind === 'int' ? Int32Array : Float32Array);
    expect(Array.from(tsbv.scores ?? [])).toEqual(tables.scores.values.map(Math.fround));
  }
  expect(tsbv.specials).toEqual(
    tables.specials.map(({ id, bytes }) => ({ id, bytes, text: new TextDecoder().decode(bytes) })),
  );
}

describe('readTsbv1 round trips (synthetic writer)', () => {
  it('byte-level: META, PCES and SPCL deep-equal; no spm sections', () => {
    const tables = bytelevelTables();
    expectRoundTrip(tables);
    const tsbv = readTsbv1(writeTsbv1(tables));
    expect(tsbv.types).toBeNull();
    expect(tsbv.merges).toBeNull();
    expect(tsbv.meta.maxPieceBytes).toBe(4);
    expect(tsbv.meta.unusedCount).toBe(0);
    expect(tsbv.vocab.pieceOf(258)).toBe('\ufeff');
    expect(tsbv.vocab.pieceOf(259)).toBeNull();
  });

  it.each(['int', 'float'] as const)('spm with %s scores (PRIO / SCRF)', (kind) => {
    expectRoundTrip(spmTables(kind));
  });

  it('spm with a merge table: MRGS becomes a CSR by result piece with byte split offsets', () => {
    const tables = spmTables('merge-rank');
    expectRoundTrip(tables);
    const { merges, vocab } = readTsbv1(writeTsbv1(tables));
    expect(merges).not.toBeNull();
    const csr = merges!;
    expect(csr.start).toHaveLength(vocab.count + 1);
    expect(csr.rank).toHaveLength(tables.merges!.length);
    tables.merges!.forEach(({ result, splitUtf16 }, rank) => {
      const piece = new TextDecoder().decode(tables.pieces[result]);
      const splitBytes = utf8(piece.slice(0, splitUtf16)).length;
      expect(mergeRankOf(csr, result, splitBytes)).toBe(rank);
    });
    expect(mergeRankOf(csr, 16, 3)).toBe(5); // ▁|▁▁ (UTF-16 offset 1 = 3 bytes)
    expect(mergeRankOf(csr, 16, 6)).toBe(4); // ▁▁|▁
    expect(mergeRankOf(csr, 14, 4)).toBe(6); // 𰻝|a: the surrogate pair is 2 UTF-16 units, 4 bytes
    expect(mergeRankOf(csr, 8, 2)).toBe(-1);
    expect(mergeRankOf(csr, 10, 1)).toBe(-1);
    // Rows are ordered by rank.
    expect(Array.from(csr.rank.subarray(csr.start[16], csr.start[17]))).toEqual([4, 5]);
  });

  it('copies every table: the container buffer is not referenced afterwards', () => {
    for (const tables of [bytelevelTables(), spmTables('int'), spmTables('merge-rank')]) {
      const buf = writeTsbv1(tables);
      const tsbv = readTsbv1(buf);
      const views = [
        tsbv.vocab.bytes,
        tsbv.vocab.offsets,
        tsbv.types,
        tsbv.scores,
        tsbv.merges?.rank,
        ...tsbv.specials.map((s) => s.bytes),
      ];
      for (const view of views) if (view != null) expect(view.buffer).not.toBe(buf);
      new Uint8Array(buf).fill(0);
      expect(tsbv.vocab.bytesOf(tables.pieces.length - 1)).toEqual(tables.pieces.at(-1));
    }
  });

  it('skips unknown sections (forward compatibility)', () => {
    const tables = bytelevelTables();
    const sections = encodeSections(tables);
    sections.splice(1, 0, { tag: 'XTRA', payload: Uint8Array.of(1, 2, 3, 4, 5) });
    expect(readTsbv1(toBuffer(writeContainer('bytelevel-bpe', sections))).vocab.count).toBe(tables.pieces.length);
  });

  it('accepts sections in any order', () => {
    const sections = encodeSections(spmTables('merge-rank')).reverse();
    expect(readTsbv1(toBuffer(writeContainer('spm-bpe', sections))).merges).not.toBeNull();
  });
});

/** Rebuilds a container from `tables` after `edit` changed its sections (and optional header overrides). */
function mutated(tables: SyntheticTables, edit: (sections: RawSection[]) => RawSection[], options = {}): ArrayBuffer {
  return toBuffer(writeContainer(tables.family, edit(encodeSections(tables)), options));
}
const replace = (tag: string, payload: Uint8Array) => (sections: RawSection[]) =>
  sections.map((s) => (s.tag === tag ? { tag, payload } : s));
const withMeta = (family: Family, tables: SyntheticTables, overrides: Record<string, unknown>) =>
  replace('META', utf8(JSON.stringify({ ...tables.meta, ...overrides, family: overrides['family'] ?? family })));

/** `tables` without the single-byte piece `byte`, `META` re-measured (so only the missing byte is wrong). */
function withoutByte(tables: SyntheticTables, byte: number): SyntheticTables {
  const pieces = tables.pieces.filter((p) => !(p.length === 1 && p[0] === byte));
  return { ...tables, pieces, meta: syntheticMeta(tables.family, pieces, tables.specials.length) };
}

describe('readTsbv1 negative format cases', () => {
  const bl = bytelevelTables();
  const spm = spmTables('int');
  const mr = spmTables('merge-rank');
  const good = new Uint8Array(writeTsbv1(bl));
  const firstPadded = encodeSections(bl).find((s) => s.payload.length % 4 !== 0)?.tag ?? 'none';

  const cases: ReadonlyArray<readonly [string, () => ArrayBuffer, string, RegExp]> = [
    ['bad magic', () => mutated(bl, (s) => s, { magic: [0x54, 0x53, 0x42, 0x57] }), 'HEAD', /bad magic/],
    ['unknown version', () => mutated(bl, (s) => s, { version: 2 }), 'HEAD', /unknown version 2/],
    ['unknown family', () => mutated(bl, (s) => s, { familyCode: 7 }), 'HEAD', /unknown family 7/],
    ['truncated header', () => toBuffer(good.subarray(0, 6)), 'HEAD', /truncated header/],
    ['truncated section', () => toBuffer(good.subarray(0, good.length - 5)), 'SPCL', /truncated section payload/],
    ['section count too high', () => mutated(bl, (s) => s, { sectionCount: 9 }), 'HEAD', /truncated section header/],
    [
      'trailing bytes',
      () => toBuffer(Uint8Array.from([...good, 0, 0, 0, 0])),
      'HEAD',
      /4 bytes after the last section/,
    ],
    ['non-zero padding', () => mutated(bl, (s) => s, { padByte: 1 }), firstPadded, /non-zero padding/],
    ['duplicate section', () => mutated(bl, (s) => [...s, s[1]!]), 'PCES', /duplicate section/],
    ['missing META', () => mutated(bl, (s) => s.filter((x) => x.tag !== 'META')), 'META', /required section missing/],
    ['missing PCES', () => mutated(bl, (s) => s.filter((x) => x.tag !== 'PCES')), 'PCES', /required section missing/],
    ['missing SPCL', () => mutated(bl, (s) => s.filter((x) => x.tag !== 'SPCL')), 'SPCL', /required section missing/],
    ['META not JSON', () => mutated(bl, replace('META', utf8('{nope'))), 'META', /not valid JSON/],
    ['META not UTF-8', () => mutated(bl, replace('META', Uint8Array.of(0x7b, 0xff, 0x7d))), 'META', /not valid UTF-8/],
    [
      'META over 4 KiB',
      () => mutated(bl, withMeta('bytelevel-bpe', bl, { pad: 'x'.repeat(4096) })),
      'META',
      /exceeds 4096/,
    ],
    [
      'META family ≠ header',
      () => mutated(bl, withMeta('bytelevel-bpe', bl, { family: 'spm-bpe' })),
      'META',
      /family spm-bpe ≠ header/,
    ],
    [
      'META unknown tokenizer',
      () => mutated(bl, withMeta('bytelevel-bpe', bl, { tokenizerId: 'gpt-9' })),
      'META',
      /unknown tokenizerId/,
    ],
    [
      'META wrong Unicode version',
      () => mutated(bl, withMeta('bytelevel-bpe', bl, { unicodeVersion: '17.0.0' })),
      'META',
      /unicodeVersion/,
    ],
    [
      'META unusedCount ≠ 0',
      () => mutated(bl, withMeta('bytelevel-bpe', bl, { unusedCount: 3 })),
      'META',
      /unusedCount must be 0/,
    ],
    [
      'META missing upstream field',
      () => mutated(bl, withMeta('bytelevel-bpe', bl, { upstream: { assetId: 'x' } })),
      'META',
      /upstream/,
    ],
    ['META bad optional field', () => mutated(bl, withMeta('bytelevel-bpe', bl, { bosId: -1 })), 'META', /bosId/],
    [
      'maxPieceBytes ≠ longest piece',
      () => mutated(bl, withMeta('bytelevel-bpe', bl, { maxPieceBytes: 3 })),
      'META',
      /maxPieceBytes 3/,
    ],
    [
      'piece count ≠ META',
      () => mutated(bl, withMeta('bytelevel-bpe', bl, { counts: { pieces: 5, specials: 2 } })),
      'PCES',
      /META says 5/,
    ],
    [
      'special count ≠ META',
      () => mutated(bl, withMeta('bytelevel-bpe', bl, { counts: { pieces: 260, specials: 1 } })),
      'SPCL',
      /META says 1/,
    ],
    [
      'counts.merges in a byte-level asset',
      () => mutated(bl, withMeta('bytelevel-bpe', bl, { counts: { pieces: 260, specials: 2, merges: 0 } })),
      'META',
      /counts\.merges 0 without MRGS/,
    ],
    [
      'counts.merges in a score asset',
      () => mutated(spm, withMeta('spm-bpe', spm, { counts: { pieces: 17, specials: 2, merges: 3 } })),
      'META',
      /counts\.merges 3 without MRGS/,
    ],
    [
      'merge-rank asset without counts.merges',
      () => mutated(mr, withMeta('spm-bpe', mr, { counts: { pieces: 17, specials: 2 } })),
      'META',
      /counts\.merges is required with MRGS/,
    ],
    ['PCES without pieces', () => mutated(spm, replace('PCES', Uint8Array.of(0))), 'PCES', /no pieces/],
    [
      'byte-level asset without a single-byte piece',
      () => writeTsbv1(withoutByte(bl, 0x7f)),
      'PCES',
      /single-byte piece 0x7F is missing/,
    ],
    ['PCES truncated entry', () => mutated(bl, replace('PCES', Uint8Array.of(1, 5, 0x61))), 'PCES', /truncated entry/],
    [
      'PCES duplicate entries',
      () => mutated(bl, replace('PCES', Uint8Array.of(2, 1, 0x61, 1, 0x61))),
      'PCES',
      /same bytes/,
    ],
    [
      'spm section in a byte-level asset',
      () => mutated(bl, (s) => [...s, { tag: 'TYPS', payload: new Uint8Array(260) }]),
      'TYPS',
      /spm only/,
    ],
    [
      'spm without TYPS',
      () => mutated(spm, (s) => s.filter((x) => x.tag !== 'TYPS')),
      'TYPS',
      /required section missing/,
    ],
    ['TYPS wrong length', () => mutated(spm, replace('TYPS', new Uint8Array(3))), 'TYPS', /3 types for 17 pieces/],
    [
      'TYPS with an UNUSED piece',
      () => mutated(spm, replace('TYPS', new Uint8Array(17).fill(5, 9, 10))),
      'TYPS',
      /UNUSED piece/,
    ],
    [
      'TYPS unknown type',
      () => mutated(spm, replace('TYPS', new Uint8Array(17).fill(9, 0, 1))),
      'TYPS',
      /unknown piece type 9/,
    ],
    [
      'spm without priority',
      () => mutated(spm, withMeta('spm-bpe', spm, { priority: undefined })),
      'META',
      /must declare priority/,
    ],
    [
      'PRIO and SCRF together',
      () => mutated(spm, (s) => [...s, { tag: 'SCRF', payload: new Uint8Array(68) }]),
      'SCRF',
      /exclusive/,
    ],
    [
      'score asset without scores',
      () => mutated(spm, (s) => s.filter((x) => x.tag !== 'PRIO')),
      'PRIO',
      /neither PRIO nor SCRF/,
    ],
    ['PRIO too short', () => mutated(spm, replace('PRIO', Uint8Array.of(0, 0))), 'PRIO', /truncated varint/],
    ['PRIO trailing bytes', () => mutated(spm, replace('PRIO', new Uint8Array(18))), 'PRIO', /1 trailing bytes/],
    [
      'SCRF wrong length',
      () => mutated(spmTables('float'), replace('SCRF', new Uint8Array(12))),
      'SCRF',
      /12 bytes for 17/,
    ],
    [
      'MRGS in a score asset',
      () => mutated(spm, (s) => [...s, { tag: 'MRGS', payload: Uint8Array.of(0) }]),
      'MRGS',
      /priority is score/,
    ],
    [
      'merge-rank asset without MRGS',
      () => mutated(mr, (s) => s.filter((x) => x.tag !== 'MRGS')),
      'MRGS',
      /required section missing/,
    ],
    [
      'MRGS result out of range',
      () => mutated(mr, replace('MRGS', Uint8Array.from([1, ...zigzag(99), 1]))),
      'MRGS',
      /result id 99/,
    ],
    [
      'MRGS split at 0',
      () => mutated(mr, replace('MRGS', Uint8Array.from([1, ...zigzag(8), 0]))),
      'MRGS',
      /split 0 is not inside/,
    ],
    [
      'MRGS split at the end',
      () => mutated(mr, replace('MRGS', Uint8Array.from([1, ...zigzag(8), 2]))),
      'MRGS',
      /split 2 is not inside/,
    ],
    [
      'MRGS split inside a surrogate pair',
      () => mutated(mr, replace('MRGS', Uint8Array.from([1, ...zigzag(14), 1]))),
      'MRGS',
      /split 1 is not inside/,
    ],
    [
      'MRGS duplicate pair',
      () => mutated(mr, replace('MRGS', Uint8Array.from([2, ...zigzag(8), 1, 0, 1]))),
      'MRGS',
      /same pair/,
    ],
    [
      'MRGS count ≠ META',
      () => mutated(mr, replace('MRGS', Uint8Array.from([1, ...zigzag(8), 1]))),
      'MRGS',
      /META says 7/,
    ],
    [
      'SPCL not UTF-8',
      () => mutated(bl, replace('SPCL', Uint8Array.from([2, 1, 1, 0xff, 2, 1, 0x61]))),
      'SPCL',
      /not valid UTF-8/,
    ],
    [
      'SPCL empty special',
      () => mutated(bl, replace('SPCL', Uint8Array.from([2, 1, 0, 2, 1, 0x61, 0]))),
      'SPCL',
      /special 0 is empty/,
    ],
    [
      'SPCL duplicate id',
      () => mutated(bl, replace('SPCL', Uint8Array.from([2, 1, 1, 0x61, 1, 1, 0x62]))),
      'SPCL',
      /special 1 repeats id 1/,
    ],
    [
      'SPCL trailing bytes',
      () => mutated(bl, replace('SPCL', Uint8Array.from([...varint(1), 1, 1, 0x61, 9]))),
      'SPCL',
      /trailing bytes/,
    ],
  ];

  it.each(cases)('%s → FormatError(%s)', (_label, build, section, reason) => {
    const buf = build();
    let caught: unknown;
    try {
      readTsbv1(buf);
    } catch (error) {
      caught = error;
    }
    expect(caught).toBeInstanceOf(FormatError);
    expect((caught as FormatError).section).toBe(section);
    expect((caught as FormatError).reason).toMatch(reason);
    expect((caught as FormatError).message).toContain(`TSBV1 ${section}`);
  });
});
