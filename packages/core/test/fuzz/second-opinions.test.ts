/**
 * Every-PR smoke of the fuzz lane without Python (WP12): the engines over the built assets against the pure-JS second
 * opinions (`gpt-tokenizer` on o200k/cl100k, `@huggingface/tokenizers` on Gemma 4 / Muse Glimmer; PA-9) on 300 seeded
 * fuzz strings each. A difference is allowed only when the divergence classifier names a known cause for it (e.g. a
 * Unicode 17 letter under Node's native `\p{L}`); the Python oracle decides who is right in `pnpm test:fuzz`. Skips
 * without `data/vocab/dist` (`pnpm vocab:build`) or `data/vocab/raw` (`pnpm vocab:fetch`).
 */
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import type { TokenizerId } from '../../src/index.ts';
import { findRawVocabDir, REPO_ROOT } from '../helpers/repo.ts';
import { readAlphabetFile } from './alphabet.ts';
import { classifyDivergence } from './classify.ts';
import { sameIds } from './compare.ts';
import { encodeWith, engineFor } from './engines.ts';
import { generateStrings } from './generators.ts';
import { secondOpinionFor } from './second-opinions.ts';

const RAW = findRawVocabDir();
const BUILT = existsSync(join(REPO_ROOT, 'data', 'vocab', 'dist', 'vocab-manifest.generated.json'));
const IDS: readonly TokenizerId[] = ['openai-o200k_base', 'openai-cl100k_base', 'google-gemma4', 'meta-llama4-muse'];
/** Building the Gemma 4 / Glimmer HF-JS tokenizers and the engines takes ≈ 2 s each on a quiet desktop. */
const TIMEOUT_MS = 60_000;

describe.skipIf(RAW === null || !BUILT)('engines vs the pure-JS second opinions (300 fuzz strings each)', () => {
  const alphabet = readAlphabetFile();
  it.each(IDS)(
    '%s: equal ids, or a classified divergence',
    (id) => {
      const opinion = secondOpinionFor(id, RAW ?? '');
      const engine = engineFor(id);
      const specials = engine.info.specials.map((s) => s.text);
      expect(opinion).not.toBeNull();
      const unexplained: string[] = [];
      let divergences = 0;
      for (const { text } of generateStrings(alphabet, 20261025, id, 300)) {
        const ours = encodeWith(engine, text);
        if ('error' in ours) throw new Error(`${id} threw on ${JSON.stringify(text)}: ${ours.error}`);
        const theirs = opinion?.encode(text) ?? [];
        if (sameIds(ours.ids, theirs)) continue;
        divergences++;
        const verdict = classifyDivergence({ text, engine: 'node-regex', specials });
        if (verdict.class === 'unclassified') unexplained.push(JSON.stringify(text));
      }
      if (divergences > 0) console.info(`[fuzz smoke] ${id}: ${String(divergences)} classified divergence(s) of 300`);
      expect(unexplained).toEqual([]);
    },
    TIMEOUT_MS,
  );
});
