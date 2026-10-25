import { describe, expect, it } from 'vitest';
import * as core from '@tsbs/core';
import {
  CONFORMANCE_MODES,
  ENGINE_FACTORIES,
  familiesMissingEngine,
  familiesWithEngine,
  isConformanceMode,
} from '../src/index.ts';

describe('conformance modes', () => {
  it('lists exactly the three modes of 03 §C.5', () => {
    expect(CONFORMANCE_MODES).toEqual(['strict', 'skip-missing-engine', 'off']);
  });

  it('recognises modes and rejects anything else', () => {
    expect(isConformanceMode('skip-missing-engine')).toBe(true);
    expect(isConformanceMode('STRICT')).toBe(false);
    expect(isConformanceMode('')).toBe(false);
  });
});

describe('engine probe (AD-32)', () => {
  it('finds a family only when its factory export is a function', () => {
    const fake = { [ENGINE_FACTORIES['spm-bpe']]: () => null, createByteLevelTokenizer: 'not a function' };
    expect(familiesWithEngine(fake)).toEqual(['spm-bpe']);
    expect(familiesMissingEngine(fake)).toEqual(['bytelevel-bpe']);
  });

  it('agrees with what @tsbs/core exports today', () => {
    const available = familiesWithEngine(core);
    const missing = familiesMissingEngine(core);
    expect([...available, ...missing].sort()).toEqual(['bytelevel-bpe', 'spm-bpe']);
  });
});
