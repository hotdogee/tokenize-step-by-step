<script lang="ts">
  /**
   * About › Diagnostics (05 §14 item 8), read WITHOUT a Worker: Cache API contents (`caches.keys()` + `cache.keys()`) with
   * "clear cache" and the Safari 7-day note, the features probed on the main thread, and the last `loaded` diagnostics
   * that `/` saved in sessionStorage. This page loads no Worker and no vocabulary.
   */
  import { onMount } from 'svelte';
  import type { Features, TokenizerId } from '@tsbs/core';
  import { probeFeatures } from '../app/features.ts';
  import { tokenizerEntry, TOKENIZERS } from '../app/registry.ts';
  import { readStored, STORAGE_KEYS } from '../app/storage.ts';
  import { at } from '../i18n/about/t.ts';
  import { i18n } from '../i18n/locale.svelte.ts';
  import { formatMs } from '../i18n/t.ts';
  import { cachedVocabUrls, clearVocabCaches } from '../shell/cache-probe.ts';

  interface LastLoaded {
    readonly tokenizer: TokenizerId;
    readonly ms: number;
    readonly fromCache: boolean;
    readonly layer: string;
    readonly contentEncoding: string | null;
  }

  let features: Features | null = $state(null);
  /** undefined while probing; null when the Cache API is unavailable. */
  let urls: string[] | null | undefined = $state();
  let last: LastLoaded | null = $state(null);
  let message = $state('');

  const FEATURE_ROWS = [
    { key: 'cacheApi', label: 'about.diagnostics.cacheApi' },
    { key: 'segmenter', label: 'about.diagnostics.segmenter' },
    { key: 'brotli', label: 'about.diagnostics.brotli' },
    { key: 'subtleCrypto', label: 'about.diagnostics.subtleCrypto' },
  ] as const;

  function readLast(): LastLoaded | null {
    try {
      const raw = readStored(STORAGE_KEYS.lastLoaded, 'session');
      if (raw === null) return null;
      const parsed = JSON.parse(raw) as Partial<LastLoaded>;
      const known = TOKENIZERS.some((entry) => entry.id === parsed.tokenizer);
      return known && typeof parsed.ms === 'number' ? (parsed as LastLoaded) : null;
    } catch {
      return null;
    }
  }

  async function refresh(): Promise<void> {
    urls = await cachedVocabUrls();
  }

  async function clear(): Promise<void> {
    await clearVocabCaches();
    await refresh();
    message = at('about.diagnostics.cleared');
  }

  onMount(() => {
    features = probeFeatures();
    last = readLast();
    void refresh();
  });
</script>

<div class="diagnostics">
  <h3>{at('about.diagnostics.features')}</h3>
  <dl class="features">
    {#each FEATURE_ROWS as row (row.key)}
      <div>
        <dt>{at(row.label)}</dt>
        <dd>
          {features === null ? '…' : at(features[row.key] ? 'about.diagnostics.yes' : 'about.diagnostics.no')}
        </dd>
      </div>
    {/each}
  </dl>

  <h3>{at('about.diagnostics.cache')}</h3>
  {#if urls === null}
    <p class="prose">{at('about.diagnostics.cacheUnavailable')}</p>
  {:else if urls?.length === 0}
    <p class="prose">{at('about.diagnostics.cacheEmpty')}</p>
  {:else if urls !== undefined}
    <ul class="urls">
      {#each urls as url (url)}<li class="mono">{new URL(url).pathname}</li>{/each}
    </ul>
  {/if}
  <p class="prose muted">{at('about.diagnostics.safari')}</p>
  <p>
    <button type="button" class="btn" onclick={() => void clear()} disabled={urls === null}>
      {at('about.diagnostics.clear')}
    </button>
  </p>
  <p role="status" class="prose">{message}</p>

  <h3>{at('about.diagnostics.lastLoad')}</h3>
  {#if last === null}
    <p class="prose">{at('about.diagnostics.lastLoadNone')}</p>
  {:else}
    <p class="prose">
      {at('about.diagnostics.lastLoadValue', {
        name: tokenizerEntry(last.tokenizer).displayName[i18n.current],
        ms: formatMs(last.ms, i18n.current),
        source: at(last.fromCache ? 'about.diagnostics.fromCache' : 'about.diagnostics.fromNetwork'),
        layer: last.layer,
        encoding: last.contentEncoding ?? at('about.diagnostics.none'),
      })}
    </p>
  {/if}
</div>

<style>
  h3 {
    margin: 1rem 0 0.25rem;
    font-size: 1rem;
  }

  .features {
    display: grid;
    gap: 0.25rem;
    margin: 0;
  }

  .features div {
    display: flex;
    flex-wrap: wrap;
    justify-content: space-between;
    gap: 0 1rem;
    padding-block: 0.25rem;
    border-block-end: var(--border-width) solid var(--surface-3);
  }

  dt,
  dd {
    margin: 0;
  }

  .urls {
    margin: 0;
    padding-inline-start: 1.25rem;
    overflow-wrap: anywhere;
  }

  .muted {
    color: var(--fg-muted);
    font-size: 0.875rem;
  }
</style>
