/**
 * `readTsbv1` (03 §C.1–C.2): decodes a TSBV1 container into the in-memory tables both engines use. The layout is the
 * FROZEN one of `./README.md`; the in-memory types are the FROZEN ones of `./types.ts`.
 *
 * Reader rules beyond the byte layout (each violation throws {@link FormatError}):
 * - header: magic `TSBV`, version 1, family 0/1; sections tile the file exactly (zero padding to 4 bytes, no trailing
 *   bytes); a known tag appears at most once; unknown tags are skipped (forward compatibility);
 * - `META`, `PCES` and `SPCL` are required; `META.family` matches the header; `PCES` holds at least one piece;
 *   `META.counts.pieces` / `.specials` match `PCES` / `SPCL`, and `.merges` is present exactly when `MRGS` is and
 *   matches it; `META.maxPieceBytes` equals the longest `PCES` entry (it bounds the engines' merge window, 04 §2.1);
 * - spm: `TYPS` is required and holds no UNUSED (5) or unknown type; `META.priority` is required and selects exactly one
 *   of `PRIO`/`SCRF` (`score`) or `MRGS` (`merge-rank`); byte-level: none of `TYPS PRIO SCRF MRGS` may appear, and all
 *   256 single bytes are pieces (Engine A's 1-byte direct hits rely on it, 03 §C.1);
 * - `MRGS`: result ids in range, split offsets strictly inside the result piece and on a code-point boundary;
 * - `SPCL`: non-empty, valid UTF-8 texts with unique ids.
 *
 * Every table is an own copy: once `readTsbv1` returns, the container `ArrayBuffer` (incl. the 1 MB `MRGS` payload of
 * Gemma 4) is unreferenced and can be collected (03 §C.2).
 */
import type { Family } from '../model/result.ts';
import type { ByteVocab, Tsbv1, TsbvMeta } from './types.ts';
import { byteVocabFromBuffer } from './byte-vocab.ts';
import { FormatError } from './format-error.ts';
import { parseMeta } from './meta.ts';
import { createStrictUtf8Decoder, decodeUtf8OrNull } from './utf8.ts';
import { ByteReader } from './varint.ts';

/** The four magic bytes `TSBV`. */
export const TSBV1_MAGIC: readonly number[] = [0x54, 0x53, 0x42, 0x56];
/** The only container version this reader accepts. */
export const TSBV1_VERSION = 1;
/** Family byte of the header. */
export const FAMILY_CODE: Readonly<Record<Family, number>> = { 'bytelevel-bpe': 0, 'spm-bpe': 1 };
/** `TYPS` values (SentencePiece proto piece types). */
export const PieceType = { Normal: 0, UserDefined: 1, Byte: 2, Control: 3, Unk: 4, Unused: 5 } as const;

const KNOWN_TAGS: ReadonlySet<string> = new Set(['META', 'PCES', 'TYPS', 'PRIO', 'SCRF', 'MRGS', 'SPCL']);
const HEADER_BYTES = 8;

/** Payload span of one section in the container. */
interface Section {
  readonly start: number;
  readonly end: number;
}

/** Merge table in CSR form (`Tsbv1.merges`). */
type MergeTable = NonNullable<Tsbv1['merges']>;

/** Parses the header and the section table; returns the family and the known sections by tag. */
function readSections(bytes: Uint8Array): { family: Family; sections: Map<string, Section> } {
  const head = new ByteReader(bytes, 'HEAD');
  head.need(HEADER_BYTES, 'header');
  if (TSBV1_MAGIC.some((byte, i) => bytes[i] !== byte)) throw head.error('bad magic (expected "TSBV")');
  head.pos = 4;
  const version = head.u8();
  if (version !== TSBV1_VERSION) throw head.error(`unknown version ${String(version)}`, 4);
  const familyCode = head.u8();
  const family = familyCode === 0 ? 'bytelevel-bpe' : familyCode === 1 ? 'spm-bpe' : null;
  if (family === null) throw head.error(`unknown family ${String(familyCode)}`, 5);
  const sectionCount = head.u8() | (head.u8() << 8);

  const sections = new Map<string, Section>();
  for (let s = 0; s < sectionCount; s++) {
    const at = head.pos;
    head.need(8, `section header ${String(s)}`);
    const tagBytes = bytes.subarray(at, at + 4);
    if (tagBytes.some((b) => b < 0x20 || b > 0x7e)) throw head.error(`section ${String(s)} has a non-ASCII tag`, at);
    const tag = String.fromCharCode(...tagBytes);
    head.pos += 4;
    const length = head.u32();
    const reader = new ByteReader(bytes, tag, head.pos);
    reader.need(length, 'section payload');
    const start = head.pos;
    const end = start + length;
    const padding = (4 - (end & 3)) & 3;
    reader.pos = end;
    reader.need(padding, 'section padding');
    for (let p = end; p < end + padding; p++) if (bytes[p] !== 0) throw reader.error('non-zero padding', p);
    head.pos = end + padding;
    if (!KNOWN_TAGS.has(tag)) continue;
    if (sections.has(tag)) throw reader.error('duplicate section', at);
    sections.set(tag, { start, end });
  }
  if (head.remaining !== 0) throw head.error(`${String(head.remaining)} bytes after the last section`);
  return { family, sections };
}

/** `TYPS`: one `u8` per piece, NORMAL…UNK only. */
function readTypes(bytes: Uint8Array, section: Section, count: number): Uint8Array {
  const length = section.end - section.start;
  if (length !== count)
    throw new FormatError('TYPS', section.start, `${String(length)} types for ${String(count)} pieces`);
  const types = bytes.slice(section.start, section.end);
  const bad = types.findIndex((t) => t >= PieceType.Unused);
  if (bad >= 0) {
    const what = types[bad] === PieceType.Unused ? 'UNUSED piece (unsupported, 04 §3.2)' : 'unknown piece type';
    throw new FormatError('TYPS', section.start + bad, `${what} ${String(types[bad])} at index ${String(bad)}`);
  }
  return types;
}

/** `PRIO`: zigzag deltas of the rounded scores. */
function readIntScores(bytes: Uint8Array, section: Section, count: number): Int32Array {
  const reader = new ByteReader(bytes, 'PRIO', section.start, section.end);
  const scores = new Int32Array(count);
  let score = 0;
  for (let i = 0; i < count; i++) {
    score += reader.zigzag();
    if (score < -0x80000000 || score > 0x7fffffff) throw reader.error(`score ${String(i)} overflows int32`);
    scores[i] = score;
  }
  if (reader.remaining !== 0) throw reader.error(`${String(reader.remaining)} trailing bytes`);
  return scores;
}

/** `SCRF`: one little-endian float32 per piece. */
function readFloatScores(bytes: Uint8Array, section: Section, count: number): Float32Array {
  const reader = new ByteReader(bytes, 'SCRF', section.start, section.end);
  if (reader.remaining !== count * 4)
    throw reader.error(`${String(reader.remaining)} bytes for ${String(count)} float32 scores`);
  const view = new DataView(bytes.buffer, bytes.byteOffset + section.start, count * 4);
  const scores = new Float32Array(count);
  for (let i = 0; i < count; i++) scores[i] = view.getFloat32(i * 4, true);
  return scores;
}

/** Byte offset of UTF-16 offset `units` inside entry `index`, or −1 when it is not strictly inside, on a boundary. */
function utf16ToByteOffset(vocab: ByteVocab, index: number, units: number): number {
  const { bytes, offsets } = vocab;
  const start = offsets[index] ?? 0;
  const end = offsets[index + 1] ?? 0;
  let pos = start;
  let seen = 0;
  while (seen < units && pos < end) {
    const lead = bytes[pos] ?? 0;
    if (lead < 0x80) pos += 1;
    else if (lead >= 0xc2 && lead <= 0xdf) pos += 2;
    else if (lead >= 0xe0 && lead <= 0xef) pos += 3;
    else if (lead >= 0xf0 && lead <= 0xf4) {
      pos += 4;
      seen++;
    } else return -1;
    seen++;
  }
  return units > 0 && seen === units && pos < end ? pos - start : -1;
}

/** `MRGS`: merges in rank order → CSR by result piece, split offsets converted from UTF-16 units to bytes. */
function readMerges(bytes: Uint8Array, section: Section, vocab: ByteVocab): MergeTable {
  const reader = new ByteReader(bytes, 'MRGS', section.start, section.end);
  const m = reader.varint();
  if (m * 2 > reader.remaining) throw reader.error(`merge count ${String(m)} does not fit in the section`);
  const resultOf = new Uint32Array(m);
  const splitOf = new Uint8Array(m);
  const start = new Uint32Array(vocab.count + 1);
  let result = 0;
  for (let rank = 0; rank < m; rank++) {
    const at = reader.pos;
    result += reader.zigzag();
    if (result < 0 || result >= vocab.count)
      throw reader.error(`merge ${String(rank)}: result id ${String(result)} out of range`, at);
    const units = reader.u8();
    const split = utf16ToByteOffset(vocab, result, units);
    if (split < 0 || split > 0xff) {
      throw reader.error(`merge ${String(rank)}: split ${String(units)} is not inside piece ${String(result)}`, at);
    }
    resultOf[rank] = result;
    splitOf[rank] = split;
    start[result + 1] = (start[result + 1] ?? 0) + 1;
  }
  if (reader.remaining !== 0) throw reader.error(`${String(reader.remaining)} trailing bytes`);
  for (let i = 0; i < vocab.count; i++) start[i + 1] = (start[i + 1] ?? 0) + (start[i] ?? 0);
  const fill = start.slice(0, vocab.count);
  const splitByteOffset = new Uint8Array(m);
  const rankOut = new Uint32Array(m);
  for (let rank = 0; rank < m; rank++) {
    const piece = resultOf[rank] ?? 0;
    const slot = fill[piece] ?? 0;
    fill[piece] = slot + 1;
    const split = splitOf[rank] ?? 0;
    for (let k = start[piece] ?? 0; k < slot; k++) {
      if (splitByteOffset[k] === split)
        throw reader.error(`merges ${String(rankOut[k])} and ${String(rank)} are the same pair`);
    }
    splitByteOffset[slot] = split;
    rankOut[slot] = rank;
  }
  return { start, splitByteOffset, rank: rankOut };
}

/** `SPCL`: special tokens in source order, text decoded strictly. */
function readSpecials(bytes: Uint8Array, section: Section): Tsbv1['specials'] {
  const reader = new ByteReader(bytes, 'SPCL', section.start, section.end);
  const decoder = createStrictUtf8Decoder();
  const count = reader.varint();
  if (count * 3 > reader.remaining) throw reader.error(`count ${String(count)} does not fit in the section`);
  const specials: Array<{ id: number; bytes: Uint8Array; text: string }> = [];
  const ids = new Set<number>();
  for (let i = 0; i < count; i++) {
    const at = reader.pos;
    const id = reader.varint();
    if (ids.has(id)) throw reader.error(`special ${String(i)} repeats id ${String(id)}`, at);
    ids.add(id);
    const len = reader.varint();
    if (len === 0) throw reader.error(`special ${String(i)} is empty`, at);
    reader.need(len, `special ${String(i)}`);
    const own = bytes.slice(reader.pos, reader.pos + len);
    reader.pos += len;
    const text = decodeUtf8OrNull(decoder, own);
    if (text === null) throw reader.error(`special ${String(i)} is not valid UTF-8`, at);
    specials.push({ id, bytes: own, text });
  }
  if (reader.remaining !== 0) throw reader.error(`${String(reader.remaining)} trailing bytes`);
  return specials;
}

/** Byte-level `PCES` must hold every single byte as a piece (03 §C.1). */
function assertSingleBytes(vocab: ByteVocab, base: number): void {
  const one = new Uint8Array(1);
  for (let b = 0; b < 256; b++) {
    one[0] = b;
    if (vocab.indexOf(one, 0, 1) < 0) {
      const hex = b.toString(16).toUpperCase().padStart(2, '0');
      throw new FormatError('PCES', base, `single-byte piece 0x${hex} is missing`);
    }
  }
}

function required(sections: Map<string, Section>, tag: string): Section {
  const section = sections.get(tag);
  if (section === undefined) throw new FormatError(tag, 0, 'required section missing');
  return section;
}

function forbid(sections: Map<string, Section>, tags: readonly string[], why: string): void {
  for (const tag of tags) {
    const section = sections.get(tag);
    if (section !== undefined) throw new FormatError(tag, section.start, `unexpected section (${why})`);
  }
}

/** Decodes a TSBV1 container (03 §C.1–C.2). Throws {@link FormatError} on any violation listed in the file comment. */
export function readTsbv1(buf: ArrayBuffer): Tsbv1 {
  const bytes = new Uint8Array(buf);
  const { family, sections } = readSections(bytes);

  const metaSection = required(sections, 'META');
  const meta: TsbvMeta = parseMeta(bytes.subarray(metaSection.start, metaSection.end), metaSection.start);
  if (meta.family !== family)
    throw new FormatError('META', metaSection.start, `family ${meta.family} ≠ header ${family}`);

  const pcesSection = required(sections, 'PCES');
  const vocab = byteVocabFromBuffer(bytes.subarray(pcesSection.start, pcesSection.end), pcesSection.start);
  if (vocab.count === 0) throw new FormatError('PCES', pcesSection.start, 'no pieces');
  if (vocab.count !== meta.counts.pieces) {
    throw new FormatError(
      'PCES',
      pcesSection.start,
      `${String(vocab.count)} pieces, META says ${String(meta.counts.pieces)}`,
    );
  }
  if (vocab.maxEntryBytes !== meta.maxPieceBytes) {
    throw new FormatError(
      'META',
      metaSection.start,
      `maxPieceBytes ${String(meta.maxPieceBytes)} ≠ longest piece ${String(vocab.maxEntryBytes)}`,
    );
  }

  let types: Uint8Array | null = null;
  let scores: Int32Array | Float32Array | null = null;
  let merges: MergeTable | null = null;
  if (family === 'bytelevel-bpe') {
    forbid(sections, ['TYPS', 'PRIO', 'SCRF', 'MRGS'], 'spm only');
    assertSingleBytes(vocab, pcesSection.start);
  } else {
    types = readTypes(bytes, required(sections, 'TYPS'), vocab.count);
    if (meta.priority === 'score') {
      forbid(sections, ['MRGS'], 'priority is score');
      const prio = sections.get('PRIO');
      const scrf = sections.get('SCRF');
      if (prio !== undefined && scrf !== undefined)
        throw new FormatError('SCRF', scrf.start, 'PRIO and SCRF are exclusive');
      if (prio !== undefined) scores = readIntScores(bytes, prio, vocab.count);
      else if (scrf !== undefined) scores = readFloatScores(bytes, scrf, vocab.count);
      else throw new FormatError('PRIO', 0, 'priority is score but neither PRIO nor SCRF is present');
    } else if (meta.priority === 'merge-rank') {
      forbid(sections, ['PRIO', 'SCRF'], 'priority is merge-rank');
      const mrgs = required(sections, 'MRGS');
      merges = readMerges(bytes, mrgs, vocab);
      const declared = meta.counts.merges;
      if (declared === undefined)
        throw new FormatError('META', metaSection.start, 'counts.merges is required with MRGS');
      if (declared !== merges.rank.length) {
        throw new FormatError(
          'MRGS',
          mrgs.start,
          `${String(merges.rank.length)} merges, META says ${String(declared)}`,
        );
      }
    } else {
      throw new FormatError('META', metaSection.start, 'spm assets must declare priority');
    }
  }
  if (merges === null && meta.counts.merges !== undefined) {
    throw new FormatError('META', metaSection.start, `counts.merges ${String(meta.counts.merges)} without MRGS`);
  }

  const spclSection = required(sections, 'SPCL');
  const specials = readSpecials(bytes, spclSection);
  if (specials.length !== meta.counts.specials) {
    throw new FormatError(
      'SPCL',
      spclSection.start,
      `${String(specials.length)} specials, META says ${String(meta.counts.specials)}`,
    );
  }
  return { meta, family, vocab, types, scores, merges, specials };
}

/**
 * Rank of the merge that forms piece `index` with its left half `splitByteOffset` bytes long, or −1 (HF: a split that
 * is not in the merge list is not mergeable, 04 §3.2). Scans the piece's CSR row, which is ordered by rank.
 */
export function mergeRankOf(merges: MergeTable, index: number, splitByteOffset: number): number {
  const end = merges.start[index + 1] ?? 0;
  for (let k = merges.start[index] ?? 0; k < end; k++) {
    if (merges.splitByteOffset[k] === splitByteOffset) return merges.rank[k] ?? -1;
  }
  return -1;
}
