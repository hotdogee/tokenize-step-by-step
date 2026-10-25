/**
 * Paths into the repository for tests that use committed data (fixtures, oracle manifest, licence snapshots) and,
 * when present, the raw vocabularies (`data/vocab/raw`, gitignored; `TSBS_RAW_DIR` overrides).
 */
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';

export const REPO = fileURLToPath(new URL('../../../../', import.meta.url));
export const FIXTURES = join(REPO, 'fixtures');
export const ORACLE_MANIFEST = join(REPO, 'tools', 'oracle', 'manifest.json');
export const LICENSES = join(REPO, 'docs', 'licenses');
export const RAW = process.env['TSBS_RAW_DIR'] ?? join(REPO, 'data', 'vocab', 'raw');

/** True iff every raw vocabulary file of the nine shipped assets is present locally. */
export const HAS_RAW = [
  'openai-o200k_base/o200k_base.tiktoken',
  'openai-cl100k_base/cl100k_base.tiktoken',
  'anthropic-claude-legacy/claude.json',
  'google-gemma4/tokenizer.json',
  'google-gemma4/tokenizer_config.json',
  'google-gemma2/tokenizer.model',
  'meta-muse-glimmer/tokenizer.json',
  'meta-llama3-model/tokenizer.model',
  'xai-grok2/tokenizer.tok.json',
  'xai-grok1/tokenizer.model',
].every((file) => existsSync(join(RAW, ...file.split('/'))));
