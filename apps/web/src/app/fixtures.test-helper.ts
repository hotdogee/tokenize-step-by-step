/**
 * Test-only access to the committed golden fixtures and the oracle manifest (read as raw text through Vite's
 * `import.meta.glob`, so web tests need no Node APIs). Never imported by app code.
 */
import type { Fixture } from '@tsbs/core';

const raw = import.meta.glob<string>(
  [
    '../../../../fixtures/openai-o200k_base.json',
    '../../../../fixtures/openai-cl100k_base.json',
    '../../../../fixtures/anthropic-claude-legacy.json',
    '../../../../fixtures/google-gemma4.json',
    '../../../../fixtures/google-gemma2.json',
    '../../../../fixtures/meta-llama4-muse.json',
    '../../../../fixtures/meta-llama3.json',
    '../../../../fixtures/xai-grok2.json',
    '../../../../fixtures/xai-grok1.json',
  ],
  { query: '?raw', import: 'default', eager: true },
);

/** The nine shipping fixtures (ctok fixtures are Phase 2, AD-30), keyed by tokenizer id. */
export const SHIPPING_FIXTURES: ReadonlyMap<string, Fixture> = new Map(
  Object.values(raw).map((text) => {
    const fixture = JSON.parse(text) as Fixture;
    return [fixture.tokenizer, fixture];
  }),
);

/** The subset of tools/oracle/manifest.json the tests read. */
export interface ManifestAsset {
  readonly id: string;
  readonly lab: string;
  readonly shipIntent: string;
  readonly description: string;
  readonly notes: string;
  readonly license: { readonly spdx: string; readonly obligations: readonly string[] };
}

const manifestRaw = import.meta.glob<string>('../../../../tools/oracle/manifest.json', {
  query: '?raw',
  import: 'default',
  eager: true,
});

export const MANIFEST_ASSETS: readonly ManifestAsset[] = Object.values(manifestRaw).flatMap(
  (text) => (JSON.parse(text) as { assets: ManifestAsset[] }).assets,
);
