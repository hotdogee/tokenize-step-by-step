/**
 * Pure-JavaScript second opinions on ids (PA-9), built from the raw files already in `data/vocab/raw`:
 *
 * - `gpt-tokenizer@4.1.0` for o200k_base and cl100k_base, its `GptEncoding` fed the ranks parsed from the pinned
 *   `.tiktoken` files (not the package's bundled copy), `disallowedSpecial: new Set()` = tiktoken `encode_ordinary`;
 * - `@huggingface/tokenizers@0.2.0` on the Gemma 4 and Muse Glimmer `tokenizer.json`, `add_special_tokens: false`. The
 *   package always matches added tokens, so the special ones are removed from `added_tokens` (their vocabulary entries
 *   stay): the fixtures' `encode_special_tokens=True` (special strings are text).
 *
 * A disagreement with the Python oracle is an `oracle-divergence` (classified in `classify.ts`), never our failure.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { Tokenizer as HfTokenizer } from '@huggingface/tokenizers';
import { GptEncoding } from 'gpt-tokenizer/GptEncoding';
import type { TokenizerId } from '../../src/index.ts';

/** One second opinion: ids only. */
export interface SecondOpinion {
  readonly library: string;
  encode(text: string): readonly number[];
}

const strictUtf8 = new TextDecoder('utf-8', { fatal: true, ignoreBOM: true });

/**
 * A `.tiktoken` file (`<base64> <rank>` lines) as gpt-tokenizer's `RawBytePairRanks`: index = rank, value = the token
 * as a string when it is valid UTF-8 (BOM kept), else its bytes.
 */
export function tiktokenRanks(text: string): Array<string | number[]> {
  const ranks: Array<string | number[]> = [];
  for (const line of text.split('\n')) {
    if (line === '') continue;
    const [b64, rank] = line.split(' ');
    if (b64 === undefined || rank === undefined) throw new Error(`bad .tiktoken line: ${line}`);
    const bytes = new Uint8Array(Buffer.from(b64, 'base64'));
    let value: string | number[];
    try {
      value = strictUtf8.decode(bytes);
    } catch {
      value = Array.from(bytes);
    }
    ranks[Number(rank)] = value;
  }
  return ranks;
}

function gptTokenizer(raw: string, name: 'o200k_base' | 'cl100k_base', file: string): SecondOpinion {
  const ranks = tiktokenRanks(readFileSync(join(raw, `openai-${name}`, file), 'utf8'));
  const encoding = GptEncoding.getEncodingApi(name, () => ranks);
  const options = { disallowedSpecial: new Set<string>() };
  return { library: 'gpt-tokenizer 4.1.0', encode: (text) => encoding.encode(text, options) };
}

interface HfJson {
  added_tokens: Array<{ id: number; content: string; special?: boolean }>;
  [key: string]: unknown;
}

function huggingFace(raw: string, asset: string, label: string): SecondOpinion {
  const json = JSON.parse(readFileSync(join(raw, asset, 'tokenizer.json'), 'utf8')) as HfJson;
  const config = JSON.parse(readFileSync(join(raw, asset, 'tokenizer_config.json'), 'utf8')) as Record<string, unknown>;
  const asText: HfJson = { ...json, added_tokens: json.added_tokens.filter((t) => t.special !== true) };
  const tokenizer = new HfTokenizer(asText, { ...config, additional_special_tokens: [], extra_special_tokens: [] });
  return {
    library: `@huggingface/tokenizers 0.2.0 (${label})`,
    encode: (text) => tokenizer.encode(text, { add_special_tokens: false }).ids,
  };
}

/** Builders of the second opinions per tokenizer (tokenizers without one are absent). */
const BUILDERS: Partial<Record<TokenizerId, (raw: string) => SecondOpinion>> = {
  'openai-o200k_base': (raw) => gptTokenizer(raw, 'o200k_base', 'o200k_base.tiktoken'),
  'openai-cl100k_base': (raw) => gptTokenizer(raw, 'cl100k_base', 'cl100k_base.tiktoken'),
  'google-gemma4': (raw) => huggingFace(raw, 'google-gemma4', 'Gemma 4 tokenizer.json'),
  'meta-llama4-muse': (raw) => huggingFace(raw, 'meta-muse-glimmer', 'Muse Glimmer tokenizer.json'),
};

/** The pure-JS second opinion of `id` over the raw files in `raw` (`data/vocab/raw`), or null when there is none. */
export function secondOpinionFor(id: TokenizerId, raw: string): SecondOpinion | null {
  return BUILDERS[id]?.(raw) ?? null;
}
