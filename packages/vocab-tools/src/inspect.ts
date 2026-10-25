/**
 * A small, independent TSBV1 decoder used by `tsbs-vocab inspect` and `verify` (the production reader is WP02's
 * `readTsbv1` in `@tsbs/core/format/tsbv1`; this one only needs to list sections, decode META and pull the tables back
 * out for the round-trip check against the raw source).
 */
import { ByteReader } from './binary.ts';
import { gunzip, sha256Hex } from './compress.ts';
import { FAMILY_CODE, TSBV_MAGIC, TSBV_VERSION } from './tsbv-writer.ts';
import { hex, type SpecialEntry } from './tables.ts';
import type { TsbvMeta } from '@tsbs/core';

export interface DecodedSection {
  readonly tag: string;
  readonly offset: number;
  readonly length: number;
}

/** The container decoded into plain tables (no hashing, no engine structures). */
export interface DecodedContainer {
  readonly family: number;
  readonly sections: readonly DecodedSection[];
  readonly meta: TsbvMeta;
  readonly pieces: Uint8Array[];
  readonly types: Uint8Array | null;
  readonly scores: Float32Array | null;
  readonly merges: { readonly resultId: Uint32Array; readonly splitUtf16: Uint8Array } | null;
  readonly specials: SpecialEntry[];
}

/** Strict, and `ignoreBOM` so a special or piece that starts with U+FEFF keeps it (the default decoder drops it). */
const utf8 = new TextDecoder('utf-8', { fatal: true, ignoreBOM: true });

/** Decodes an uncompressed container; throws on structural errors. */
export function decodeContainer(bytes: Uint8Array): DecodedContainer {
  const r = new ByteReader(bytes);
  const magic = String.fromCharCode(...r.bytes(4));
  if (magic !== TSBV_MAGIC) throw new Error(`bad magic "${magic}"`);
  const version = r.u8();
  if (version !== TSBV_VERSION) throw new Error(`unknown version ${String(version)}`);
  const family = r.u8();
  const count = r.u16();
  const sections: DecodedSection[] = [];
  const payload = new Map<string, Uint8Array>();
  for (let i = 0; i < count; i++) {
    const tag = String.fromCharCode(...r.bytes(4));
    const length = r.u32();
    const offset = r.pos;
    payload.set(tag, r.bytes(length));
    sections.push({ tag, offset, length });
    r.pos += (4 - (length % 4)) % 4;
  }
  if (r.pos !== bytes.length) throw new Error(`${String(bytes.length - r.pos)} trailing bytes after the last section`);
  const metaBytes = payload.get('META');
  const pcesBytes = payload.get('PCES');
  const spclBytes = payload.get('SPCL');
  if (metaBytes === undefined || pcesBytes === undefined || spclBytes === undefined)
    throw new Error('META, PCES or SPCL missing');
  const meta = JSON.parse(utf8.decode(metaBytes)) as TsbvMeta;
  if (FAMILY_CODE[meta.family] !== family)
    throw new Error(`header family ${String(family)} disagrees with META ${meta.family}`);

  const pr = new ByteReader(pcesBytes);
  const pieces: Uint8Array[] = [];
  for (let i = pr.varint(); i > 0; i--) pieces.push(pr.bytes(pr.varint()));
  const typesBytes = payload.get('TYPS');
  const types = typesBytes === undefined ? null : typesBytes.slice();
  let scores: Float32Array | null = null;
  const prio = payload.get('PRIO');
  const scrf = payload.get('SCRF');
  if (prio !== undefined) {
    const sr = new ByteReader(prio);
    scores = new Float32Array(pieces.length);
    let value = 0;
    for (let i = 0; i < pieces.length; i++) scores[i] = value += sr.zigzag();
  } else if (scrf !== undefined) {
    const sr = new ByteReader(scrf);
    scores = new Float32Array(pieces.length);
    for (let i = 0; i < pieces.length; i++) scores[i] = sr.f32();
  }
  let merges: DecodedContainer['merges'] = null;
  const mrgs = payload.get('MRGS');
  if (mrgs !== undefined) {
    const mr = new ByteReader(mrgs);
    const m = mr.varint();
    const resultId = new Uint32Array(m);
    const splitUtf16 = new Uint8Array(m);
    let id = 0;
    for (let i = 0; i < m; i++) {
      resultId[i] = id += mr.zigzag();
      splitUtf16[i] = mr.u8();
    }
    merges = { resultId, splitUtf16 };
  }
  const sr = new ByteReader(spclBytes);
  const specials: SpecialEntry[] = [];
  for (let i = sr.varint(); i > 0; i--) {
    const id = sr.varint();
    specials.push({ id, text: utf8.decode(sr.bytes(sr.varint())) });
  }
  return { family, sections, meta, pieces, types, scores, merges, specials };
}

/** Accepts the gzip file or the raw container (sniffs `1F 8B` vs `TSBV`, like the loader, AD-37). */
export function unwrap(bytes: Uint8Array): { container: Uint8Array; layer: 'gzip' | 'raw' } {
  if (bytes[0] === 0x1f && bytes[1] === 0x8b) return { container: gunzip(bytes), layer: 'gzip' };
  return { container: bytes, layer: 'raw' };
}

function show(piece: Uint8Array | undefined): string {
  if (piece === undefined) return '-';
  try {
    return JSON.stringify(utf8.decode(piece));
  } catch {
    return `<${hex(piece)}>`;
  }
}

/** Human-readable report for `tsbs-vocab inspect`. */
export function inspectReport(file: Uint8Array): string {
  const { container, layer } = unwrap(file);
  const decoded = decodeContainer(container);
  const n = decoded.pieces.length;
  const lines = [
    `layer: ${layer}; ${String(file.length)} bytes on disk, container ${String(container.length)} bytes`,
    `sha256 (file): ${sha256Hex(file)}`,
    `sha256 (container): ${sha256Hex(container)}`,
    `sections: ${decoded.sections.map((s) => `${s.tag} ${String(s.length)}`).join(', ')}`,
    'META:',
    JSON.stringify(decoded.meta, null, 2),
    `pieces: ${String(n)}; first ${[0, 1, 2].map((i) => show(decoded.pieces[i])).join(' ')}; last ${[n - 3, n - 2, n - 1].map((i) => show(decoded.pieces[i])).join(' ')}`,
    `specials: ${String(decoded.specials.length)}; first ${decoded.specials
      .slice(0, 3)
      .map((s) => `${String(s.id)}=${s.text}`)
      .join(' ')}`,
  ];
  if (decoded.merges !== null) lines.push(`merges: ${String(decoded.merges.resultId.length)}`);
  return lines.join('\n');
}
