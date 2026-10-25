import { describe, expect, it } from 'vitest';
import {
  ALIVE,
  ChunkKind,
  DEFAULT_OPTIONS,
  NEVER,
  NO_MERGE,
  StepKind,
  TokenFlag,
  TokenKind,
  type TokenizerId,
} from '../src/index.ts';

describe('FROZEN v1 constants (03 §B.1–B.2, 04 §1.1)', () => {
  it('uses the timeline sentinels of the design', () => {
    expect(NEVER).toBe(0x7fffffff);
    expect(ALIVE).toBe(-1);
    expect(NO_MERGE).toBe(Number.POSITIVE_INFINITY);
  });

  it('defaults to plain-text specials, no BOS, no normalization, full trace', () => {
    expect(DEFAULT_OPTIONS).toEqual({ specialTokens: 'as-text', addBos: false, normalize: 'none', trace: true });
  });

  it('defines TokenFlag as eight distinct bits of a Uint8', () => {
    const bits = Object.values(TokenFlag);
    expect(bits).toHaveLength(8);
    expect(bits.reduce((acc, bit) => acc | bit, 0)).toBe(0xff);
    for (const bit of bits) expect(Math.log2(bit) % 1).toBe(0);
  });

  it('numbers kinds densely from 0', () => {
    for (const kinds of [TokenKind, ChunkKind, StepKind]) {
      expect(Object.values(kinds)).toEqual([...Object.values(kinds).keys()]);
    }
  });

  it('names the nine shipping tokenizers', () => {
    const ids = [
      'openai-o200k_base',
      'openai-cl100k_base',
      'anthropic-claude-legacy',
      'google-gemma4',
      'google-gemma2',
      'meta-llama4-muse',
      'meta-llama3',
      'xai-grok2',
      'xai-grok1',
    ] as const satisfies readonly TokenizerId[];
    expect(new Set(ids).size).toBe(9);
  });
});
