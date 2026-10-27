/**
 * Render descriptors for one packed row (05 §4, §4.1, §8): what each tier draws and says, computed from the row model and
 * the result so the Svelte components stay declarative and the hard cases are unit-testable in Node.
 *
 * - Char cells: the glyph drawn once over its byte columns, the background sliced per byte column into the owning tokens'
 *   tints with a hatched rule at every cut, stand-ins / dotted-circle bases, U+ labels, and at stops 1–2 the uniform
 *   left-packed box (`dx`, `w` in columns; AD-17).
 * - Byte cells: hex/dec, lead-byte weight, the owning token's tint, a hatched cut where a token boundary falls inside a
 *   code point.
 * - Chunk and token/part cells: one per fragment; fragments of a span share its index (one logical cell for the keyboard)
 *   and each references a visually hidden `frag-…` description; zero-width tokens are full-column marker cells (AD-25).
 *   Every chip with an id carries it inside, on every fragment and at any width (PA-17: no id line beneath): markers and
 *   byte-fallback chips over their `▁`/`BOS` or `<0xNN>`, and a bare 1-column chip's id of ≥ 5 digits on two lines (the
 *   dummy prefix's too, over a bar).
 */
import type { PartsAt, ResolvedTextLang, RowModel, TokenizationResult } from '@tsbs/core';
import { TokenFlag, TokenKind } from '@tsbs/core/model/result';
import { standInFor } from '@tsbs/core/text/stand-ins';
import { codePointLabel, hexByte } from '@tsbs/core/text/utf8';
import type { Stage } from '../app/app-state.svelte.ts';
import type { BoardTier } from './geometry.ts';
import {
  byteLabel,
  bytePiece,
  charLabel,
  charText,
  chipText,
  chunkLabel,
  chunkText,
  cutsChar,
  firstSpanToken,
  partLabel,
  tokenLabel,
  visualGlyph,
  type Translate,
} from './labels.ts';
import type { BoardUnits } from './units.ts';

/** Everything the row descriptors depend on (one object per board render). */
export interface BoardContext {
  readonly result: TokenizationResult;
  readonly units: BoardUnits;
  readonly tiers: readonly BoardTier[];
  readonly stage: Stage;
  /** No tokenizer result belongs to the text (stops 4–6 wait; no tints). */
  readonly pending: boolean;
  /** U+ labels under glyphs (stop ≥ 2 and viewport ≥ 480 px). */
  readonly uLabels: boolean;
  /** Grapheme brackets shown (the `g` toggle, and the segmenter is not the fallback). */
  readonly brackets: boolean;
  /** The first spm piece fuses the dummy prefix (`▁Hello`, 03 §B.3). */
  readonly fusedDummy: boolean;
  readonly lang: ResolvedTextLang;
  readonly t: Translate;
  readonly nfkc: NfkcSource | null;
}

export interface CharSlice {
  /** Tint index 0–7 of the owning token, −1 for none. */
  readonly tint: number;
  /** A token(-tier) boundary falls before this byte column. */
  readonly cut: boolean;
}

export interface CharCellModel {
  readonly index: number;
  /** Byte span of the code point. */
  readonly start: number;
  readonly end: number;
  readonly col: number;
  readonly span: number;
  readonly label: string;
  readonly glyph: string;
  readonly standIn: boolean;
  readonly combining: boolean;
  readonly cjk: boolean;
  readonly uLabel: string | null;
  readonly slices: readonly CharSlice[];
  /** Left-packed box offset and width in columns (stops 1–2: uniform cells; otherwise 0 and `span`). */
  readonly dx: number;
  readonly w: number;
}

export interface ByteCellModel {
  readonly index: number;
  readonly col: number;
  readonly label: string;
  readonly hex: string;
  readonly dec: number;
  readonly lead: boolean;
  readonly tint: number;
  readonly cut: boolean;
}

/** Shared by chunk and token/part fragments. */
export interface FragmentModel {
  readonly index: number;
  /** Byte span of this fragment (start === end for a marker). */
  readonly start: number;
  readonly end: number;
  readonly col: number;
  readonly span: number;
  readonly first: boolean;
  readonly last: boolean;
  readonly label: string;
  /** `frag-…` id of this fragment's visually hidden description, or null for an unfragmented span. */
  readonly describedBy: string | null;
}

export interface ChunkCellModel extends FragmentModel {
  readonly text: string;
}

export interface TokenCellModel extends FragmentModel {
  readonly variant: 'token' | 'part' | 'marker';
  readonly tint: number;
  /** Shown inside every chip at every width (PA-17). */
  readonly id: number | null;
  /** Digit count of `id` (0 for none): the chip's CSS narrows, then shrinks, the id to fit (`.d<n>`, board.css). */
  readonly digits: number;
  /** The id set on two lines (`idLines`), or null for one line. */
  readonly idLines: readonly [string, string] | null;
  readonly hatchStart: boolean;
  readonly hatchEnd: boolean;
  readonly partial: boolean;
  /** `<0xF0>` for a byte-fallback piece. */
  readonly bytePiece: string | null;
  readonly userDefined: boolean;
  readonly special: boolean;
  /** Visible text (piece/stand-ins) when there is room, else null. */
  readonly text: string | null;
  /** Marker cells: `▁` or `BOS`. */
  readonly markerText: string | null;
  readonly marker: 'dummy' | 'bos' | null;
  readonly directHit: boolean;
}

export interface BracketModel {
  readonly key: number;
  readonly col: number;
  readonly span: number;
  readonly first: boolean;
  readonly last: boolean;
}

export interface SourceRunModel {
  readonly key: number;
  readonly col: number;
  readonly span: number;
  readonly text: string;
  readonly changed: boolean;
}

export interface DescriptionModel {
  readonly id: string;
  readonly text: string;
}

export interface RowCells {
  readonly chars: CharCellModel[];
  readonly bytes: ByteCellModel[];
  readonly chunks: ChunkCellModel[];
  readonly tokens: TokenCellModel[];
  readonly brackets: BracketModel[];
  readonly sources: SourceRunModel[];
  readonly descriptions: DescriptionModel[];
}

// ---- NFKC source runs (03 §B.4, 05 §4.1) ----

/** Per output code point: the input text of its normalization run and whether the run changed. */
export interface NfkcSource {
  readonly runStart: Int32Array;
  readonly runEnd: Int32Array;
  readonly sourceOf: (i: number) => string | null;
}

/** The NFKC run map of a normalized result whose text changed, else null. */
export function nfkcSource(result: TokenizationResult): NfkcSource | null {
  const { chars, normalization, input } = result;
  const runStart = chars.sourceRunStart;
  const runEnd = chars.sourceRunEnd;
  if (normalization?.changed !== true || runStart === null || runEnd === null) return null;
  const inputOffsets: number[] = [];
  let offset = 0;
  for (const ch of input.text) {
    inputOffsets.push(offset);
    offset += ch.length;
  }
  inputOffsets.push(offset);
  const sourceText = (from: number, to: number): string =>
    input.text.slice(inputOffsets[from] ?? 0, inputOffsets[to] ?? input.text.length);
  const outputText = (i: number): string => {
    let first = i;
    while (first > 0 && runStart[first - 1] === runStart[i]) first--;
    let last = i;
    while (last + 1 < chars.count && runStart[last + 1] === runStart[i]) last++;
    return result.text.slice(chars.utf16Start[first] ?? 0, chars.utf16Start[last + 1] ?? result.text.length);
  };
  return {
    runStart,
    runEnd,
    sourceOf(i) {
      const source = sourceText(runStart[i] ?? 0, runEnd[i] ?? 0);
      return source === outputText(i) ? null : source;
    },
  };
}

// ---- helpers ----

const CJK_FROM = 0x2e80;

function tintOfByte(result: TokenizationResult, byte: number, pending: boolean): number {
  if (pending || result.tokens.count === 0) return -1;
  const token = result.byteToToken[byte] ?? -1;
  return token < 0 ? -1 : token % 8;
}

const tokenStartMarks = new WeakMap<BoardContext, Uint8Array>();

/**
 * Byte offsets where a final token starts (stops 4–6): the cuts the char and byte tiers hatch, matching the per-byte tints
 * (both follow the final tokens, so the alignment cue does not change while the merge replay runs). Computed once per
 * context, not per mounted row.
 */
function tokenStarts(ctx: BoardContext): Uint8Array {
  const cached = tokenStartMarks.get(ctx);
  if (cached !== undefined) return cached;
  const { result, stage } = ctx;
  const { tokens } = result;
  const marks = new Uint8Array(result.utf8.length + 1);
  if (!ctx.pending && stage >= 4) for (let i = 0; i < tokens.count; i++) marks[tokens.byteStart[i] ?? 0] = 1;
  tokenStartMarks.set(ctx, marks);
  return marks;
}

/** The digit count of a chip's id (0: none). */
export function digitsOf(id: number | null): number {
  return id === null ? 0 : String(id).length;
}

/**
 * The two lines of a bare 1-column chip's id (PA-17, 05 §4): an id of ≥ 5 digits that has the chip to itself (`bare`:
 * no mark, lock, hatch, badge or text shares it; the dummy-prefix marker counts as bare, its `▁` drawn as a 2 px bar
 * under the lines) is split thousands-style, the last three digits on the second line, so each line keeps the full size
 * where one line would shrink to ~8 px; null otherwise. Same rule at every breakpoint.
 */
export function idLines(
  id: number | null,
  digits: number,
  span: number,
  bare: boolean,
): readonly [string, string] | null {
  if (id === null || digits < 5 || span !== 1 || !bare) return null;
  const text = String(id);
  return [text.slice(0, -3), text.slice(-3)];
}

function descriptionId(kind: 'chunk' | 'token' | 'part', index: number, part: number): string {
  return part > 1 ? `frag-${kind}-${String(index)}-${String(part)}` : `frag-${kind}-${String(index)}`;
}

// ---- the row ----

/** The descriptors of packed row `row`. Fragment numbering follows `units.placed`. */
export function rowCells(row: RowModel, ctx: BoardContext): RowCells {
  const { result, t, units, stage, pending } = ctx;
  const { chars, chunks, graphemes } = result;
  const starts = tokenStarts(ctx);
  const descriptions: DescriptionModel[] = [];
  const tierShown = (tier: BoardTier): boolean => ctx.tiers.includes(tier);

  // Chars
  const packed = stage <= 2;
  const charCells: CharCellModel[] = row.chars.map((f, k) => {
    const i = f.spanId;
    const cp = chars.cp[i] ?? 0;
    const slices: CharSlice[] = [];
    for (let b = f.byteStart; b < f.byteEnd; b++) {
      slices.push({
        tint: stage >= 4 ? tintOfByte(result, b, pending) : -1,
        cut: b > f.byteStart && starts[b] === 1,
      });
    }
    const source = ctx.nfkc?.sourceOf(i) ?? null;
    return {
      index: i,
      start: f.byteStart,
      end: f.byteEnd,
      col: f.colStart,
      span: f.colSpan,
      label: charLabel(result, i, t, source),
      glyph: visualGlyph(result, i),
      standIn: standInFor(cp) !== null,
      combining: visualGlyph(result, i) !== charText(result, i) && standInFor(cp) === null,
      cjk: cp >= CJK_FROM,
      uLabel: ctx.uLabels && f.colSpan >= 2 ? codePointLabel(cp) : null,
      slices,
      dx: packed ? k - f.colStart : 0,
      w: packed ? 1 : f.colSpan,
    };
  });

  // Bytes (one descriptor list serves the hex and the dec row)
  const byteCells: ByteCellModel[] =
    tierShown('hex') || tierShown('dec')
      ? row.bytes.map(({ col, byte }) => {
          const value = result.utf8[byte] ?? 0;
          const charStart = chars.byteStart[result.byteToChar[byte] ?? 0] === byte;
          return {
            index: byte,
            col,
            label: byteLabelCached(ctx, byte),
            hex: hexByte(value),
            dec: value,
            lead: charStart,
            tint: stage >= 4 ? tintOfByte(result, byte, pending) : -1,
            cut: !charStart && starts[byte] === 1,
          };
        })
      : [];

  // Chunks
  const chunkCells: ChunkCellModel[] = [];
  if (tierShown('chunk')) {
    for (const f of row.chunks) {
      const c = f.spanId;
      const fragment = fragmentInfo(ctx, 'chunk', c, row.index, f.first && f.last);
      const noMerges =
        stage === 5 && chunks.directHit[c] === 1 && (chunks.byteStart[c + 1] ?? 0) - (chunks.byteStart[c] ?? 0) > 1;
      chunkCells.push({
        index: c,
        start: f.byteStart,
        end: f.byteEnd,
        col: f.colStart,
        span: f.colSpan,
        first: f.first,
        last: f.last,
        label: chunkLabel(result, c, t, noMerges),
        describedBy: fragment.id,
        text: chunkText(result, c, t, noMerges),
      });
      if (fragment.id !== null) {
        descriptions.push({
          id: fragment.id,
          text: fragmentText(ctx, 'a11y.fragmentChunk', c, fragment.part, fragment.parts, f.first),
        });
      }
    }
  }

  // Token tier: final tokens (stop 6) or live parts (stops 4–5)
  const tokenCells: TokenCellModel[] = [];
  if (tierShown('token')) {
    const parts = units.parts;
    if (parts === null) tokenCellsFinal(row, ctx, tokenCells, descriptions);
    else tokenCellsParts(row, ctx, parts, tokenCells, descriptions);
  }

  // Grapheme brackets over clusters of more than one code point
  const brackets: BracketModel[] = [];
  if (ctx.brackets && graphemes.source === 'segmenter') {
    for (const f of row.graphemes) {
      const size = (graphemes.charStart[f.spanId + 1] ?? 0) - (graphemes.charStart[f.spanId] ?? 0);
      if (size > 1) brackets.push({ key: f.spanId, col: f.colStart, span: f.colSpan, first: f.first, last: f.last });
    }
  }

  // NFKC source runs above the char tier
  const sources: SourceRunModel[] = [];
  const nfkc = ctx.nfkc;
  if (nfkc !== null) {
    let current: { key: number; col: number; end: number; text: string; changed: boolean } | null = null;
    for (const f of row.chars) {
      const runKey = nfkc.runStart[f.spanId] ?? f.spanId;
      if (current !== null && current.key === runKey) {
        current.end = f.colStart + f.colSpan;
        continue;
      }
      if (current !== null) sources.push(sourceRun(current));
      const source = nfkc.sourceOf(f.spanId);
      current = {
        key: runKey,
        col: f.colStart,
        end: f.colStart + f.colSpan,
        text: source ?? charText(result, f.spanId),
        changed: source !== null,
      };
    }
    if (current !== null) sources.push(sourceRun(current));
  }

  return {
    chars: charCells,
    bytes: byteCells,
    chunks: chunkCells,
    tokens: tokenCells,
    brackets,
    sources,
    descriptions,
  };
}

function sourceRun(run: { key: number; col: number; end: number; text: string; changed: boolean }): SourceRunModel {
  return { key: run.key, col: run.col, span: run.end - run.col, text: run.text, changed: run.changed };
}

const byteLabels = new WeakMap<BoardContext, Map<number, string>>();

/** Byte labels are the most numerous; memoise them per context (hex and dec rows share one). */
function byteLabelCached(ctx: BoardContext, byte: number): string {
  let cache = byteLabels.get(ctx);
  if (cache === undefined) {
    cache = new Map();
    byteLabels.set(ctx, cache);
  }
  let label = cache.get(byte);
  if (label === undefined) {
    label = byteLabel(ctx.result, byte, ctx.t);
    cache.set(byte, label);
  }
  return label;
}

function fragmentInfo(
  ctx: BoardContext,
  tier: 'chunk' | 'token',
  index: number,
  row: number,
  whole: boolean,
): { id: string | null; part: number; parts: number } {
  if (whole) return { id: null, part: 1, parts: 1 };
  const placed = ctx.units.placed({ tier, index });
  const part = Math.max(1, placed.findIndex((p) => p.row === row) + 1);
  const kind = tier === 'chunk' ? 'chunk' : ctx.units.parts === null ? 'token' : 'part';
  return { id: descriptionId(kind, index, part), part, parts: placed.length };
}

function fragmentText(
  ctx: BoardContext,
  key: 'a11y.fragment' | 'a11y.fragmentChunk' | 'a11y.fragmentPart',
  index: number,
  part: number,
  parts: number,
  first: boolean,
): string {
  const { t } = ctx;
  return [
    t(key, { index: index + 1, part, parts }),
    first ? null : t('a11y.marker.continued'),
    part < parts ? t('a11y.marker.continues') : null,
  ]
    .filter((s): s is string => s !== null)
    .join(t('a11y.sep'));
}

function tokenCellsFinal(
  row: RowModel,
  ctx: BoardContext,
  out: TokenCellModel[],
  descriptions: DescriptionModel[],
): void {
  const { result, t } = ctx;
  const { tokens, utf8, chunks } = result;
  const spm = result.family === 'spm-bpe';
  const fused = ctx.fusedDummy ? firstSpanToken(result) : -1;
  for (const { col, token } of row.markers) {
    const kind = tokens.kind[token] ?? 0;
    const id = tokens.id[token] ?? 0;
    const dummy = kind === TokenKind.DummyPrefix;
    out.push({
      index: token,
      start: tokens.byteStart[token] ?? 0,
      end: tokens.byteStart[token] ?? 0,
      col,
      span: 1,
      first: true,
      last: true,
      label: tokenLabel(result, token, t, false),
      describedBy: null,
      variant: 'marker',
      tint: -1,
      id,
      digits: digitsOf(id),
      idLines: idLines(id, digitsOf(id), 1, dummy), // BOS keeps one line: its text line says BOS
      hatchStart: false,
      hatchEnd: false,
      partial: false,
      bytePiece: null,
      userDefined: false,
      special: !dummy,
      text: null,
      markerText: dummy ? '▁' : t('board.bos'),
      marker: dummy ? 'dummy' : 'bos',
      directHit: false,
    });
  }
  for (const f of row.tokens) {
    const i = f.spanId;
    const start = tokens.byteStart[i] ?? 0;
    const end = tokens.byteStart[i + 1] ?? 0;
    const flags = tokens.flags[i] ?? 0;
    const kind = tokens.kind[i] ?? 0;
    const fragment = fragmentInfo(ctx, 'token', i, row.index, f.first && f.last);
    const id = tokens.id[i] ?? 0;
    const chunk = tokens.chunk[i] ?? -1;
    const text = f.first && f.colSpan >= 4 ? chipText(result, start, end, t, spm, i === fused) : null;
    const partial = (flags & TokenFlag.Partial) !== 0;
    const special = (flags & TokenFlag.Special) !== 0;
    // Nothing shares the chip with the id: no continuation mark, hatch, lock, badge or byte piece (a chip shows its text
    // from 4 columns only, and idLines wants one).
    const bare = f.first && f.last && !partial && !special && kind !== TokenKind.Byte && kind !== TokenKind.UserDefined;
    out.push({
      index: i,
      start: f.byteStart,
      end: f.byteEnd,
      col: f.colStart,
      span: f.colSpan,
      first: f.first,
      last: f.last,
      label: tokenLabel(result, i, t, i === fused, text?.spoken ?? null),
      describedBy: fragment.id,
      variant: 'token',
      tint: i % 8,
      id,
      digits: digitsOf(id),
      idLines: idLines(id, digitsOf(id), f.colSpan, bare),
      hatchStart: kind !== TokenKind.Byte && f.first && (flags & TokenFlag.StartsMidChar) !== 0,
      hatchEnd: kind !== TokenKind.Byte && f.last && (flags & TokenFlag.EndsMidChar) !== 0,
      partial,
      bytePiece: kind === TokenKind.Byte ? bytePiece(utf8[start] ?? 0) : null,
      userDefined: kind === TokenKind.UserDefined,
      special,
      text: text?.visible ?? null,
      markerText: null,
      marker: null,
      directHit: chunk >= 0 && chunks.directHit[chunk] === 1 && end - start > 1,
    });
    if (fragment.id !== null) {
      descriptions.push({
        id: fragment.id,
        text: fragmentText(ctx, 'a11y.fragment', i, fragment.part, fragment.parts, f.first),
      });
    }
  }
}

function tokenCellsParts(
  row: RowModel,
  ctx: BoardContext,
  parts: PartsAt,
  out: TokenCellModel[],
  descriptions: DescriptionModel[],
): void {
  const { result, t } = ctx;
  const count = parts.partStart.length - 1;
  for (const f of row.parts) {
    if (f.colSpan <= 0) continue;
    const p = f.spanId;
    const start = parts.partStart[p] ?? 0;
    const end = parts.partStart[p + 1] ?? 0;
    const partId = parts.partId[p] ?? -1;
    const id = partId >= 0 ? partId : null;
    if (start === end) {
      out.push({
        index: p,
        start,
        end,
        col: f.colStart,
        span: 1,
        first: true,
        last: true,
        label: partLabel(result, p, count, start, end, partId, t),
        describedBy: null,
        variant: 'marker',
        tint: -1,
        id,
        digits: digitsOf(id),
        idLines: idLines(id, digitsOf(id), 1, true), // the dummy prefix: its ▁ becomes a bar under two lines
        hatchStart: false,
        hatchEnd: false,
        partial: false,
        bytePiece: null,
        userDefined: false,
        special: false,
        text: null,
        markerText: '▁',
        marker: 'dummy',
        directHit: false,
      });
      continue;
    }
    const fragment = fragmentInfo(ctx, 'token', p, row.index, f.first && f.last);
    const token = result.byteToToken[start] ?? -1;
    const exact = token >= 0 && result.tokens.byteStart[token] === start && result.tokens.byteStart[token + 1] === end;
    const kind = exact ? (result.tokens.kind[token] ?? 0) : -1;
    const piece = kind === TokenKind.Byte ? bytePiece(result.utf8[start] ?? 0) : null;
    const hexes: string[] = [];
    for (let b = f.byteStart; b < f.byteEnd; b++) hexes.push(hexByte(result.utf8[b] ?? 0));
    out.push({
      index: p,
      start: f.byteStart,
      end: f.byteEnd,
      col: f.colStart,
      span: f.colSpan,
      first: f.first,
      last: f.last,
      label: partLabel(result, p, count, start, end, partId, t, piece, kind === TokenKind.UserDefined),
      describedBy: fragment.id,
      variant: 'part',
      tint: token < 0 ? -1 : token % 8,
      id,
      digits: digitsOf(id),
      idLines: null, // a part's hex always sits under its id
      // Partial hatching is a stop-6 cue (05 §2); live parts say "partial" in their label only.
      hatchStart: false,
      hatchEnd: false,
      partial: cutsChar(result, start, end),
      bytePiece: piece,
      userDefined: kind === TokenKind.UserDefined,
      special: false,
      text: hexes.join(' '),
      markerText: null,
      marker: null,
      directHit: false,
    });
    if (fragment.id !== null) {
      descriptions.push({
        id: fragment.id,
        text: fragmentText(ctx, 'a11y.fragmentPart', p, fragment.part, fragment.parts, f.first),
      });
    }
  }
}
