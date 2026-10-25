import { Buffer } from 'node:buffer';
import { describe, expect, it } from 'vitest';
import { parseClaudeJson } from '../src/sources/claude-json.ts';
import { BYTE_TO_CODE_POINT, decodeByteLevelKey, encodeByteLevelKey } from '../src/sources/gpt2-bytes.ts';
import { parseGrok2Json } from '../src/sources/grok2-json.ts';
import { parseHfByteLevelJson } from '../src/sources/hf-bytelevel.ts';
import { mergesRegenerable, parseHfSpmJson } from '../src/sources/hf-spm-json.ts';
import { CLAUDE_LEGACY_PAT_STR, O200K_PAT_STR } from '../src/sources/patterns.ts';
import { loadSpecialsTable, parseSpecialsTable } from '../src/sources/specials.ts';
import { parseTiktokenRanks, parseTiktokenText } from '../src/sources/tiktoken-text.ts';
import { PieceType } from '../src/tables.ts';
import {
  byteLevelPieces,
  claudeJson,
  grok2Json,
  hfByteLevelJson,
  hfSpmJson,
  tiktokenText,
} from './support/synthetic.ts';

const SPECIALS = [{ id: 1000, text: '<|endoftext|>' }];

describe('tiktokenText', () => {
  it('parses rank lines into rank-ordered pieces and records maxPieceBytes facts', () => {
    const pieces = byteLevelPieces();
    const tables = parseTiktokenText(tiktokenText(pieces), { tokenizerId: 'openai-o200k_base', specials: SPECIALS });
    expect(tables.pieces).toEqual(pieces);
    expect(tables.specials).toEqual(SPECIALS);
    expect(tables.config).toEqual({ idOffset: 0 });
    expect(tables.family).toBe('bytelevel-bpe');
  });

  it('accepts out-of-order lines and CRLF, records the Llama BOS', () => {
    const pieces = byteLevelPieces();
    const lines = tiktokenText(pieces).trim().split('\n').reverse().join('\r\n');
    const tables = parseTiktokenText(lines, { tokenizerId: 'meta-llama3', specials: SPECIALS, bosId: 1000 });
    expect(tables.pieces).toEqual(pieces);
    expect(tables.config.bosId).toBe(1000);
  });

  it('asserts contiguous ranks, unique bytes, all 256 single bytes and specials outside the ranks', () => {
    const pieces = byteLevelPieces();
    const text = tiktokenText(pieces);
    expect(() => parseTiktokenRanks(text.replace(/ 3\n/, ' 999\n'), 'x')).toThrow(/contiguous/);
    expect(() =>
      parseTiktokenText(tiktokenText([...pieces, pieces[260] ?? Uint8Array.of()]), {
        tokenizerId: 'openai-o200k_base',
        specials: [],
      }),
    ).toThrow(/share the bytes/);
    expect(() =>
      parseTiktokenText(tiktokenText(pieces.slice(1)), { tokenizerId: 'openai-o200k_base', specials: [] }),
    ).toThrow(/single byte 0x00/);
    expect(() =>
      parseTiktokenText(text, { tokenizerId: 'openai-o200k_base', specials: [{ id: 5, text: '<x>' }] }),
    ).toThrow(/collides/);
    expect(() => parseTiktokenRanks('not base64! 0\n', 'x')).toThrow(/base64|expected/);
    expect(() => parseTiktokenRanks('QQ== 0\nQQ== 0\n', 'x')).toThrow(/twice/);
  });
});

describe('committed specials tables (AD-12)', () => {
  it('match the tiktoken 0.14.0 and llama-models sources', async () => {
    const o200k = await loadSpecialsTable('openai-o200k_base');
    expect(o200k.specials).toEqual([
      { id: 199999, text: '<|endoftext|>' },
      { id: 200018, text: '<|endofprompt|>' },
    ]);
    const cl100k = await loadSpecialsTable('openai-cl100k_base');
    expect(cl100k.specials.map((s) => s.id)).toEqual([100257, 100258, 100259, 100260, 100276]);
    const llama3 = await loadSpecialsTable('meta-llama3');
    expect(llama3.specials).toHaveLength(256);
    expect(llama3.specials.map((s) => s.id)).toEqual(Array.from({ length: 256 }, (_, i) => 128000 + i));
    const byId = new Map(llama3.specials.map((s) => [s.id, s.text]));
    expect(byId.get(128004)).toBe('<|finetune_right_pad_id|>');
    expect(byId.get(128008)).toBe('<|eom_id|>');
    expect(byId.get(128010)).toBe('<|python_tag|>');
    expect(byId.get(128255)).toBe('<|reserved_special_token_245|>');
    for (const table of [o200k, cl100k, llama3])
      expect(table.source.url).toMatch(/^https:\/\/raw\.githubusercontent\.com\//);
  });

  it('validates the table shape', () => {
    expect(() => parseSpecialsTable({ tokenizer: 'x', source: {}, specials: [] }, 't')).toThrow(/source\.url/);
    expect(() =>
      parseSpecialsTable(
        { tokenizer: 'x', source: { url: 'u', revision: 'r', tag: 't', symbol: 's' }, specials: [{ id: 'a' }] },
        't',
      ),
    ).toThrow(/specials\[0\]/);
  });
});

describe('claudeJson', () => {
  const pieces = byteLevelPieces();

  it('reads ! 5 <b64> … ranks with idOffset 5 and specials 0–4 in key order', () => {
    const tables = parseClaudeJson(claudeJson(pieces, CLAUDE_LEGACY_PAT_STR), { expectedRankCount: pieces.length });
    expect(tables.pieces).toEqual(pieces);
    expect(tables.config).toEqual({ idOffset: 5 });
    expect(tables.specials.map((s) => [s.id, s.text])).toEqual([
      [0, '<EOT>'],
      [1, '<META>'],
      [2, '<META_START>'],
      [3, '<META_END>'],
      [4, '<SOS>'],
    ]);
    expect(tables.notes.join(' ')).toMatch(/explicit_n_vocab 12345 ignored/);
  });

  it('rejects another pat_str, a wrong rank count and a bad line prefix', () => {
    expect(() => parseClaudeJson(claudeJson(pieces, '\\s+'), { expectedRankCount: pieces.length })).toThrow(/pat_str/);
    expect(() => parseClaudeJson(claudeJson(pieces, CLAUDE_LEGACY_PAT_STR))).toThrow(/64995/);
    const bad = JSON.parse(claudeJson(pieces, CLAUDE_LEGACY_PAT_STR)) as Record<string, string>;
    bad['bpe_ranks'] = `? 5 ${String(bad['bpe_ranks']).slice(4)}`;
    expect(() => parseClaudeJson(JSON.stringify(bad), { expectedRankCount: pieces.length })).toThrow(/prefix/);
  });
});

describe('grok2Json', () => {
  const pieces = byteLevelPieces();

  it('orders regular tokens by id with idOffset 128 and keeps the 128 specials in file order', () => {
    const doc = grok2Json(pieces);
    (doc['regular_tokens'] as unknown[]).reverse();
    const tables = parseGrok2Json(JSON.stringify(doc));
    expect(tables.pieces).toEqual(pieces);
    expect(tables.config).toEqual({ idOffset: 128 });
    expect(tables.specials).toHaveLength(128);
    expect(tables.specials[0]).toEqual({ id: 0, text: '<|special_0|>' });
  });

  it('asserts word_split V1, reserved_tokens 128, single bytes at 128 + byte and vocab_size', () => {
    const doc = (patch: Record<string, unknown>): string => JSON.stringify({ ...grok2Json(pieces), ...patch });
    expect(() => parseGrok2Json(doc({ word_split: 'V2' }))).toThrow(/V1/);
    expect(() => parseGrok2Json(doc({ reserved_tokens: 64 }))).toThrow(/reserved_tokens/);
    expect(() => parseGrok2Json(doc({ vocab_size: 1 }))).toThrow(/vocab_size/);
    const swapped = byteLevelPieces();
    [swapped[0], swapped[1]] = [swapped[1] ?? Uint8Array.of(), swapped[0] ?? Uint8Array.of()];
    expect(() => parseGrok2Json(JSON.stringify(grok2Json(swapped)))).toThrow(/single byte/);
  });
});

describe('GPT-2 byte map', () => {
  it('is a bijection between the 256 bytes and 256 code points', () => {
    expect(new Set(BYTE_TO_CODE_POINT).size).toBe(256);
    expect(BYTE_TO_CODE_POINT[0x20]).toBe(0x120); // Ġ
    expect(BYTE_TO_CODE_POINT[0x41]).toBe(0x41);
    const all = Uint8Array.from({ length: 256 }, (_, b) => b);
    expect(decodeByteLevelKey(encodeByteLevelKey(all))).toEqual(all);
    expect(decodeByteLevelKey('Ġworld')).toEqual(new TextEncoder().encode(' world'));
    expect(() => decodeByteLevelKey('台')).toThrow(/GPT-2 byte map/);
  });
});

describe('hfByteLevel', () => {
  const pieces = byteLevelPieces();

  it('decodes the vocab through the inverse map and takes added tokens as specials', () => {
    const tables = parseHfByteLevelJson(hfByteLevelJson(pieces, O200K_PAT_STR), { expectedSpecials: 3 });
    expect(tables.pieces).toEqual(pieces);
    expect(tables.specials.map((s) => s.id)).toEqual([pieces.length, pieces.length + 1, pieces.length + 2]);
    expect(tables.config).toEqual({ idOffset: 0, bosId: pieces.length });
    expect(tables.notes.join(' ')).toMatch(/cross-check skipped/);
  });

  it('cross-checks against the Llama 4 ranks when given', () => {
    const ok = parseHfByteLevelJson(hfByteLevelJson(pieces, O200K_PAT_STR), {
      expectedSpecials: 3,
      crossCheckRanks: pieces,
    });
    expect(ok.notes.join(' ')).toMatch(/byte-identical/);
    const other = byteLevelPieces(['he', 'll', 'hell', 'hello', ' wor', '台', 'X!']);
    expect(() =>
      parseHfByteLevelJson(hfByteLevelJson(pieces, O200K_PAT_STR), { expectedSpecials: 3, crossCheckRanks: other }),
    ).toThrow(/differs/);
  });

  it('asserts ignore_merges, the o200k Split regex and contiguous ids', () => {
    const json = hfByteLevelJson(pieces, O200K_PAT_STR);
    expect(() => parseHfByteLevelJson(hfByteLevelJson(pieces, '\\s+'), { expectedSpecials: 3 })).toThrow(/Split regex/);
    const model = json['model'] as Record<string, unknown>;
    expect(() =>
      parseHfByteLevelJson({ ...json, model: { ...model, ignore_merges: false } }, { expectedSpecials: 3 }),
    ).toThrow(/ignore_merges/);
    const vocab = { ...(model['vocab'] as Record<string, number>), extra: 10_000 };
    expect(() => parseHfByteLevelJson({ ...json, model: { ...model, vocab } }, { expectedSpecials: 3 })).toThrow(
      /vocab id/,
    );
  });
});

describe('hfSpmJson (Gemma 4 shape)', () => {
  it('derives TYPS (BYTE / CONTROL / UNK / NORMAL, never USER_DEFINED), MRGS and META facts', () => {
    const { json, config } = hfSpmJson();
    const tables = parseHfSpmJson(json, config);
    const types = tables.types ?? new Uint8Array();
    expect(types[0]).toBe(PieceType.Control);
    expect(types[3]).toBe(PieceType.Unk);
    expect(types[7]).toBe(PieceType.Byte);
    expect(types[262]).toBe(PieceType.Byte);
    expect(types[5]).toBe(PieceType.Normal);
    expect([...types].includes(PieceType.UserDefined)).toBe(false);
    expect(tables.config).toMatchObject({
      byteFirstId: 7,
      bosId: 2,
      eosId: 1,
      unkId: 3,
      padId: 0,
      addDummyPrefix: false,
      escapeWhitespace: true,
      priority: 'merge-rank',
      fallbackOrder: 'before-merge',
    });
    expect(tables.specials.map((s) => s.text)).toEqual(['<pad>', '<eos>', '<bos>', '<unk>', '<mask>']);
    const piece = (id: number): string => Buffer.from(tables.pieces[id] ?? []).toString('utf8');
    const merges = tables.merges;
    expect(merges === null ? [] : [...merges.resultId].map(piece)).toEqual(['\n\n', '▁▁', '▁t', 'he', '▁the', 'ab']);
    expect([...(merges?.splitUtf16 ?? [])]).toEqual([1, 1, 1, 1, 2, 1]);
    expect(typeof tables.config.hfMergesRegenerable).toBe('boolean');
  });

  it('rejects other normalizers, ignore_merges, open merges and non-special added tokens', () => {
    const fresh = (): { json: Record<string, unknown>; config: Record<string, unknown> } => hfSpmJson();
    const a = fresh();
    a.json['normalizer'] = { type: 'NFKC' };
    expect(() => parseHfSpmJson(a.json, a.config)).toThrow(/normalizer/);
    const b = fresh();
    (b.json['model'] as Record<string, unknown>)['ignore_merges'] = true;
    expect(() => parseHfSpmJson(b.json, b.config)).toThrow(/ignore_merges/);
    const c = fresh();
    ((c.json['model'] as Record<string, unknown>)['merges'] as unknown[]).push(['x', 'y']);
    expect(() => parseHfSpmJson(c.json, c.config)).toThrow(/not closed/);
    const d = fresh();
    (d.json['added_tokens'] as Array<Record<string, unknown>>).push({ id: 5, content: '\n', special: false });
    expect(() => parseHfSpmJson(d.json, d.config)).toThrow(/special=false/);
  });

  it('A2: regenerates a merge list from the HF generate_merges key', () => {
    const bytes = Array.from({ length: 256 }, (_, b) => `<0x${b.toString(16).toUpperCase().padStart(2, '0')}>`);
    const pieces = ['\n', '\n\n', ...bytes, 'a', 'b', 'ab', 'aab'];
    const vocab = new Map(pieces.map((p, id) => [p, id]));
    // Whitespace runs score 0 and sort first; every other piece scores (byteFirstId + 256) − id.
    expect(
      mergesRegenerable(
        vocab,
        pieces,
        [
          ['\n', '\n'],
          ['a', 'b'],
          ['a', 'ab'],
        ],
        2,
      ),
    ).toBe(true);
    expect(
      mergesRegenerable(
        vocab,
        pieces,
        [
          ['a', 'b'],
          ['\n', '\n'],
          ['a', 'ab'],
        ],
        2,
      ),
    ).toBe(false);
    expect(
      mergesRegenerable(
        vocab,
        pieces,
        [
          ['\n', '\n'],
          ['a', 'b'],
        ],
        2,
      ),
    ).toBe(false);
  });
});
