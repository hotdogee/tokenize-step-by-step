/**
 * TEST-ONLY synthetic TSBV1 writer (07 WP02): builds containers from in-memory tables so the reader can be tested for
 * round trips and, through {@link writeContainer} on hand-edited sections, for every negative format case. It
 * validates nothing on purpose. The production writer (`tsbv-writer.ts`, deterministic, all sources) belongs to WP03 in
 * `@tsbs/vocab-tools`; never import this module from production code.
 */
import type { Family } from '../../model/result.ts';
import { FAMILY_CODE, TSBV1_MAGIC, TSBV1_VERSION } from '../tsbv1.ts';

interface Utf8Encoder {
  encode(input: string): Uint8Array;
}
const encoder = new (globalThis as unknown as { TextEncoder: new () => Utf8Encoder }).TextEncoder();

/** UTF-8 bytes of `text`. */
export const utf8 = (text: string): Uint8Array => encoder.encode(text);

/** Unsigned LEB128 (minimal). */
export function varint(value: number): number[] {
  const out: number[] = [];
  let v = value;
  while (v >= 0x80) {
    out.push((v % 0x80) | 0x80);
    v = Math.floor(v / 0x80);
  }
  out.push(v);
  return out;
}

/** Zigzag-encoded signed LEB128. */
export const zigzag = (value: number): number[] => varint(value >= 0 ? value * 2 : -value * 2 - 1);

/** One section before framing. */
export interface RawSection {
  readonly tag: string;
  readonly payload: Uint8Array;
}

/** In-memory tables of one asset, in the shape the reader returns them (plus the merge list in source form). */
export interface SyntheticTables {
  readonly family: Family;
  /** Written verbatim as JSON (may be invalid on purpose). */
  readonly meta: Readonly<Record<string, unknown>>;
  readonly pieces: readonly Uint8Array[];
  readonly types?: readonly number[];
  readonly scores?: { readonly kind: 'int' | 'float'; readonly values: readonly number[] };
  /** Merges in rank order: result piece id and the UTF-16 length of the left half. */
  readonly merges?: ReadonlyArray<{ readonly result: number; readonly splitUtf16: number }>;
  readonly specials: ReadonlyArray<{ readonly id: number; readonly bytes: Uint8Array }>;
}

const bytesOf = (parts: ReadonlyArray<number | readonly number[] | Uint8Array>): Uint8Array => {
  const flat: number[] = [];
  for (const part of parts) {
    if (typeof part === 'number') flat.push(part);
    else flat.push(...part);
  }
  return Uint8Array.from(flat);
};

/** `PCES` payload: `varint count`, then `(varint len, bytes)` per piece. */
export function encodePieces(pieces: readonly Uint8Array[]): Uint8Array {
  const parts: Array<number[] | Uint8Array> = [varint(pieces.length)];
  for (const piece of pieces) parts.push(varint(piece.length), piece);
  return bytesOf(parts);
}

/** The sections of `tables` in the canonical order `META PCES TYPS PRIO|SCRF MRGS SPCL`. */
export function encodeSections(tables: SyntheticTables): RawSection[] {
  const sections: RawSection[] = [
    { tag: 'META', payload: utf8(JSON.stringify(tables.meta)) },
    { tag: 'PCES', payload: encodePieces(tables.pieces) },
  ];
  if (tables.types !== undefined) sections.push({ tag: 'TYPS', payload: Uint8Array.from(tables.types) });
  if (tables.scores?.kind === 'int') {
    const deltas: number[][] = [];
    let previous = 0;
    for (const score of tables.scores.values) {
      deltas.push(zigzag(score - previous));
      previous = score;
    }
    sections.push({ tag: 'PRIO', payload: bytesOf(deltas) });
  } else if (tables.scores?.kind === 'float') {
    const payload = new Uint8Array(tables.scores.values.length * 4);
    const view = new DataView(payload.buffer);
    tables.scores.values.forEach((score, i) => {
      view.setFloat32(i * 4, score, true);
    });
    sections.push({ tag: 'SCRF', payload });
  }
  if (tables.merges !== undefined) {
    const parts: number[][] = [varint(tables.merges.length)];
    let previous = 0;
    for (const { result, splitUtf16 } of tables.merges) {
      parts.push([...zigzag(result - previous), splitUtf16]);
      previous = result;
    }
    sections.push({ tag: 'MRGS', payload: bytesOf(parts) });
  }
  const specials: Array<number[] | Uint8Array> = [varint(tables.specials.length)];
  for (const { id, bytes } of tables.specials) specials.push(varint(id), varint(bytes.length), bytes);
  sections.push({ tag: 'SPCL', payload: bytesOf(specials) });
  return sections;
}

/** Header overrides for negative tests. */
export interface ContainerOptions {
  readonly magic?: readonly number[];
  readonly version?: number;
  readonly familyCode?: number;
  /** Declared section count (defaults to the number of sections). */
  readonly sectionCount?: number;
  /** Value of the padding bytes (0 is the only valid one). */
  readonly padByte?: number;
}

/** Frames sections into a container: 8-byte header, then `tag | u32 length | payload | zero padding` per section. */
export function writeContainer(
  family: Family,
  sections: readonly RawSection[],
  options: ContainerOptions = {},
): Uint8Array {
  const size = 8 + sections.reduce((sum, s) => sum + 8 + s.payload.length + ((4 - (s.payload.length & 3)) & 3), 0);
  const out = new Uint8Array(size);
  const view = new DataView(out.buffer);
  out.set(options.magic ?? TSBV1_MAGIC, 0);
  out[4] = options.version ?? TSBV1_VERSION;
  out[5] = options.familyCode ?? FAMILY_CODE[family];
  view.setUint16(6, options.sectionCount ?? sections.length, true);
  let pos = 8;
  for (const { tag, payload } of sections) {
    for (let i = 0; i < 4; i++) out[pos + i] = tag.charCodeAt(i);
    view.setUint32(pos + 4, payload.length, true);
    out.set(payload, pos + 8);
    pos += 8 + payload.length;
    const padding = (4 - (payload.length & 3)) & 3;
    out.fill(options.padByte ?? 0, pos, pos + padding);
    pos += padding;
  }
  return out;
}

/** `writeContainer(encodeSections(tables))` as a fresh `ArrayBuffer`. */
export function writeTsbv1(tables: SyntheticTables): ArrayBuffer {
  return writeContainer(tables.family, encodeSections(tables)).buffer as ArrayBuffer;
}

/** A valid `META` for synthetic tables (counts and `maxPieceBytes` measured), with `overrides` applied last. */
export function syntheticMeta(
  family: Family,
  pieces: readonly Uint8Array[],
  specials: number,
  overrides: Readonly<Record<string, unknown>> = {},
): Record<string, unknown> {
  return {
    tokenizerId: family === 'bytelevel-bpe' ? 'openai-o200k_base' : 'google-gemma4',
    family,
    upstream: {
      assetId: 'synthetic',
      file: 'synthetic.bin',
      sha256: '0'.repeat(64),
      url: 'https://example.invalid/synthetic',
      revision: 'test',
      retrievedOn: '2026-10-25',
    },
    counts: { pieces: pieces.length, specials },
    maxPieceBytes: pieces.reduce((max, piece) => Math.max(max, piece.length), 0),
    unusedCount: 0,
    modificationNotice: 'synthetic test asset',
    unicodeVersion: '16.0.0',
    generator: 'core/format/__tests__/tsbv1-writer',
    ...overrides,
  };
}
