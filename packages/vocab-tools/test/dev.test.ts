import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { gunzip } from '../src/compress.ts';
import {
  buildInMemory,
  loadClaudeJson,
  loadGrok2Json,
  loadHfJson,
  loadTiktokenText,
  toContainer,
} from '../src/dev/index.ts';
import { CLAUDE_LEGACY_PAT_STR, O200K_PAT_STR } from '../src/sources/patterns.ts';
import { HAS_RAW, ORACLE_MANIFEST, RAW } from './support/repo.ts';
import {
  byteLevelPieces,
  claudeJson,
  grok2Json,
  hfByteLevelJson,
  hfSpmJson,
  tiktokenText,
} from './support/synthetic.ts';
import { readTestContainer } from './support/tsbv-test-reader.ts';

describe('@tsbs/vocab-tools/dev loaders', () => {
  let dir = '';
  const pieces = byteLevelPieces();
  beforeAll(async () => {
    dir = await mkdtemp(join(tmpdir(), 'tsbs-dev-'));
    await writeFile(join(dir, 'ranks.tiktoken'), tiktokenText(pieces));
    await writeFile(join(dir, 'tok.json'), JSON.stringify(grok2Json(pieces)));
    await writeFile(join(dir, 'glimmer.json'), JSON.stringify(hfByteLevelJson(pieces, O200K_PAT_STR, 2048)));
    const { json, config } = hfSpmJson();
    await writeFile(join(dir, 'tokenizer.json'), JSON.stringify(json));
    await writeFile(join(dir, 'tokenizer_config.json'), JSON.stringify(config));
    await writeFile(join(dir, 'claude.json'), claudeJson(pieces, CLAUDE_LEGACY_PAT_STR));
  });
  afterAll(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  it('load tables in memory and encode containers for readTsbv1', async () => {
    const o200k = await loadTiktokenText(join(dir, 'ranks.tiktoken'), 'openai-o200k_base');
    expect(o200k.pieces).toEqual(pieces);
    expect(o200k.specials).toHaveLength(2);
    const llama3 = await loadTiktokenText(join(dir, 'ranks.tiktoken'), 'meta-llama3');
    expect(llama3.config.bosId).toBe(128000);
    const grok2 = await loadGrok2Json(join(dir, 'tok.json'));
    expect(grok2.config.idOffset).toBe(128);
    const glimmer = await loadHfJson(join(dir, 'glimmer.json'));
    expect(glimmer.tokenizerId).toBe('meta-llama4-muse');
    const gemma4 = await loadHfJson(join(dir, 'tokenizer.json'));
    expect(gemma4.tokenizerId).toBe('google-gemma4');
    expect(gemma4.config.hfMergesRegenerable).toBeUndefined();
    await expect(loadClaudeJson(join(dir, 'claude.json'))).rejects.toThrow(/64995/);

    const decoded = readTestContainer(toContainer(gemma4));
    expect(decoded.pieces).toEqual(gemma4.pieces);
    expect(decoded.merges?.resultId).toEqual([...(gemma4.merges?.resultId ?? [])]);
    expect(decoded.meta['generator']).toBe('dev');
  });
});

describe.skipIf(!HAS_RAW)('buildInMemory (vite dev fallback, real raw files)', () => {
  it('converts all nine assets without writing files', async () => {
    const result = await buildInMemory({ manifest: ORACLE_MANIFEST, raw: RAW });
    expect(result.skipped).toEqual([]);
    expect(Object.keys(result.manifest.assets)).toHaveLength(9);
    for (const entry of Object.values(result.manifest.assets)) {
      const gz = result.files.get(entry.path);
      expect(gz?.length, entry.path).toBe(entry.bytesCompressed);
      expect(new TextDecoder().decode(gunzip(gz ?? new Uint8Array()).subarray(0, 4))).toBe('TSBV');
    }
  }, 120_000);
});
