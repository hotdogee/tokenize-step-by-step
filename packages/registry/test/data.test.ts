/**
 * The committed registry data against the design's concrete values (05 §6 chips, AD-24 BYOK facts, 04 §2.1 / §3.1
 * engine facts, owner answers in 00 §D), and the browser entry's zod-free import graph (AD-28).
 */
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import {
  byok,
  defaultTokenizerId,
  examples,
  licences,
  models,
  strings,
  tokenizerById,
  tokenizers,
} from '../src/index.ts';
import type { TextLangChoice } from '../src/index.ts';

const SRC = join(dirname(fileURLToPath(import.meta.url)), '..', 'src');

/** The 19 chips of 05 §6 in order, with the text-language each sets. */
const CHIPS: ReadonlyArray<readonly [string, TextLangChoice]> = [
  ['zh-tw-tainan', 'zh-Hant'],
  ['zh-tw-taiwan-formal', 'zh-Hant'],
  ['zh-tw-renao', 'zh-Hant'],
  ['cjk-saba', 'ja'],
  ['cjk-turtle', 'zh-Hant'],
  ['cjk-ext-g-biang', 'zh-Hant'],
  ['emoji-family-zwj', 'auto'],
  ['emoji-flag-tw', 'auto'],
  ['emoji-heart-vs16', 'auto'],
  ['ja-text', 'ja'],
  ['ja-shibuya-ramen', 'ja'],
  ['mixed-hello-taiwan-tokyo', 'auto'],
  ['zh-date', 'zh-Hant'],
  ['en-contraction-code', 'en'],
  ['bopomofo', 'zh-Hant'],
  ['fullwidth-latin', 'en'],
  ['zh-tw-paragraph', 'zh-Hant'],
  ['ja-paragraph', 'ja'],
  ['en-paragraph', 'en'],
];

describe('tokenizers', () => {
  it('lists the nine tokenizers in the brief lab order with o200k as the default', () => {
    expect(tokenizers.map((t) => t.id)).toEqual([
      'openai-o200k_base',
      'openai-cl100k_base',
      'anthropic-claude-legacy',
      'google-gemma4',
      'google-gemma2',
      'meta-llama4-muse',
      'meta-llama3',
      'xai-grok2',
      'xai-grok1',
    ]);
    expect(defaultTokenizerId).toBe('openai-o200k_base');
    expect(tokenizers.filter((t) => t.tier === 'primary').map((t) => t.lab)).toEqual([
      'openai',
      'anthropic',
      'google',
      'meta',
      'xai',
    ]);
  });

  it('carries the measured byte-level facts (04 §2.1; Llama 3, cl100k and Claude measured on the raw files)', () => {
    const facts = Object.fromEntries(
      tokenizers.flatMap((t) =>
        t.engine.kind === 'bytelevel-bpe' ? [[t.id, [t.engine.idOffset, t.engine.maxTokenBytes, t.engine.bosId]]] : [],
      ),
    );
    expect(facts).toEqual({
      'openai-o200k_base': [0, 128, null],
      'openai-cl100k_base': [0, 128, null],
      'anthropic-claude-legacy': [5, 1024, null],
      'meta-llama4-muse': [0, 113, 200000],
      'meta-llama3': [0, 128, 128000],
      'xai-grok2': [128, 256, null],
    });
  });

  it('carries the SentencePiece facts of 04 §3.1', () => {
    expect(tokenizerById('google-gemma4')?.engine).toMatchObject({
      priority: 'merge-rank',
      fallbackOrder: 'before-merge',
      addDummyPrefix: false,
      byteFirstId: 238,
    });
    expect(tokenizerById('google-gemma2')?.engine).toMatchObject({
      priority: 'score',
      fallbackOrder: 'after-merge',
      addDummyPrefix: false,
      byteFirstId: 217,
    });
    expect(tokenizerById('xai-grok1')?.engine).toMatchObject({
      priority: 'score',
      fallbackOrder: 'after-merge',
      addDummyPrefix: true,
      byteFirstId: 69,
    });
    expect(tokenizerById('nope')).toBeUndefined();
  });

  it('labels the legacy Claude vocabulary as not the Claude 3+ tokenizer and links it to the live check', () => {
    const claude = tokenizerById('anthropic-claude-legacy');
    expect(claude?.fidelity).toBe('legacy');
    expect(claude?.fidelityNote.en).toContain('not the Claude 3+ tokenizer');
    expect(claude?.byok).toBe('anthropic-count');
    expect(tokenizerById('xai-grok2')?.byok).toBe('xai-tokenize');
  });
});

describe('models', () => {
  it('routes every Claude 3+ row to the live check with no tokenizer', () => {
    const claude3plus = models.filter((m) => m.lab === 'anthropic' && m.tokenizer === null);
    expect(claude3plus.length).toBeGreaterThanOrEqual(6);
    for (const m of claude3plus) expect([m.byok, m.fidelity]).toEqual(['anthropic-count', 'unavailable']);
  });

  it('dates every row on the research date and marks the inferred mappings of research §9', () => {
    expect(new Set(models.map((m) => m.checkedOn))).toEqual(new Set(['2026-10-25']));
    const inferred = models.filter((m) => m.fidelity === 'inferred').map((m) => m.model);
    expect(inferred).toEqual(expect.arrayContaining(['GPT-6 Astra', 'Gemini 4 Argon', 'Muse Wonder', 'Grok 4.7']));
  });
});

describe('examples', () => {
  it('lists the 19 chips of 05 §6 in order with their text language', () => {
    expect(examples.map((c) => [c.fixtureCase, c.lang])).toEqual(CHIPS);
    expect(examples.every((c) => c.key === c.fixtureCase)).toBe(true);
    expect(examples.filter((c) => c.label !== undefined).map((c) => c.key)).toEqual([
      'zh-tw-paragraph',
      'ja-paragraph',
      'en-paragraph',
    ]);
  });
});

describe('licences and notices', () => {
  it('carries the owner-confirmed xAI notice year and the exact attribution strings', () => {
    const n = licences.notices;
    expect(n['xai-materials-notice']?.verbatim).toBe(
      'This product includes materials licensed under the xAI Community License. All rights reserved. Copyright © xAI 2026.',
    );
    expect(n['powered-by-xai']).toMatchObject({ verbatim: 'Powered by xAI', prominent: true });
    expect(n['built-with-meta-llama-3']).toMatchObject({ verbatim: 'Built with Meta Llama 3', prominent: true });
    expect(n['gemma-notice']?.links?.map((l) => l.href)).toContain('https://ai.google.dev/gemma/prohibited_use_policy');
  });

  it('shows Powered by xAI while Grok-2 is selected and not while o200k is (05 §15)', () => {
    expect(tokenizerById('xai-grok2')?.requiredNotices).toContain('powered-by-xai');
    expect(tokenizerById('openai-o200k_base')?.requiredNotices).not.toContain('powered-by-xai');
  });
});

describe('byok', () => {
  it('holds the AD-24 values', () => {
    expect(byok.checkedOn).toBe('2026-10-25');
    expect(byok.anthropic.version).toBe('2026-10-21');
    expect(byok.anthropic.defaultAuth).toBe('bearer');
    expect(byok.anthropic.authSchemes).toEqual(['bearer', 'x-api-key']);
    expect(byok.anthropic.models.map((m) => m.label)).toEqual([
      'Claude Opus 5.5',
      'Claude Sonnet 5.5',
      'Claude Haiku 5.5',
      'Claude Opus 4.6',
      'Claude Sonnet 4.6',
    ]);
    expect(byok.xai.defaultModel).toBe('grok-4.7');
    expect(byok.xai.models.map((m) => m.id)).toEqual(['grok-4.7', 'grok-4.6', 'grok-4.5', 'grok-4.3']);
  });

  it('ships the BYOK messages and marker SR text in three locales', () => {
    expect(Object.keys(strings.marker)).toHaveLength(11);
    expect(strings.byok.zdrCors.en).toContain('Zero-data-retention');
  });
});

describe('browser entry', () => {
  /** Relative modules reachable from `file` through value (non-type) imports and re-exports. */
  function valueImports(file: string, seen = new Set<string>()): Set<string> {
    if (seen.has(file)) return seen;
    seen.add(file);
    const source = readFileSync(join(SRC, file), 'utf8');
    for (const m of source.matchAll(/^(?:import|export)\s+(?!type\b)[^;]*?from\s+'([^']+)'/gm)) {
      const spec = m[1] ?? '';
      if (spec.startsWith('./')) valueImports(spec.slice(2), seen);
      else seen.add(spec);
    }
    return seen;
  }

  it('never imports zod or the schemas at runtime (AD-28)', () => {
    const graph = [...valueImports('index.ts')];
    expect(graph).toEqual(
      expect.arrayContaining([
        'index.ts',
        'data.ts',
        'data/tokenizers.ts',
        'data/models.ts',
        '../../data/tokenizers.json',
      ]),
    );
    expect(graph.filter((m) => m === 'zod' || m.includes('schema') || m.includes('check'))).toEqual([]);
  });
});
