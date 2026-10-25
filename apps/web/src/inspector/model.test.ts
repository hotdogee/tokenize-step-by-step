/**
 * The inspector sentence builder (05 §5, §4.1): Token / Character / Byte / Step / Chunk sections and the partial,
 * zero-width, fused-dummy, byte-fallback and direct-hit sentences, in all three locales.
 */
import { describe, expect, it } from 'vitest';
import { boardContext, caseResult, translator } from '../board/fixture-results.test-helper.ts';
import type { CellRef } from '../board/units.ts';
import { LOCALES, type Locale } from '../i18n/types.ts';
import { translateInspector } from './i18n/catalogs.ts';
import { copyValueOf, inspectorModel, type InspectorModel } from './model.ts';
import type { TokenizationResult } from '@tsbs/core';

function modelOf(
  result: TokenizationResult,
  ref: CellRef,
  options: { stage?: 4 | 5 | 6; step?: number; fusedDummy?: boolean; locale?: Locale } = {},
): InspectorModel {
  const ctx = boardContext(result, {
    K: 34,
    stage: options.stage ?? 6,
    ...(options.step === undefined ? {} : { step: options.step }),
  });
  return inspectorModel({
    result,
    units: ctx.units,
    ref,
    t: translator(options.locale),
    ti: (key, params) => translateInspector(options.locale ?? 'en', key, params),
    fusedDummy: options.fusedDummy ?? false,
    lang: 'und',
    step: options.step ?? result.timeline?.stepCount ?? 0,
  });
}

const notes = (model: InspectorModel): string[] => model.sections.flatMap((section) => section.notes);
const value = (model: InspectorModel, kind: string, key: string): string | undefined =>
  model.sections.find((section) => section.kind === kind)?.fields.find((field) => field.key === key)?.value;

describe('partial characters (cl100k 灣)', () => {
  const result = caseResult('openai-cl100k_base', 'zh-tw-tainan');

  it('says what 66285 covers and what it needs', () => {
    const model = modelOf(result, { tier: 'token', index: 1 });
    expect(model.heading).toBe('Inspector — token 2 of 5');
    expect(notes(model)).toContain('covers first 2 of 3 bytes of 灣');
    expect(notes(model)).toContain('needs 1 more (A3) to complete 灣');
    expect(value(model, 'token', 'hex')).toBe('E7 81');
    expect(value(model, 'token', 'text')).toBe('⟨E7 81⟩');
    expect(value(model, 'token', 'flags')).toBe('partial, ends mid-character');
    expect(model.copyValue).toBe('66285');
    expect(model.actions).toEqual({ showStep: 'Show this step', selectInText: 'Select in text' });
    expect(model.sections[0]?.fields.find((field) => field.key === 'id')?.copyLabel).toBe('Copy id');
    expect(model.select).toEqual([1, 2]);
    expect(model.summary).toBe('66285, E7 81, [3, 5), first 2 of 3 bytes of 灣');
  });

  it('says which token 96 completes 灣 with', () => {
    const model = modelOf(result, { tier: 'token', index: 2 });
    expect(notes(model)).toEqual(
      expect.arrayContaining(['covers last 1 of 3 bytes of 灣', 'completes 灣 together with 66285']),
    );
  });

  it('describes a byte (hex, dec, binary, role, owners)', () => {
    const model = modelOf(result, { tier: 'hex', index: 5 });
    expect(model.heading).toBe('Inspector — byte 6 of 12');
    expect(model.sections.map((section) => section.kind)).toEqual(['byte', 'char', 'token']);
    expect(value(model, 'byte', 'binary')).toBe('10100011');
    expect(value(model, 'byte', 'role')).toBe('continuation byte');
    expect(value(model, 'byte', 'token')).toBe('96');
    expect(model.copyValue).toBe('A3');
  });

  it('describes a character (code point, UTF-8, UTF-16, owners)', () => {
    const model = modelOf(result, { tier: 'char', index: 1 });
    expect(value(model, 'char', 'codePoint')).toBe('U+7063');
    expect(value(model, 'char', 'utf8')).toBe('E7 81 A3');
    expect(value(model, 'char', 'utf16')).toBe('7063');
    expect(value(model, 'char', 'tokens')).toBe('66285, 96');
    expect(model.copyValue).toBe('灣');
  });
});

describe('crossing, zero-width, fused dummy, byte fallback, direct hit', () => {
  it('Grok-2 4242 covers ー and 2 of 3 bytes of メ', () => {
    const model = modelOf(caseResult('xai-grok2', 'ja-shibuya-ramen'), { tier: 'token', index: 7 });
    expect(notes(model)).toContain('covers ー, first 2 of 3 bytes of メ');
    expect(notes(model)).toContain('needs 1 more (A1) to complete メ');
  });

  it('a bare dummy prefix covers 0 bytes', () => {
    const model = modelOf(caseResult('xai-grok1', 'zh-tw-tainan'), { tier: 'token', index: 0 });
    expect(notes(model)).toContain('covers 0 bytes (dummy prefix added by the tokenizer)');
    expect(value(model, 'token', 'kind')).toBe('dummy prefix');
  });

  it('a fused dummy prefix is included (0 bytes) and the piece shows ▁', () => {
    const model = modelOf(caseResult('xai-grok1', 'en-hello-world'), { tier: 'token', index: 0 }, { fusedDummy: true });
    expect(notes(model)).toContain('includes the dummy prefix (0 bytes)');
    const piece = model.sections[0]?.fields.find((field) => field.key === 'piece');
    expect(piece?.value).toBe('▁Hello');
    expect(piece?.note).toBe('▁ = escaped space');
  });

  it('a byte-fallback piece names itself', () => {
    const model = modelOf(caseResult('google-gemma4', 'cjk-ext-g-biang'), { tier: 'token', index: 0 });
    expect(notes(model)).toContain('byte-fallback piece <0xF0>');
    expect(value(model, 'token', 'piece')).toBe('<0xF0>');
  });

  it('a direct hit says no merges were needed; a merged token names its step and offers "show this step"', () => {
    const hello = modelOf(caseResult('openai-o200k_base', 'en-hello-world'), { tier: 'token', index: 0 });
    expect(notes(hello)).toContain('whole chunk is a vocabulary entry — no merges');
    const merged = modelOf(caseResult('openai-cl100k_base', 'zh-tw-tainan'), { tier: 'token', index: 1 });
    const step = merged.sections.find((section) => section.kind === 'step');
    expect(step?.step).toBeGreaterThan(0);
    expect(step?.fields.find((field) => field.key === 'pair')?.value).toBe('E7 + 81');
    expect(notes(merged)).toContain(`formed at step ${String(step?.step)}: E7 + 81`);
  });

  it('a live part without an id says so (stop 5)', () => {
    const result = caseResult('openai-o200k_base', 'ja-text');
    const model = modelOf(result, { tier: 'token', index: 0 }, { stage: 5, step: 0 });
    expect(model.heading).toMatch(/^Inspector — part 1 of \d+$/);
    expect(notes(model)).toContain('not a vocabulary entry yet');
  });

  it('a chunk lists its text, range and tokens', () => {
    const model = modelOf(caseResult('openai-o200k_base', 'en-hello-world'), { tier: 'chunk', index: 2 }, { stage: 5 });
    expect(model.heading).toBe('Inspector — chunk 3 of 4');
    expect(value(model, 'chunk', 'text')).toBe('␠world');
    expect(value(model, 'chunk', 'tokens')).toBe('1 token');
  });
});

describe('every inspector string renders in all three locales', () => {
  for (const locale of LOCALES) {
    it(`renders headings, fields and notes in ${locale}`, () => {
      const result = caseResult('openai-cl100k_base', 'zh-tw-tainan');
      const refs: CellRef[] = [
        { tier: 'char', index: 1 },
        { tier: 'hex', index: 4 },
        { tier: 'token', index: 1 },
        { tier: 'token', index: 2 },
      ];
      for (const ref of refs) {
        const model = modelOf(result, ref, { locale });
        const strings = [
          model.heading,
          model.summary,
          ...model.sections.flatMap((section) => [
            section.title,
            ...section.notes,
            ...section.fields.flatMap((field) => [field.label, field.value]),
          ]),
        ];
        for (const text of strings) expect(text, `${locale} ${ref.tier}`).not.toMatch(/[{}]/);
      }
    });
  }
});

describe('copyValueOf (the c key, no catalog needed)', () => {
  it('copies ids, hex and text per tier', () => {
    const result = caseResult('openai-cl100k_base', 'zh-tw-tainan');
    const ctx = boardContext(result, { K: 34 });
    expect(copyValueOf(result, ctx.units, { tier: 'token', index: 1 })).toBe('66285');
    expect(copyValueOf(result, ctx.units, { tier: 'dec', index: 3 })).toBe('E7');
    expect(copyValueOf(result, ctx.units, { tier: 'char', index: 3 })).toBe('南');
  });
});
