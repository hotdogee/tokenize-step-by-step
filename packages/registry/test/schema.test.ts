import { describe, expect, it } from 'vitest';
import type { z } from 'zod';
import type { ByokConfig, ExampleChip, ModelRow, TokenizerEntry } from '../src/index.ts';
import { ModelRowSchema, TokenizerEntrySchema } from '../src/schema.ts';
import type { ByokConfigSchema, ExampleChipSchema, TokenizerIdSchema } from '../src/schema.ts';
import type { TokenizerId } from '@tsbs/core';

/** True iff A and B are mutually assignable (readonly-ness aside, which TypeScript ignores for properties). */
type Same<A, B> = [A] extends [B] ? ([B] extends [A] ? true : false) : false;

// `satisfies z.ZodType<T>` in schema.ts proves "schema output ⊆ T"; these prove "T ⊆ schema output" (no field forgotten).
const typesMatch: [
  Same<z.output<typeof TokenizerIdSchema>, TokenizerId>,
  Same<z.output<typeof TokenizerEntrySchema>, TokenizerEntry>,
  Same<z.output<typeof ModelRowSchema>, ModelRow>,
  Same<z.output<typeof ExampleChipSchema>, ExampleChip>,
  Same<z.output<typeof ByokConfigSchema>, ByokConfig>,
] = [true, true, true, true, true];

const l10n = { en: 'o200k_base', 'zh-TW': 'o200k_base', ja: 'o200k_base' };

const o200k: TokenizerEntry = {
  id: 'openai-o200k_base',
  lab: 'openai',
  family: 'bytelevel-bpe',
  tier: 'primary',
  default: true,
  displayName: l10n,
  vocabSize: 200019,
  rankCount: 199998,
  asset: {
    manifestId: 'openai-o200k_base',
    sourceFile: 'o200k_base.tiktoken',
    sourceSha256: '446a9538cb6c348e3516120d7c08b09f57c36495e2acfffe59a5bf8b0cfb1a2d',
  },
  engine: { kind: 'bytelevel-bpe', pattern: 'o200k', idOffset: 0, maxTokenBytes: 128, bosId: null },
  defaults: { specialTokens: 'as-text' },
  toggles: ['specialTokens'],
  fidelity: 'confirmed',
  fidelityNote: l10n,
  licence: 'openai-o200k_base',
  requiredNotices: ['tiktoken-rank-file-basis'],
  fixture: 'fixtures/openai-o200k_base.json',
};

const claude3: ModelRow = {
  model: 'Claude Opus 5.5',
  lab: 'anthropic',
  tokenizer: null,
  byok: 'anthropic-count',
  fidelity: 'unavailable',
  status: 'current',
  evidenceUrl: 'https://docs.anthropic.com/',
  checkedOn: '2026-10-25',
  note: l10n,
};

describe('registry schemas (FROZEN types, 03 §B.7)', () => {
  it('keep schema outputs and frozen types identical', () => {
    expect(typesMatch).toEqual([true, true, true, true, true]);
  });

  it('accept a well-formed tokenizer entry', () => {
    expect(TokenizerEntrySchema.parse(o200k)).toEqual(o200k);
  });

  it('reject unknown keys and explicit undefined for optional keys', () => {
    expect(TokenizerEntrySchema.safeParse({ ...o200k, extra: 1 }).success).toBe(false);
    expect(TokenizerEntrySchema.safeParse({ ...o200k, byok: undefined }).success).toBe(false);
  });

  it('enforce the null-tokenizer row rule', () => {
    expect(ModelRowSchema.safeParse(claude3).success).toBe(true);
    const { byok: _byok, ...withoutByok } = claude3;
    expect(ModelRowSchema.safeParse(withoutByok).success).toBe(false);
    expect(ModelRowSchema.safeParse({ ...claude3, fidelity: 'inferred' }).success).toBe(false);
  });
});
