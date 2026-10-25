/**
 * Minimal readers for the raw upstream vocabularies (TEST-ONLY): each returns the entry bytes in index order, i.e. the
 * `PCES` content a TSBV1 container would carry (byte-level: index = rank = id − idOffset; spm: index = piece id, bytes =
 * UTF-8 of the piece string). The production parsers, with all their assertions, belong to WP03 (03 §C.5).
 */
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

/** One raw vocabulary: where it lives and how to read its entries. */
export interface RawVocabSource {
  /** Manifest asset id (directory under `data/vocab/raw`). */
  readonly asset: string;
  readonly file: string;
  readonly format: 'tiktoken-text' | 'claude-json' | 'grok2-json' | 'hf-bytelevel-json' | 'hf-spm-json' | 'spm-proto';
  /** Shipped in v1 (OD-4) or an oracle-only cross-check asset. */
  readonly shipped: boolean;
}

/** Every vocabulary file under `data/vocab/raw` (nine shipped assets plus the two oracle-only model files). */
export const RAW_VOCABS: readonly RawVocabSource[] = [
  { asset: 'openai-o200k_base', file: 'o200k_base.tiktoken', format: 'tiktoken-text', shipped: true },
  { asset: 'openai-cl100k_base', file: 'cl100k_base.tiktoken', format: 'tiktoken-text', shipped: true },
  { asset: 'meta-llama3-model', file: 'tokenizer.model', format: 'tiktoken-text', shipped: true },
  { asset: 'meta-muse-glimmer', file: 'tokenizer.json', format: 'hf-bytelevel-json', shipped: true },
  { asset: 'xai-grok2', file: 'tokenizer.tok.json', format: 'grok2-json', shipped: true },
  { asset: 'anthropic-claude-legacy', file: 'claude.json', format: 'claude-json', shipped: true },
  { asset: 'google-gemma4', file: 'tokenizer.json', format: 'hf-spm-json', shipped: true },
  { asset: 'google-gemma2', file: 'tokenizer.model', format: 'spm-proto', shipped: true },
  { asset: 'xai-grok1', file: 'tokenizer.model', format: 'spm-proto', shipped: true },
  { asset: 'meta-llama4-model', file: 'tokenizer.model', format: 'tiktoken-text', shipped: false },
  { asset: 'google-gemma3-spiece', file: 'gemma3_cleaned_262144_v2.spiece.model', format: 'spm-proto', shipped: false },
];

/** Path of a raw vocabulary under `dir`, or null when it was not fetched. */
export function rawVocabPath(dir: string, source: RawVocabSource): string | null {
  const path = join(dir, source.asset, source.file);
  return existsSync(path) ? path : null;
}

/** Places `bytes` at `index`, refusing gaps and duplicates of an index. */
function dense(entries: ReadonlyArray<readonly [number, Uint8Array]>): Uint8Array[] {
  const out: Uint8Array[] = new Array<Uint8Array>(entries.length);
  for (const [index, bytes] of entries) {
    if (index < 0 || index >= entries.length || out[index] !== undefined)
      throw new Error(`index ${String(index)} not dense`);
    out[index] = bytes;
  }
  return out;
}

const base64 = (text: string) => new Uint8Array(Buffer.from(text, 'base64'));
const utf8 = (text: string) => new Uint8Array(Buffer.from(text, 'utf8'));

/** `base64 rank` lines (tiktoken; also Llama 3/4 `tokenizer.model`). */
function readTiktokenText(path: string): Uint8Array[] {
  const lines = readFileSync(path, 'utf8')
    .split('\n')
    .filter((line) => line !== '');
  return dense(
    lines.map((line) => {
      const [b64 = '', rank = ''] = line.split(' ');
      return [Number(rank), base64(b64)] as const;
    }),
  );
}

/** `claude.json` `bpe_ranks`: js-tiktoken lines `<first> <offset> <b64> <b64> …`; index = id − 5 (specials 0–4). */
function readClaudeJson(path: string): Uint8Array[] {
  const doc = JSON.parse(readFileSync(path, 'utf8')) as { bpe_ranks: string };
  const entries: Array<readonly [number, Uint8Array]> = [];
  for (const line of doc.bpe_ranks.split('\n')) {
    const [, offset = '0', ...tokens] = line.split(' ');
    tokens.forEach((token, i) => entries.push([Number(offset) + i - 5, base64(token)]));
  }
  return dense(entries);
}

/** Grok-2 `tokenizer.tok.json` `regular_tokens[{bytes, token}]`; index = id − 128. */
function readGrok2Json(path: string): Uint8Array[] {
  const doc = JSON.parse(readFileSync(path, 'utf8')) as { regular_tokens: Array<{ bytes: number[]; token: number }> };
  return dense(doc.regular_tokens.map(({ bytes, token }) => [token - 128, Uint8Array.from(bytes)] as const));
}

/** GPT-2 `bytes_to_unicode` inverse: printable stand-in character → byte. */
function gpt2UnicodeToByte(): Map<string, number> {
  const printable = (b: number) => (b >= 0x21 && b <= 0x7e) || (b >= 0xa1 && b <= 0xac) || (b >= 0xae && b <= 0xff);
  const map = new Map<string, number>();
  let extra = 0;
  for (let b = 0; b < 256; b++) map.set(String.fromCodePoint(printable(b) ? b : 256 + extra++), b);
  return map;
}

/** HF byte-level BPE `tokenizer.json` (Muse Glimmer): `model.vocab` keys spelled with the GPT-2 byte alphabet. */
function readHfByteLevelJson(path: string): Uint8Array[] {
  const doc = JSON.parse(readFileSync(path, 'utf8')) as { model: { vocab: Record<string, number> } };
  const toByte = gpt2UnicodeToByte();
  return dense(
    Object.entries(doc.model.vocab).map(([key, id]) => {
      const bytes = Uint8Array.from(Array.from(key).map((ch) => toByte.get(ch) ?? Number.NaN));
      if (bytes.some(Number.isNaN)) throw new Error(`non-byte character in ${key}`);
      return [id, bytes] as const;
    }),
  );
}

/** HF SentencePiece-style `tokenizer.json` (Gemma 4): `model.vocab` piece strings with `▁`. */
function readHfSpmJson(path: string): Uint8Array[] {
  const doc = JSON.parse(readFileSync(path, 'utf8')) as { model: { vocab: Record<string, number> } };
  return dense(Object.entries(doc.model.vocab).map(([piece, id]) => [id, utf8(piece)] as const));
}

/** SentencePiece `ModelProto`: repeated field 1 `SentencePiece { piece = 1 (string) }` (minimal protobuf walk). */
function readSpmProto(path: string): Uint8Array[] {
  const buf = new Uint8Array(readFileSync(path));
  const pieces: Uint8Array[] = [];
  let pos = 0;
  const varint = (): number => {
    let value = 0;
    let scale = 1;
    for (;;) {
      const byte = buf[pos++]!;
      value += (byte & 0x7f) * scale;
      if (byte < 0x80) return value;
      scale *= 128;
    }
  };
  const skip = (wire: number) => {
    if (wire === 0) varint();
    else if (wire === 1) pos += 8;
    else if (wire === 2) {
      const len = varint(); // read before using pos: `pos += varint()` would add to the old pos
      pos += len;
    } else if (wire === 5) pos += 4;
    else throw new Error(`wire type ${String(wire)}`);
  };
  while (pos < buf.length) {
    const key = varint();
    if (key >>> 3 !== 1 || (key & 7) !== 2) {
      skip(key & 7);
      continue;
    }
    const size = varint();
    const end = pos + size;
    let piece: Uint8Array | null = null;
    while (pos < end) {
      const inner = varint();
      if (inner >>> 3 === 1 && (inner & 7) === 2) {
        const len = varint();
        piece = buf.slice(pos, pos + len);
        pos += len;
      } else {
        skip(inner & 7);
      }
    }
    if (piece === null) throw new Error(`piece ${String(pieces.length)} has no string`);
    pieces.push(piece);
  }
  return pieces;
}

/** Reads the entries of a raw vocabulary in index order. */
export function readRawVocab(path: string, source: RawVocabSource): Uint8Array[] {
  switch (source.format) {
    case 'tiktoken-text':
      return readTiktokenText(path);
    case 'claude-json':
      return readClaudeJson(path);
    case 'grok2-json':
      return readGrok2Json(path);
    case 'hf-bytelevel-json':
      return readHfByteLevelJson(path);
    case 'hf-spm-json':
      return readHfSpmJson(path);
    case 'spm-proto':
      return readSpmProto(path);
  }
}
