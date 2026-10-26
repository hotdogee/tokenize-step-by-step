import examplesRaw from '@tsbs/registry/data/examples.json?raw';
import { describe, expect, it } from 'vitest';
import { whyByKey } from './example-why.svelte.ts';
import { EXAMPLES } from './registry.ts';

describe('example-why (PA-7: the why sentences other than the default chip’s load on demand)', () => {
  it('reads every chip’s sentence from the full examples.json, keyed by chip', () => {
    const why = whyByKey(examplesRaw);
    expect(Object.keys(why)).toEqual(EXAMPLES.map((chip) => chip.key));
    for (const chip of EXAMPLES)
      for (const locale of ['en', 'zh-TW', 'ja'] as const) expect(why[chip.key]?.[locale]).toBeTruthy();
  });
});
