import { describe, expect, it } from 'vitest';
import * as core from '@tsbs/core';
import {
  checkConformance,
  reportPassed,
  type ConformanceDeps,
  type ConformanceTarget,
} from '../src/conformance-gate.ts';

const target: ConformanceTarget = {
  tokenizerId: 'openai-o200k_base',
  family: 'bytelevel-bpe',
  container: Uint8Array.of(1, 2, 3),
  fixturePath: 'fixtures/openai-o200k_base.json',
};

function deps(over: Partial<ConformanceDeps> = {}): ConformanceDeps {
  return {
    core: {},
    conformance: {},
    registryEntry: () => Promise.resolve({ id: 'openai-o200k_base' }),
    readFixture: () => Promise.resolve({ tokenizer: 'openai-o200k_base' }),
    ...over,
  };
}

describe('checkConformance (AD-13, AD-32)', () => {
  it('skips with a per-asset WARNING under skip-missing-engine when the factory is missing', async () => {
    const outcome = await checkConformance('skip-missing-engine', target, deps());
    expect(outcome.kind).toBe('skipped');
    expect(outcome.message).toMatch(
      /^CONFORMANCE SKIPPED for openai-o200k_base \(bytelevel-bpe\): @tsbs\/core does not export createByteLevelTokenizer/,
    );
  });

  it('refuses under strict when the factory is missing', async () => {
    expect((await checkConformance('strict', target, deps())).kind).toBe('failed');
  });

  it('skips everything under off', async () => {
    const outcome = await checkConformance('off', target, deps({ core: { createByteLevelTokenizer: () => ({}) } }));
    expect(outcome.kind).toBe('skipped');
  });

  it('runs readTsbv1 → factory → runFixture when the engine exists, in every mode but off', async () => {
    const calls: string[] = [];
    let disposed = false;
    const d = deps({
      core: {
        readTsbv1: (buf: ArrayBuffer) => {
          calls.push(`read ${String(buf.byteLength)}`);
          return { tables: true };
        },
        createByteLevelTokenizer: (tsbv: unknown, entry: unknown) => {
          calls.push(`factory ${JSON.stringify(tsbv)} ${JSON.stringify(entry)}`);
          return {
            dispose: () => {
              disposed = true;
            },
          };
        },
      },
      conformance: {
        runFixture: (fixture: unknown) => {
          calls.push(`run ${JSON.stringify(fixture)}`);
          return { failures: [] };
        },
      },
    });
    for (const mode of ['strict', 'skip-missing-engine'] as const)
      expect((await checkConformance(mode, target, d)).kind).toBe('passed');
    expect(calls.slice(0, 3)).toEqual([
      'read 3',
      'factory {"tables":true} {"id":"openai-o200k_base"}',
      'run {"tokenizer":"openai-o200k_base"}',
    ]);
    expect(disposed).toBe(true);
  });

  it('fails on a failing report, a throw, a missing reader/runner or a missing registry entry', async () => {
    const engine = { createByteLevelTokenizer: () => ({}), readTsbv1: () => ({}) };
    const failing = deps({ core: engine, conformance: { runFixture: () => ({ failures: [{ case: 'x' }] }) } });
    expect((await checkConformance('strict', target, failing)).kind).toBe('failed');
    const throwing = deps({
      core: engine,
      conformance: {
        runFixture: () => {
          throw new Error('boom');
        },
      },
    });
    expect((await checkConformance('strict', target, throwing)).message).toMatch(/boom/);
    expect(
      (await checkConformance('skip-missing-engine', target, deps({ core: { createByteLevelTokenizer: () => ({}) } })))
        .kind,
    ).toBe('failed');
    const noEntry = deps({
      core: engine,
      conformance: { runFixture: () => ({ ok: true }) },
      registryEntry: () => Promise.resolve(null),
    });
    expect((await checkConformance('strict', target, noEntry)).message).toMatch(/registry/);
  });

  it('agrees with what @tsbs/core exports today', async () => {
    const outcome = await checkConformance('skip-missing-engine', target, deps({ core }));
    expect(['skipped', 'failed', 'passed']).toContain(outcome.kind);
  });
});

describe('reportPassed', () => {
  it('accepts ok, failures[] and failed shapes and fails anything else', () => {
    expect(reportPassed({ ok: true }).passed).toBe(true);
    expect(reportPassed({ ok: false }).passed).toBe(false);
    expect(reportPassed({ failures: [] }).passed).toBe(true);
    expect(reportPassed({ failed: 2 }).passed).toBe(false);
    expect(reportPassed({ passed: 10 }).passed).toBe(false);
    expect(reportPassed(null).passed).toBe(false);
  });
});
