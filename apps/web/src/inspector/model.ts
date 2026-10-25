/**
 * The inspector's content (05 §5): for the inspected cell, the sections Token / Character / Byte / Step (and Chunk for a
 * chunk cell), each a list of labelled values with copy buttons, plus the sentences that explain partial characters
 * ("covers 2 of 3 bytes of 灣 — needs 1 more (A3)"), zero-width tokens, the fused dummy prefix, byte fallback, USER_DEFINED
 * symbols, special tokens, direct hits and the step that formed a token. Pure: built from the result, the board's units
 * and a translator, so the sentence builder is unit-tested in all three locales.
 */
import type { ResolvedTextLang, TokenizationResult } from '@tsbs/core';
import { isUnpairedSurrogateAt } from '@tsbs/core/text/analyze';
import { StepKind, TokenFlag, TokenKind } from '@tsbs/core/model/result';
import { codePointLabel, decodeUtf8, hexByte } from '@tsbs/core/text/utf8';
import type { BoardTier } from '../board/geometry.ts';
import {
  bytePiece,
  charText,
  coverageList,
  cutsChar,
  firstSpanToken,
  joinParts,
  visualGlyph,
  type Translate,
} from '../board/labels.ts';
import type { BoardUnits, CellRef } from '../board/units.ts';
import type { MessageKey } from '../i18n/en.ts';

export interface InspectorField {
  readonly key: string;
  readonly label: string;
  readonly value: string;
  readonly mono: boolean;
  /** Copy button for this value. */
  readonly copy: boolean;
  /** Glyph shown large in the text language (Character section). */
  readonly glyph?: boolean;
  /** Visually hidden explanation read after the value (e.g. what a visible  stands for). */
  readonly note?: string;
}

export interface InspectorSection {
  readonly kind: 'token' | 'char' | 'byte' | 'step' | 'chunk';
  readonly title: string;
  readonly fields: readonly InspectorField[];
  readonly notes: readonly string[];
  /** Step that "show this step" scrubs to (Token and Step sections). */
  readonly step: number | null;
}

export interface InspectorModel {
  readonly heading: string;
  /** One line for the collapsed bottom sheet. */
  readonly summary: string;
  readonly sections: readonly InspectorSection[];
  /** What `c` copies (id / hex / text) and how the status line names it. */
  readonly copyValue: string;
  /** UTF-16 range for "select in text" (whole code points). */
  readonly select: readonly [number, number] | null;
  readonly lang: ResolvedTextLang;
}

export interface InspectorInput {
  readonly result: TokenizationResult;
  readonly units: BoardUnits;
  readonly ref: CellRef;
  readonly t: Translate;
  /** The first spm piece fuses the dummy prefix (03 §B.3). */
  readonly fusedDummy: boolean;
  readonly lang: ResolvedTextLang;
  /** The scrubber position (stops 4–5): parts formed later are not "formed" yet. */
  readonly step: number;
}

const KIND_KEYS: Readonly<Record<number, MessageKey>> = {
  [TokenKind.Normal]: 'inspector.kind.normal',
  [TokenKind.Byte]: 'inspector.kind.byte',
  [TokenKind.UserDefined]: 'inspector.kind.userDefined',
  [TokenKind.Control]: 'inspector.kind.control',
  [TokenKind.Unk]: 'inspector.kind.unk',
  [TokenKind.Special]: 'inspector.kind.special',
  [TokenKind.Bos]: 'inspector.kind.bos',
  [TokenKind.DummyPrefix]: 'inspector.kind.dummyPrefix',
};

const FLAG_KEYS: ReadonlyArray<readonly [number, MessageKey]> = [
  [TokenFlag.Partial, 'inspector.flag.partial'],
  [TokenFlag.ZeroWidth, 'inspector.flag.zeroWidth'],
  [TokenFlag.Special, 'inspector.flag.special'],
  [TokenFlag.StartsMidChar, 'inspector.flag.startsMidChar'],
  [TokenFlag.EndsMidChar, 'inspector.flag.endsMidChar'],
  [TokenFlag.ByteFallback, 'inspector.flag.byteFallback'],
  [TokenFlag.UserDefined, 'inspector.flag.userDefined'],
  [TokenFlag.DirectHit, 'inspector.flag.directHit'],
];

function field(key: string, label: string, value: string, mono: boolean, copy = false): InspectorField {
  return { key, label, value, mono, copy };
}

function hexRange(result: TokenizationResult, start: number, end: number): string[] {
  const out: string[] = [];
  for (let b = start; b < end; b++) out.push(hexByte(result.utf8[b] ?? 0));
  return out;
}

function decRange(result: TokenizationResult, start: number, end: number): string {
  return Array.from(result.utf8.subarray(start, end)).join(' ');
}

/** Visible text of a byte span: decoded with stand-ins, or `⟨E7 81⟩` when it is not complete UTF-8 (04 §2.1). */
function visibleText(result: TokenizationResult, start: number, end: number): string {
  const text = decodeUtf8(result.utf8, start, end);
  if (text === null) return `⟨${hexRange(result, start, end).join(' ')}⟩`;
  if (start === end) return '';
  const first = result.byteToChar[start] ?? 0;
  const last = result.byteToChar[end - 1] ?? first;
  let out = '';
  for (let i = first; i <= last; i++) out += visualGlyph(result, i);
  return out;
}

/** The piece with SentencePiece's visible `▁` for spaces (and for a fused dummy prefix). */
function pieceText(result: TokenizationResult, start: number, end: number, fused: boolean): string | null {
  const text = decodeUtf8(result.utf8, start, end);
  if (text === null) return null;
  return (fused ? '▁' : '') + text.replaceAll(' ', '▁');
}

function span(start: number, end: number): string {
  return `[${String(start)}, ${String(end)})`;
}

/** The last recorded merge (≤ `upTo`) that produced exactly [start, end), or −1. */
function mergeThatFormed(result: TokenizationResult, start: number, end: number, upTo: number): number {
  const timeline = result.timeline;
  if (timeline === null) return -1;
  for (let k = Math.min(upTo, timeline.stepCount); k >= 1; k--) {
    if (timeline.stepLeft[k - 1] === start && timeline.stepEnd[k - 1] === end) return k;
  }
  return -1;
}

/** Sentences about the coverage of [start, end): which chars, what is missing, which tokens complete a split char. */
function coverageNotes(input: InspectorInput, start: number, end: number, tokenIndex: number): string[] {
  const { result, t } = input;
  const { chars, byteToChar, tokens } = result;
  const notes: string[] = [];
  if (end <= start) return notes;
  const glyph = (i: number): string => visualGlyph(result, i);
  notes.push(t('inspector.covers', { list: coverageList(result, start, end, t, glyph) }));
  const last = byteToChar[end - 1] ?? 0;
  const lastEnd = chars.byteStart[last + 1] ?? end;
  if (end < lastEnd) {
    notes.push(
      t('inspector.needs', { n: lastEnd - end, hex: hexRange(result, end, lastEnd).join(' '), glyph: glyph(last) }),
    );
  }
  const first = byteToChar[start] ?? 0;
  const firstStart = chars.byteStart[first] ?? start;
  if (start > firstStart && tokens.count > 0 && tokenIndex >= 0) {
    const ids: string[] = [];
    for (let b = firstStart; b < start; b++) {
      const id = String(tokens.id[result.byteToToken[b] ?? 0] ?? '');
      if (ids.at(-1) !== id) ids.push(id);
    }
    notes.push(t('inspector.completesWith', { glyph: glyph(first), ids: ids.join(t('a11y.sep')) }));
  }
  return notes;
}

function stepSection(input: InspectorInput, k: number): InspectorSection | null {
  const { result, t } = input;
  const timeline = result.timeline;
  if (timeline === null || k < 1 || k > timeline.stepCount) return null;
  const i = k - 1;
  const left = timeline.stepLeft[i] ?? 0;
  const mid = timeline.stepMid[i] ?? 0;
  const end = timeline.stepEnd[i] ?? 0;
  const split = timeline.stepKind[i] === StepKind.ByteFallbackSplit;
  const pair = split
    ? hexRange(result, left, end).join(' ')
    : `${hexRange(result, left, mid).join(' ')} + ${hexRange(result, mid, end).join(' ')}`;
  return {
    kind: 'step',
    title: t('inspector.section.step'),
    fields: [
      field('step', t('inspector.field.step'), `${String(k)} / ${String(timeline.stepCount)}`, true),
      field('pair', t('inspector.field.pair'), pair, true),
      field('result', t('inspector.field.result'), String(timeline.stepResultId[i] ?? -1), true, true),
      field('priority', t('inspector.field.priority'), String(timeline.stepRank[i] ?? 0), true),
      field('chunk', t('inspector.field.chunk'), String((timeline.stepChunk[i] ?? 0) + 1), true),
    ],
    notes: [split ? t('inspector.splitAt', { step: k }) : t('inspector.formedAt', stepParams(input, k))],
    step: k,
  };
}

function stepParams(input: InspectorInput, k: number): { step: number; left: string; right: string } {
  const timeline = input.result.timeline;
  const i = k - 1;
  const left = timeline?.stepLeft[i] ?? 0;
  const mid = timeline?.stepMid[i] ?? 0;
  const end = timeline?.stepEnd[i] ?? 0;
  return {
    step: k,
    left: hexRange(input.result, left, mid).join(' '),
    right: hexRange(input.result, mid, end).join(' '),
  };
}

function tokenSection(input: InspectorInput, index: number): InspectorSection {
  const { result, t, fusedDummy } = input;
  const { tokens, utf8, chunks } = result;
  const start = tokens.byteStart[index] ?? 0;
  const end = tokens.byteStart[index + 1] ?? 0;
  const id = tokens.id[index] ?? 0;
  const kind = tokens.kind[index] ?? 0;
  const flags = tokens.flags[index] ?? 0;
  const fused = fusedDummy && index === firstSpanToken(result);
  const notes: string[] = [];
  if (start === end) {
    notes.push(t(kind === TokenKind.DummyPrefix ? 'inspector.zeroWidthDummy' : 'inspector.zeroWidthBos'));
  } else {
    notes.push(...coverageNotes(input, start, end, index));
  }
  if (fused) notes.push(t('inspector.fusedDummy'));
  if (kind === TokenKind.Byte) notes.push(t('a11y.marker.byteFallback', { hex: bytePiece(utf8[start] ?? 0) }));
  if (kind === TokenKind.UserDefined) notes.push(t('a11y.marker.userDefined'));
  if ((flags & TokenFlag.Special) !== 0) notes.push(t('a11y.marker.special'));
  const chunk = tokens.chunk[index] ?? -1;
  if (chunk >= 0 && chunks.directHit[chunk] === 1 && end - start > 1) notes.push(t('inspector.directHit'));
  const formed = tokens.stepFormed[index] ?? -1;
  if (formed >= 1 && result.timeline !== null) {
    const split = result.timeline.stepKind[formed - 1] === StepKind.ByteFallbackSplit;
    notes.push(split ? t('inspector.splitAt', { step: formed }) : t('inspector.formedAt', stepParams(input, formed)));
  } else if (start !== end && end - start > 1) {
    notes.push(t('inspector.notFormed'));
  }
  const spm = result.family === 'spm-bpe';
  const fields: InspectorField[] = [
    field('id', t('inspector.field.id'), String(id), true, true),
    field('text', t('inspector.field.text'), visibleText(result, start, end), false),
  ];
  if (spm) {
    const piece = kind === TokenKind.Byte ? bytePiece(utf8[start] ?? 0) : pieceText(result, start, end, fused);
    if (piece !== null && start !== end) {
      const escaped = piece.includes('▁') ? { note: `▁ = ${t('a11y.standin.escapedSpace')}` } : {};
      fields.push({ ...field('piece', t('inspector.field.piece'), piece, true), ...escaped });
    }
  }
  fields.push(
    field('span', t('inspector.field.span'), span(start, end), true),
    field('length', t('inspector.field.length'), t('counts.bytes', { n: end - start }), false),
  );
  if (end > start) {
    fields.push(
      field('hex', t('inspector.field.hex'), hexRange(result, start, end).join(' '), true, true),
      field('dec', t('inspector.field.dec'), decRange(result, start, end), true),
    );
  }
  fields.push(field('kind', t('inspector.field.kind'), t(KIND_KEYS[kind] ?? 'inspector.kind.normal'), false));
  const words = FLAG_KEYS.filter(([bit]) => (flags & bit) !== 0).map(([, key]) => t(key));
  if (words.length > 0) fields.push(field('flags', t('inspector.field.flags'), words.join(t('a11y.sep')), false));
  return {
    kind: 'token',
    title: t('inspector.section.token'),
    fields,
    notes,
    step: formed >= 1 ? formed : null,
  };
}

function partSection(input: InspectorInput, index: number): InspectorSection {
  const { result, t, units } = input;
  const parts = units.parts;
  const start = parts?.partStart[index] ?? 0;
  const end = parts?.partStart[index + 1] ?? 0;
  const id = parts?.partId[index] ?? -1;
  const notes: string[] = [];
  if (start === end) notes.push(t('inspector.zeroWidthDummy'));
  else notes.push(...coverageNotes(input, start, end, -1));
  if (id < 0) notes.push(t('inspector.noId'));
  const formed = mergeThatFormed(result, start, end, input.step);
  if (formed >= 1) notes.push(t('inspector.formedAt', stepParams(input, formed)));
  const fields: InspectorField[] = [];
  if (id >= 0) fields.push(field('id', t('inspector.field.id'), String(id), true, true));
  fields.push(
    field('text', t('inspector.field.text'), visibleText(result, start, end), false),
    field('span', t('inspector.field.span'), span(start, end), true),
    field('length', t('inspector.field.length'), t('counts.bytes', { n: end - start }), false),
  );
  if (end > start) {
    fields.push(
      field('hex', t('inspector.field.hex'), hexRange(result, start, end).join(' '), true, true),
      field('dec', t('inspector.field.dec'), decRange(result, start, end), true),
    );
  }
  return { kind: 'token', title: t('inspector.section.token'), fields, notes, step: formed >= 1 ? formed : null };
}

function utf16Units(text: string): string {
  const out: string[] = [];
  for (let i = 0; i < text.length; i++) out.push(text.charCodeAt(i).toString(16).toUpperCase().padStart(4, '0'));
  return out.join(' ');
}

function charSection(input: InspectorInput, i: number): InspectorSection {
  const { result, t } = input;
  const { chars, graphemes, tokens } = result;
  const cp = chars.cp[i] ?? 0;
  const start = chars.byteStart[i] ?? 0;
  const end = chars.byteStart[i + 1] ?? 0;
  const g = chars.grapheme[i] ?? 0;
  const cps = (graphemes.charStart[g + 1] ?? 0) - (graphemes.charStart[g] ?? 0);
  const gBytes = (graphemes.byteStart[g + 1] ?? 0) - (graphemes.byteStart[g] ?? 0);
  const fields: InspectorField[] = [
    {
      key: 'glyph',
      label: t('inspector.field.char'),
      value: visualGlyph(result, i),
      mono: false,
      copy: true,
      glyph: true,
    },
    field('codePoint', t('inspector.field.codePoint'), codePointLabel(cp), true, true),
    field('utf8', t('inspector.field.utf8'), hexRange(result, start, end).join(' '), true, true),
    field('utf16', t('inspector.field.utf16'), utf16Units(charText(result, i)), true),
    field(
      'grapheme',
      t('inspector.field.grapheme'),
      t('inspector.graphemeInfo', {
        index: g,
        cps: t('counts.codePoints', { n: cps }),
        bytes: t('counts.bytes', { n: gBytes }),
      }),
      false,
    ),
  ];
  const chunk = chars.chunk[i] ?? -1;
  if (chunk >= 0) fields.push(field('chunk', t('inspector.field.chunk'), String(chunk + 1), true));
  const first = chars.tokenFirst[i] ?? -1;
  const last = chars.tokenLast[i] ?? -1;
  if (tokens.count > 0 && first >= 0) {
    const ids: string[] = [];
    for (let k = first; k <= last; k++) ids.push(String(tokens.id[k] ?? 0));
    fields.push(field('tokens', t('inspector.field.tokens'), ids.join(t('a11y.sep')), true));
  }
  const notes: string[] = [];
  if (cp === 0xfffd && isUnpaired(result, i)) notes.push(t('inspector.unpaired'));
  return { kind: 'char', title: t('inspector.section.char'), fields, notes, step: null };
}

function isUnpaired(result: TokenizationResult, i: number): boolean {
  return isUnpairedSurrogateAt(result.text, result.chars.utf16Start[i] ?? 0);
}

function byteSection(input: InspectorInput, byte: number): InspectorSection {
  const { result, t } = input;
  const { chars, byteToChar, tokens, utf8 } = result;
  const value = utf8[byte] ?? 0;
  const i = byteToChar[byte] ?? 0;
  const cs = chars.byteStart[i] ?? 0;
  const len = (chars.byteStart[i + 1] ?? cs + 1) - cs;
  let role: string;
  if (len === 1) role = t('inspector.role.ascii');
  else if (byte === cs) role = t('inspector.role.lead', { n: len });
  else role = t('inspector.role.continuation');
  const fields: InspectorField[] = [
    field('hex', t('inspector.field.hex'), hexByte(value), true, true),
    field('dec', t('inspector.field.dec'), String(value), true, true),
    field('binary', t('inspector.field.binary'), value.toString(2).padStart(8, '0'), true),
    field('role', t('inspector.field.role'), role, false),
    field('char', t('inspector.field.char'), visualGlyph(result, i), false),
  ];
  const token = tokens.count > 0 ? (result.byteToToken[byte] ?? -1) : -1;
  if (token >= 0) fields.push(field('token', t('inspector.field.token'), String(tokens.id[token] ?? 0), true));
  return { kind: 'byte', title: t('inspector.section.byte'), fields, notes: [], step: null };
}

function chunkSection(input: InspectorInput, c: number): InspectorSection {
  const { result, t } = input;
  const { chunks } = result;
  const start = chunks.byteStart[c] ?? 0;
  const end = chunks.byteStart[c + 1] ?? 0;
  const rule = chunks.rule[c] ?? 255;
  const fields: InspectorField[] = [
    field('chunk', t('inspector.field.chunk'), String(c + 1), true),
    field('text', t('inspector.field.text'), visibleText(result, start, end), false, true),
    field('span', t('inspector.field.span'), span(start, end), true),
    field('length', t('inspector.field.length'), t('counts.bytes', { n: end - start }), false),
  ];
  if (rule !== 255) fields.push(field('rule', t('inspector.field.rule'), String(rule), true));
  const tokenCount = (chunks.tokenStart[c + 1] ?? 0) - (chunks.tokenStart[c] ?? 0);
  fields.push(field('tokens', t('inspector.field.tokens'), t('counts.tokens', { n: tokenCount }), false));
  const notes = chunks.directHit[c] === 1 && end - start > 1 ? [t('inspector.directHit')] : [];
  return { kind: 'chunk', title: t('inspector.section.chunk'), fields, notes, step: null };
}

/** UTF-16 range of whole code points covering [start, end) (a zero-width unit selects the boundary). */
function utf16Range(result: TokenizationResult, start: number, end: number): readonly [number, number] {
  const { chars, byteToChar, utf8, text } = result;
  if (utf8.length === 0) return [0, 0];
  const first = start >= utf8.length ? chars.count : (byteToChar[start] ?? 0);
  if (end <= start) {
    const at = chars.utf16Start[first] ?? text.length;
    return [at, at];
  }
  const last = byteToChar[end - 1] ?? first;
  return [chars.utf16Start[first] ?? 0, chars.utf16Start[last + 1] ?? text.length];
}

function headingOf(input: InspectorInput, tier: BoardTier, index: number): string {
  const { t, units } = input;
  const count = units.count(tier);
  const params = { index: index + 1, count };
  switch (tier) {
    case 'char':
      return t('inspector.headingChar', params);
    case 'hex':
    case 'dec':
      return t('inspector.headingByte', params);
    case 'chunk':
      return t('inspector.headingChunk', params);
    case 'token':
      return units.parts === null ? t('inspector.headingToken', params) : t('inspector.headingPart', params);
  }
}

/** The inspector model of `input.ref`. */
export function inspectorModel(input: InspectorInput): InspectorModel {
  const { result, units, ref, t } = input;
  const { tier, index } = ref;
  const { start, end } = units.span(tier, index);
  const sections: InspectorSection[] = [];
  let copyValue: string;
  let summary: string;
  const tokenAt = (byte: number): number => (result.tokens.count > 0 ? (result.byteToToken[byte] ?? -1) : -1);
  switch (tier) {
    case 'char': {
      sections.push(charSection(input, index));
      const token = tokenAt(start);
      if (token >= 0) sections.push(tokenSection(input, token));
      copyValue = charText(result, index);
      summary = joinParts([visualGlyph(result, index), codePointLabel(result.chars.cp[index] ?? 0)], t);
      break;
    }
    case 'hex':
    case 'dec': {
      sections.push(byteSection(input, index), charSection(input, result.byteToChar[index] ?? 0));
      const token = tokenAt(index);
      if (token >= 0) sections.push(tokenSection(input, token));
      copyValue = hexByte(result.utf8[index] ?? 0);
      summary = joinParts(
        [copyValue, String(result.utf8[index] ?? 0), visualGlyph(result, result.byteToChar[index] ?? 0)],
        t,
      );
      break;
    }
    case 'chunk': {
      sections.push(chunkSection(input, index));
      copyValue = decodeUtf8(result.utf8, start, end) ?? hexRange(result, start, end).join(' ');
      summary = joinParts([t('board.chunk', { index: index + 1 }), span(start, end)], t);
      break;
    }
    case 'token': {
      if (units.parts === null) {
        const section = tokenSection(input, index);
        sections.push(section);
        const formed = result.tokens.stepFormed[index] ?? -1;
        const step = stepSection(input, formed);
        if (step !== null) sections.push(step);
        copyValue = String(result.tokens.id[index] ?? 0);
      } else {
        sections.push(partSection(input, index));
        const formed = mergeThatFormed(result, start, end, input.step);
        const step = stepSection(input, formed);
        if (step !== null) sections.push(step);
        const id = units.parts.partId[index] ?? -1;
        copyValue = id >= 0 ? String(id) : hexRange(result, start, end).join(' ');
      }
      if (end > start) sections.push(charSection(input, result.byteToChar[start] ?? 0));
      const coverage =
        end > start && cutsChar(result, start, end)
          ? coverageList(result, start, end, t, (i) => visualGlyph(result, i))
          : null;
      summary = joinParts([copyValue, hexRange(result, start, end).join(' '), span(start, end), coverage], t);
      break;
    }
  }
  return {
    heading: headingOf(input, tier, index),
    summary,
    sections,
    copyValue,
    select: utf16Range(result, start, end),
    lang: input.lang,
  };
}
