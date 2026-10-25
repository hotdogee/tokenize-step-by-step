/**
 * A minimal TSBV1 reader written from the spec (03 §C.1) for the writer → reader round trip. It deliberately shares no
 * code with `src/` (own varint, zigzag and section walk) so a symmetric bug in the writer's encoders cannot cancel out.
 * WP02's production `readTsbv1` is checked against the same assets in real-assets.test.ts once it exists.
 */

export interface TestDecoded {
  version: number;
  family: number;
  tags: string[];
  meta: Record<string, unknown>;
  pieces: Uint8Array[];
  types: Uint8Array | null;
  scores: number[] | null;
  scoreSection: 'PRIO' | 'SCRF' | null;
  merges: { resultId: number[]; splitUtf16: number[] } | null;
  specials: Array<{ id: number; text: string }>;
}

class Cursor {
  pos = 0;
  private readonly data: Uint8Array;
  private readonly limit: number;
  constructor(data: Uint8Array) {
    this.data = data;
    this.limit = data.length;
  }
  byte(): number {
    if (this.pos >= this.limit) throw new Error(`read past end at ${String(this.pos)}`);
    return this.data[this.pos++] ?? 0;
  }
  uvar(): number {
    let value = 0;
    let mul = 1;
    for (;;) {
      const b = this.byte();
      value += (b & 127) * mul;
      if (b < 128) return value;
      mul *= 128;
    }
  }
  svar(): number {
    const u = this.uvar();
    return u % 2 === 0 ? u / 2 : -(u + 1) / 2;
  }
  take(n: number): Uint8Array {
    if (this.pos + n > this.limit) throw new Error(`slice past end at ${String(this.pos)}`);
    const out = this.data.subarray(this.pos, this.pos + n);
    this.pos += n;
    return out;
  }
  get atEnd(): boolean {
    return this.pos === this.limit;
  }
}

export function readTestContainer(bytes: Uint8Array): TestDecoded {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const magic = new TextDecoder().decode(bytes.subarray(0, 4));
  if (magic !== 'TSBV') throw new Error('bad magic');
  const version = bytes[4] ?? -1;
  const family = bytes[5] ?? -1;
  const count = view.getUint16(6, true);
  let offset = 8;
  const sections = new Map<string, Uint8Array>();
  const tags: string[] = [];
  for (let i = 0; i < count; i++) {
    const tag = new TextDecoder().decode(bytes.subarray(offset, offset + 4));
    const length = view.getUint32(offset + 4, true);
    const payload = bytes.subarray(offset + 8, offset + 8 + length);
    if (payload.length !== length) throw new Error(`section ${tag} truncated`);
    const padded = Math.ceil(length / 4) * 4;
    for (let p = offset + 8 + length; p < offset + 8 + padded; p++)
      if (bytes[p] !== 0) throw new Error(`non-zero padding after ${tag}`);
    sections.set(tag, payload);
    tags.push(tag);
    offset += 8 + padded;
  }
  if (offset !== bytes.length) throw new Error('trailing bytes');
  const need = (tag: string): Uint8Array => {
    const s = sections.get(tag);
    if (s === undefined) throw new Error(`missing ${tag}`);
    return s;
  };
  const meta = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(need('META'))) as Record<string, unknown>;
  const pc = new Cursor(need('PCES'));
  const pieces: Uint8Array[] = [];
  const n = pc.uvar();
  for (let i = 0; i < n; i++) pieces.push(pc.take(pc.uvar()).slice());
  if (!pc.atEnd) throw new Error('PCES has trailing bytes');
  const typesSection = sections.get('TYPS');
  if (typesSection !== undefined && typesSection.length !== n) throw new Error('TYPS length');
  let scores: number[] | null = null;
  let scoreSection: TestDecoded['scoreSection'] = null;
  const prio = sections.get('PRIO');
  const scrf = sections.get('SCRF');
  if (prio !== undefined) {
    scoreSection = 'PRIO';
    const c = new Cursor(prio);
    scores = [];
    let v = 0;
    for (let i = 0; i < n; i++) scores.push((v += c.svar()));
    if (!c.atEnd) throw new Error('PRIO has trailing bytes');
  } else if (scrf !== undefined) {
    scoreSection = 'SCRF';
    const dv = new DataView(scrf.buffer, scrf.byteOffset, scrf.byteLength);
    scores = Array.from({ length: n }, (_, i) => dv.getFloat32(4 * i, true));
  }
  let merges: TestDecoded['merges'] = null;
  const mrgs = sections.get('MRGS');
  if (mrgs !== undefined) {
    const c = new Cursor(mrgs);
    const m = c.uvar();
    merges = { resultId: [], splitUtf16: [] };
    let id = 0;
    for (let i = 0; i < m; i++) {
      merges.resultId.push((id += c.svar()));
      merges.splitUtf16.push(c.byte());
    }
    if (!c.atEnd) throw new Error('MRGS has trailing bytes');
  }
  const sc = new Cursor(need('SPCL'));
  const specials: Array<{ id: number; text: string }> = [];
  const s = sc.uvar();
  const utf8 = new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }); // keeps a leading U+FEFF
  for (let i = 0; i < s; i++) {
    const id = sc.uvar();
    specials.push({ id, text: utf8.decode(sc.take(sc.uvar())) });
  }
  if (!sc.atEnd) throw new Error('SPCL has trailing bytes');
  return {
    version,
    family,
    tags,
    meta,
    pieces,
    types: typesSection?.slice() ?? null,
    scores,
    scoreSection,
    merges,
    specials,
  };
}
