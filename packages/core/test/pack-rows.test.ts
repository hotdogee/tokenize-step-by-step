/**
 * `packRows` (05 §3.2): properties on fixture results for random K (never splits a code point; rows ≤ K; fragments tile
 * every span; waste bound with markers; markers stay with their code point; deterministic) and the named marker cases.
 */
import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import {
  analyzeText,
  buildResult,
  ChunkKind,
  fromFixtureCase,
  packRows,
  TokenizationView,
  TokenKind,
  withParts,
  type Fragment,
  type RowModel,
  type SpmFixtureCase,
  type TiktokenFixtureCase,
  type TokenizationResult,
} from '../src/index.ts';
import { loadFixture, REFS, SHIPPING } from './helpers/fixtures.ts';
import { RUNS } from './helpers/runs.ts';

/** Groups fragments by span id (checking each fragment's row). */
function collect(
  rows: readonly RowModel[],
  pick: (row: RowModel) => readonly Fragment[],
  problems: string[],
): Map<number, Fragment[]> {
  const out = new Map<number, Fragment[]>();
  for (const row of rows) {
    for (const f of pick(row)) {
      if (f.row !== row.index) problems.push(`fragment of span ${String(f.spanId)} has row ${String(f.row)}`);
      const list = out.get(f.spanId) ?? [];
      list.push(f);
      out.set(f.spanId, list);
    }
  }
  return out;
}

/** Fragments of each span tile its bytes exactly, in row order, with first/last on the ends. */
function tilingProblems(
  label: string,
  spans: Map<number, Fragment[]>,
  expected: ReadonlyArray<readonly [number, number]>,
  problems: string[],
): void {
  expected.forEach(([s, e], id) => {
    if (e === s) return;
    const frags = spans.get(id) ?? [];
    const name = `${label} ${String(id)}`;
    if (frags.length === 0) problems.push(`${name} has no fragment`);
    if (frags[0]?.byteStart !== s || frags[frags.length - 1]?.byteEnd !== e)
      problems.push(`${name} does not span its bytes`);
    frags.forEach((f, i) => {
      if (f.first !== (i === 0) || f.last !== (i === frags.length - 1)) problems.push(`${name}: first/last wrong`);
      if (i > 0 && f.byteStart !== frags[i - 1]?.byteEnd) problems.push(`${name}: fragments do not tile`);
      if (f.colSpan !== f.byteEnd - f.byteStart) problems.push(`${name}: colSpan is not its byte count`);
    });
  });
}

function spansOf(starts: ArrayLike<number>, count: number): Array<readonly [number, number]> {
  return Array.from({ length: count }, (_, i) => [starts[i] ?? 0, starts[i + 1] ?? 0] as const);
}

/** Every 05 §3.2 property of `rows`; returns the violations (empty when all hold). */
function rowProblems(result: TokenizationResult, K: number, rows: readonly RowModel[]): string[] {
  const problems: string[] = [];
  const { chars, tokens, utf8 } = result;
  const zeroWidthAt = new Map<number, number[]>();
  for (let t = 0; t < tokens.count; t++) {
    const s = tokens.byteStart[t] ?? 0;
    if (s === tokens.byteStart[t + 1]) zeroWidthAt.set(s, [...(zeroWidthAt.get(s) ?? []), t]);
  }
  const maxMarkers = Math.max(0, ...[...zeroWidthAt.values()].map((l) => l.length));
  const maxUnit = 4 + maxMarkers;
  // rows ≤ K, indices, every column used exactly once, bytes in order, waste bound
  let nextByte = 0;
  rows.forEach((row, r) => {
    if (row.index !== r) problems.push(`row ${String(r)} has index ${String(row.index)}`);
    if (row.columns > K) problems.push(`row ${String(r)} has ${String(row.columns)} > K columns`);
    const cols = [...row.markers.map((m) => m.col), ...row.bytes.map((b) => b.col)].sort((a, b) => a - b);
    if (cols.length !== row.columns || cols.some((c, i) => c !== i))
      problems.push(`row ${String(r)} columns are not 0..n-1`);
    for (const { byte } of row.bytes) if (byte !== nextByte++) problems.push(`row ${String(r)}: byte out of order`);
    if (K >= 8 && r < rows.length - 1 && K - row.columns > maxUnit - 1)
      problems.push(`row ${String(r)} wastes too much`);
  });
  if (nextByte !== utf8.length) problems.push('rows do not cover every byte');
  // code points never split; markers immediately before their code point
  const charFrags = collect(rows, (row) => row.chars, problems);
  for (let i = 0; i < chars.count; i++) {
    const frags = charFrags.get(i) ?? [];
    const f = frags[0];
    const row = rows[f?.row ?? -1];
    if (frags.length !== 1 || f === undefined || row === undefined) {
      problems.push(`char ${String(i)} has ${String(frags.length)} fragments`);
      continue;
    }
    if (f.colSpan !== (chars.byteStart[i + 1] ?? 0) - (chars.byteStart[i] ?? 0))
      problems.push(`char ${String(i)} colSpan`);
    const markers = zeroWidthAt.get(chars.byteStart[i] ?? 0) ?? [];
    markers.forEach((t, k) => {
      const col = f.colStart - markers.length + k;
      if (!row.markers.some((m) => m.col === col && m.token === t))
        problems.push(`marker ${String(t)} is not before char ${String(i)}`);
    });
  }
  for (const t of zeroWidthAt.get(utf8.length) ?? []) {
    if (!rows.some((row) => row.markers.some((m) => m.token === t)))
      problems.push(`trailing marker ${String(t)} missing`);
  }
  const g = result.graphemes;
  tilingProblems(
    'grapheme',
    collect(rows, (row) => row.graphemes, problems),
    spansOf(g.byteStart, g.count),
    problems,
  );
  const c = result.chunks;
  tilingProblems(
    'chunk',
    collect(rows, (row) => row.chunks, problems),
    spansOf(c.byteStart, c.count),
    problems,
  );
  tilingProblems(
    'token',
    collect(rows, (row) => row.tokens, problems),
    spansOf(tokens.byteStart, tokens.count),
    problems,
  );
  return problems;
}

function checkRows(result: TokenizationResult, K: number, rows: readonly RowModel[]): void {
  expect(rowProblems(result, K, rows)).toEqual([]);
}

const allCases = SHIPPING.flatMap((id) =>
  (loadFixture(id).cases as ReadonlyArray<TiktokenFixtureCase | SpmFixtureCase>).map((c) => [id, c.name] as const),
);

describe('packRows properties (fast-check over fixture cases × K)', () => {
  it('holds for random cases, K and addBos', () => {
    fc.assert(
      fc.property(
        fc.constantFrom(...allCases),
        fc.integer({ min: 8, max: 64 }),
        fc.boolean(),
        fc.nat(),
        ([id, name], K, addBos, stepSeed) => {
          const result = fromFixtureCase(loadFixture(id), name, REFS[id], { addBos });
          const view = new TokenizationView(result);
          const step = stepSeed % (view.stepCount + 1);
          const parts = view.partsAt(step);
          const rows = packRows(result, K, { parts });
          const problems = rowProblems(result, K, rows);
          const partFrags = collect(rows, (row) => row.parts.filter((f) => f.byteEnd > f.byteStart), problems);
          tilingProblems('part', partFrags, spansOf(parts.partStart, parts.partStart.length - 1), problems);
          expect(problems).toEqual([]);
          expect(packRows(result, K, { parts })).toEqual(rows);
          expect(withParts(packRows(result, K), result, parts)).toEqual(rows);
        },
      ),
      { numRuns: RUNS },
    );
  }, 60_000);

  it('rejects a non-positive K', () => {
    const result = fromFixtureCase(loadFixture('openai-o200k_base'), 'zh-tw-tainan', REFS['openai-o200k_base']);
    expect(() => packRows(result, 0)).toThrow(RangeError);
    expect(() => packRows(result, 2.5)).toThrow(RangeError);
  });
});

describe('packRows named cases', () => {
  it('Grok-1 zh-tw-tainan: the dummy marker takes a full column before 台', () => {
    const result = fromFixtureCase(loadFixture('xai-grok1'), 'zh-tw-tainan', REFS['xai-grok1']);
    const rows = packRows(result, 9);
    expect(rows).toHaveLength(2);
    expect(rows[0]?.markers).toEqual([{ col: 0, token: 0 }]);
    expect(rows[0]?.chars.map((f) => [f.spanId, f.colStart, f.colSpan])).toEqual([
      [0, 1, 3],
      [1, 4, 3],
    ]);
    expect(rows[0]?.columns).toBe(7);
    expect(rows[1]?.chars.map((f) => f.colStart)).toEqual([0, 3]);
    // the zero-width leading part (no timeline: final tokens) sits on the marker column
    const parts = new TokenizationView(result).partsAt(0);
    const withLead = packRows(result, 9, { parts });
    expect(withLead[0]?.parts[0]).toMatchObject({ spanId: 0, colStart: 0, colSpan: 1, byteStart: 0, byteEnd: 0 });
    checkRows(result, 9, rows);
  });

  it('Grok-1 + addBos: two markers before code point 0', () => {
    const result = fromFixtureCase(loadFixture('xai-grok1'), 'zh-tw-tainan', REFS['xai-grok1'], { addBos: true });
    const rows = packRows(result, 8);
    expect(rows[0]?.markers).toEqual([
      { col: 0, token: 0 },
      { col: 1, token: 1 },
    ]);
    expect(rows[0]?.chars[0]?.colStart).toBe(2);
    expect(result.tokens.kind[0]).toBe(TokenKind.Bos);
    checkRows(result, 8, rows);
  });

  it('Llama 3 addBos on empty: one trailing marker column', () => {
    const result = fromFixtureCase(loadFixture('meta-llama3'), 'empty', REFS['meta-llama3'], { addBos: true });
    const rows = packRows(result, 9);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ columns: 1, byteStart: 0, byteEnd: 0, markers: [{ col: 0, token: 0 }] });
    checkRows(result, 9, rows);
  });

  it('a trailing marker after a full row opens a new row', () => {
    const analysis = analyzeText('abcdefgh');
    const result = buildResult({
      tokenizer: 'meta-llama3',
      family: 'bytelevel-bpe',
      analysis,
      chunks: { byteStart: [0, 8], kind: [ChunkKind.Regex] },
      tokens: { id: [1, 2], byteStart: [0, 8, 8], kind: [TokenKind.Normal, TokenKind.Special] },
      timeline: null,
    });
    const rows = packRows(result, 8);
    expect(rows).toHaveLength(2);
    expect(rows[1]).toMatchObject({ columns: 1, markers: [{ col: 0, token: 1 }], byteStart: 8, byteEnd: 8 });
  });

  it('empty text packs into one empty row', () => {
    const result = fromFixtureCase(loadFixture('openai-o200k_base'), 'empty', REFS['openai-o200k_base']);
    expect(packRows(result, 8)).toEqual([
      {
        index: 0,
        byteStart: 0,
        byteEnd: 0,
        columns: 0,
        chars: [],
        markers: [],
        bytes: [],
        graphemes: [],
        chunks: [],
        tokens: [],
        parts: [],
      },
    ]);
  });

  it('splits a long token into fragments across rows (👩‍👩‍👧 grapheme on o200k, K = 8)', () => {
    const result = fromFixtureCase(loadFixture('openai-o200k_base'), 'emoji-family-zwj', REFS['openai-o200k_base']);
    const rows = packRows(result, 8);
    const grapheme = collect(rows, (row) => row.graphemes, []).get(0) ?? [];
    expect(grapheme.length).toBeGreaterThan(1);
    expect(grapheme[0]?.first).toBe(true);
    expect(grapheme[grapheme.length - 1]?.last).toBe(true);
    checkRows(result, 8, rows);
  });
});
