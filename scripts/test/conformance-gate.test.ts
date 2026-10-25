import type { Family } from '@tsbs/core';
import { describe, expect, it } from 'vitest';
import { evaluateGate } from '../lib/conformance-gate.ts';

const ALL: readonly Family[] = ['bytelevel-bpe', 'spm-bpe'];

describe('conformance gate (AD-32)', () => {
  it('allows skip-missing-engine while an engine is missing', () => {
    expect(evaluateGate('skip-missing-engine', [], ALL, true)).toMatchObject({ ok: true, mode: 'skip-missing-engine' });
    expect(evaluateGate('skip-missing-engine', ['bytelevel-bpe'], ALL, true).ok).toBe(true);
  });

  it('requires strict once both engine factories exist', () => {
    const verdict = evaluateGate('skip-missing-engine', ALL, ALL, true);
    expect(verdict.ok).toBe(false);
    expect(verdict.messages[0]).toMatch(/must be "strict", not "skip-missing-engine"/);
    expect(evaluateGate('strict', ALL, ALL, true).ok).toBe(true);
    expect(evaluateGate('off', ALL, ALL, false).ok).toBe(false);
  });

  it('treats an unset or empty variable as strict', () => {
    expect(evaluateGate(undefined, ALL, ALL, true)).toMatchObject({ ok: true, mode: 'strict' });
    expect(evaluateGate('', [], ALL, true)).toMatchObject({ ok: true, mode: 'strict' });
  });

  it('never allows off in CI and rejects unknown modes', () => {
    expect(evaluateGate('off', [], ALL, true).ok).toBe(false);
    expect(evaluateGate('off', [], ALL, false).ok).toBe(true);
    expect(evaluateGate('lenient', [], ALL, false)).toMatchObject({ ok: false, mode: null });
  });
});
