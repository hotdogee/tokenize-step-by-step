/**
 * Synthetic vocabularies for parser and writer tests: 256 single bytes plus a few multi-byte entries ("≈ 20-entry
 * synthetic inputs", 03 §C.5), in each upstream format.
 */
import { Buffer } from 'node:buffer';
import { encodeByteLevelKey } from '../../src/sources/gpt2-bytes.ts';
import { PieceType, type VocabTables } from '../../src/tables.ts';

const enc = new TextEncoder();

/** 256 single bytes, then extra multi-byte entries. */
export function byteLevelPieces(
  extra: readonly string[] = ['he', 'll', 'hell', 'hello', ' wor', '台', '灣'],
): Uint8Array[] {
  const pieces: Uint8Array[] = [];
  for (let b = 0; b < 256; b++) pieces.push(Uint8Array.of(b));
  for (const text of extra) pieces.push(enc.encode(text));
  return pieces;
}

/** `base64 rank` lines. */
export function tiktokenText(pieces: readonly Uint8Array[]): string {
  return pieces.map((p, rank) => `${Buffer.from(p).toString('base64')} ${String(rank)}`).join('\n') + '\n';
}

/** A claude.json-shaped document. */
export function claudeJson(pieces: readonly Uint8Array[], patStr: string): string {
  return JSON.stringify({
    explicit_n_vocab: 12345,
    pat_str: patStr,
    special_tokens: { '<EOT>': 0, '<META>': 1, '<META_START>': 2, '<META_END>': 3, '<SOS>': 4 },
    bpe_ranks: `! 5 ${pieces.map((p) => Buffer.from(p).toString('base64')).join(' ')}`,
  });
}

/** A tokenizer.tok.json-shaped document (Grok-2): ids 128 + index, 128 specials. */
export function grok2Json(pieces: readonly Uint8Array[]): Record<string, unknown> {
  return {
    reserved_tokens: 128,
    regular_tokens: pieces.map((p, i) => ({ bytes: [...p], token: 128 + i })),
    special_tokens: Array.from({ length: 128 }, (_, i) => ({
      bytes: [...enc.encode(`<|special_${String(i)}|>`)],
      token: i,
    })),
    word_split: 'V1',
    vocab_size: 128 + pieces.length,
  };
}

/** An HF byte-level tokenizer.json (Glimmer-shaped). */
export function hfByteLevelJson(
  pieces: readonly Uint8Array[],
  splitRegex: string,
  specials = 3,
): Record<string, unknown> {
  return {
    version: '1.0',
    added_tokens: Array.from({ length: specials }, (_, i) => ({
      id: pieces.length + i,
      content: i === 0 ? '<|begin_of_text|>' : `<|reserved_${String(i)}|>`,
      special: true,
    })),
    normalizer: null,
    pre_tokenizer: {
      type: 'Sequence',
      pretokenizers: [
        { type: 'Split', pattern: { Regex: splitRegex }, behavior: 'Isolated', invert: false },
        { type: 'ByteLevel', add_prefix_space: false, trim_offsets: true, use_regex: false },
      ],
    },
    model: {
      type: 'BPE',
      ignore_merges: true,
      byte_fallback: false,
      vocab: Object.fromEntries(pieces.map((p, i) => [encodeByteLevelKey(p), i])),
      merges: [],
    },
  };
}

/** A Gemma-4-shaped HF tokenizer.json + tokenizer_config.json with byte fallback and a merge list. */
export function hfSpmJson(): { json: Record<string, unknown>; config: Record<string, unknown> } {
  const pieces: string[] = ['<pad>', '<eos>', '<bos>', '<unk>', '<mask>', '\n', '\n\n'];
  for (let b = 0; b < 256; b++) pieces.push(`<0x${b.toString(16).toUpperCase().padStart(2, '0')}>`);
  pieces.push('▁t', 'he', '▁the', 'a', 'b', 'ab', '▁', 't', 'h', 'e', '▁▁');
  const vocab = Object.fromEntries(pieces.map((p, i) => [p, i]));
  return {
    json: {
      added_tokens: [0, 1, 2, 3, 4].map((id) => ({ id, content: pieces[id], special: true })),
      normalizer: { type: 'Replace', pattern: { String: ' ' }, content: '▁' },
      pre_tokenizer: { type: 'Split', pattern: { String: ' ' }, behavior: 'MergedWithPrevious', invert: false },
      model: {
        type: 'BPE',
        dropout: null,
        unk_token: '<unk>',
        byte_fallback: true,
        ignore_merges: false,
        vocab,
        merges: [
          ['\n', '\n'],
          ['▁', '▁'],
          ['▁', 't'],
          ['h', 'e'],
          ['▁t', 'he'],
          ['a', 'b'],
        ],
      },
    },
    config: { bos_token: '<bos>', eos_token: '<eos>', unk_token: '<unk>', pad_token: '<pad>' },
  };
}

/** Hand-built spm tables (for writer tests that need TYPS/scores/merges). */
export function spmTables(scores: number[] | null, withMerges: boolean): VocabTables {
  const strings = ['<unk>', '<s>', '</s>', '▁a', 'b', '▁ab', 'é'];
  const pieces = strings.map((s) => enc.encode(s));
  return {
    tokenizerId: 'xai-grok1',
    family: 'spm-bpe',
    pieces,
    types: Uint8Array.of(
      PieceType.Unk,
      PieceType.Control,
      PieceType.Control,
      PieceType.Normal,
      PieceType.Normal,
      PieceType.Normal,
      PieceType.UserDefined,
    ),
    scores: scores === null ? null : Float32Array.from(scores),
    merges: withMerges ? { resultId: Uint32Array.of(5, 3), splitUtf16: Uint8Array.of(2, 1) } : null,
    specials: [
      { id: 0, text: '<unk>' },
      { id: 1, text: '<s>' },
    ],
    config: { byteFirstId: 3, bosId: 1, eosId: 2, unkId: 0, priority: 'score', fallbackOrder: 'after-merge' },
    notes: [],
  };
}

export const UPSTREAM = {
  assetId: 'synthetic',
  file: 'vocab.txt',
  sha256: 'a'.repeat(64),
  url: 'https://example.invalid/vocab.txt',
  revision: 'r1',
  retrievedOn: '2026-10-25',
} as const;
