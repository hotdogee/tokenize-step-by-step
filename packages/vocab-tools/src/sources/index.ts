/**
 * The nine shipped vocabulary sources (OD-4): which oracle-manifest asset feeds which `TokenizerId`, through which of
 * the six parsers (03 §C.5), from which raw files. Every listed file is SHA-256-verified against the manifest before
 * parsing; optional cross-check files are verified when present and ignored when absent.
 */
import type { Family, TokenizerId } from '@tsbs/core';
import type { VocabTables } from '../tables.ts';
import { parseClaudeJson } from './claude-json.ts';
import { parseGrok2Json } from './grok2-json.ts';
import { parseHfByteLevelJson } from './hf-bytelevel.ts';
import { parseHfSpmJson } from './hf-spm-json.ts';
import { loadSpecialsTable } from './specials.ts';
import { parseSpmModel } from './spm-proto.ts';
import { parseTiktokenRanks, parseTiktokenText } from './tiktoken-text.ts';

export type ParserName = 'tiktokenText' | 'claudeJson' | 'grok2Json' | 'hfByteLevel' | 'spmProto' | 'hfSpmJson';

/** Raw inputs of one parse: the asset's verified files, plus verified optional cross-check files when available. */
export interface SourceInputs {
  readonly files: ReadonlyMap<string, Uint8Array>;
  readonly crossCheck: ReadonlyMap<string, Uint8Array>;
}

/** A file of another (oracle-only) asset used only to cross-check this one. */
export interface CrossCheckFile {
  readonly assetId: string;
  readonly file: string;
}

export interface AssetSource {
  readonly assetId: string;
  readonly tokenizerId: TokenizerId;
  readonly family: Family;
  readonly parser: ParserName;
  /** The upstream vocabulary file (META `upstream.file`). */
  readonly vocabFile: string;
  /** Further files of the same asset the parser reads (configs). */
  readonly configFiles: readonly string[];
  readonly crossCheck: readonly CrossCheckFile[];
  parse(inputs: SourceInputs): Promise<VocabTables>;
}

const utf8 = new TextDecoder('utf-8', { fatal: true });

function file(inputs: SourceInputs, name: string): Uint8Array {
  const bytes = inputs.files.get(name);
  if (bytes === undefined) throw new Error(`raw file ${name} was not loaded`);
  return bytes;
}

function text(inputs: SourceInputs, name: string): string {
  return utf8.decode(file(inputs, name));
}

function json(inputs: SourceInputs, name: string): unknown {
  return JSON.parse(text(inputs, name));
}

/** The sources in `TokenizerId` declaration order (03 §B.1), which is also the manifest's key order. */
export const ASSET_SOURCES: readonly AssetSource[] = [
  {
    assetId: 'openai-o200k_base',
    tokenizerId: 'openai-o200k_base',
    family: 'bytelevel-bpe',
    parser: 'tiktokenText',
    vocabFile: 'o200k_base.tiktoken',
    configFiles: [],
    crossCheck: [],
    async parse(inputs) {
      const table = await loadSpecialsTable('openai-o200k_base');
      return parseTiktokenText(text(inputs, this.vocabFile), {
        tokenizerId: this.tokenizerId,
        specials: table.specials,
      });
    },
  },
  {
    assetId: 'openai-cl100k_base',
    tokenizerId: 'openai-cl100k_base',
    family: 'bytelevel-bpe',
    parser: 'tiktokenText',
    vocabFile: 'cl100k_base.tiktoken',
    configFiles: [],
    crossCheck: [],
    async parse(inputs) {
      const table = await loadSpecialsTable('openai-cl100k_base');
      return parseTiktokenText(text(inputs, this.vocabFile), {
        tokenizerId: this.tokenizerId,
        specials: table.specials,
      });
    },
  },
  {
    assetId: 'anthropic-claude-legacy',
    tokenizerId: 'anthropic-claude-legacy',
    family: 'bytelevel-bpe',
    parser: 'claudeJson',
    vocabFile: 'claude.json',
    configFiles: [],
    crossCheck: [],
    parse(inputs) {
      return Promise.resolve(parseClaudeJson(text(inputs, this.vocabFile)));
    },
  },
  {
    assetId: 'google-gemma4',
    tokenizerId: 'google-gemma4',
    family: 'spm-bpe',
    parser: 'hfSpmJson',
    vocabFile: 'tokenizer.json',
    configFiles: ['tokenizer_config.json'],
    crossCheck: [],
    parse(inputs) {
      return Promise.resolve(parseHfSpmJson(json(inputs, this.vocabFile), json(inputs, 'tokenizer_config.json')));
    },
  },
  {
    assetId: 'google-gemma2',
    tokenizerId: 'google-gemma2',
    family: 'spm-bpe',
    parser: 'spmProto',
    vocabFile: 'tokenizer.model',
    configFiles: [],
    crossCheck: [],
    parse(inputs) {
      return Promise.resolve(parseSpmModel(file(inputs, this.vocabFile), this.tokenizerId));
    },
  },
  {
    assetId: 'meta-muse-glimmer',
    tokenizerId: 'meta-llama4-muse',
    family: 'bytelevel-bpe',
    parser: 'hfByteLevel',
    vocabFile: 'tokenizer.json',
    configFiles: [],
    crossCheck: [{ assetId: 'meta-llama4-model', file: 'tokenizer.model' }],
    parse(inputs) {
      const llama4 = inputs.crossCheck.get('meta-llama4-model/tokenizer.model');
      const crossCheckRanks =
        llama4 === undefined ? null : parseTiktokenRanks(utf8.decode(llama4), 'meta-llama4-model');
      return Promise.resolve(parseHfByteLevelJson(json(inputs, this.vocabFile), { crossCheckRanks }));
    },
  },
  {
    assetId: 'meta-llama3-model',
    tokenizerId: 'meta-llama3',
    family: 'bytelevel-bpe',
    parser: 'tiktokenText',
    vocabFile: 'tokenizer.model',
    configFiles: [],
    crossCheck: [],
    async parse(inputs) {
      const table = await loadSpecialsTable('meta-llama3');
      const bos = table.specials.find((s) => s.text === '<|begin_of_text|>');
      return parseTiktokenText(text(inputs, this.vocabFile), {
        tokenizerId: this.tokenizerId,
        specials: table.specials,
        ...(bos === undefined ? {} : { bosId: bos.id }),
      });
    },
  },
  {
    assetId: 'xai-grok2',
    tokenizerId: 'xai-grok2',
    family: 'bytelevel-bpe',
    parser: 'grok2Json',
    vocabFile: 'tokenizer.tok.json',
    configFiles: [],
    crossCheck: [],
    parse(inputs) {
      return Promise.resolve(parseGrok2Json(text(inputs, this.vocabFile)));
    },
  },
  {
    assetId: 'xai-grok1',
    tokenizerId: 'xai-grok1',
    family: 'spm-bpe',
    parser: 'spmProto',
    vocabFile: 'tokenizer.model',
    configFiles: [],
    crossCheck: [],
    parse(inputs) {
      return Promise.resolve(parseSpmModel(file(inputs, this.vocabFile), this.tokenizerId));
    },
  },
];

/** The source for an asset id or a tokenizer id (`--only` accepts either). */
export function findSource(idOrTokenizer: string): AssetSource | undefined {
  return ASSET_SOURCES.find((s) => s.assetId === idOrTokenizer || s.tokenizerId === idOrTokenizer);
}
