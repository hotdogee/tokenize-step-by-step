<script lang="ts">
  /**
   * About › Diagnostics (05 §14 item 8; WP13), read WITHOUT a Worker — this page loads no Worker and no vocabulary:
   *
   * - the features probed on the main thread, beside the Worker's own probe (`ready.features`) that `/` saved in
   *   sessionStorage the last time its tokenizer Worker started in this tab;
   * - the Cache API contents (`caches.keys()` + `cache.keys()`, with each body's size) with "clear cache" and the Safari
   *   7-day note;
   * - the last `loaded` diagnostics `/` saved in sessionStorage: from the cache or the network, time, bytes transferred,
   *   the layer the loader verified and the response's content encoding;
   * - the Unicode probe of 04 §8 ("pre-tokenizer Unicode 16.0; your browser reports ≈ Unicode N", from U+2FFC / U+1CC00 /
   *   U+1E6C0) and the build sha and date.
   */
  import { onMount } from 'svelte';
  import type { Features, TokenizerId } from '@tsbs/core';
  import { BUILD_DATE, BUILD_SHA } from '../app/build-info.ts';
  import { probeFeatures } from '../app/features.ts';
  import { tokenizerEntry, TOKENIZERS } from '../app/registry.ts';
  import { readStored, STORAGE_KEYS } from '../app/storage.ts';
  import { at } from '../i18n/about/t.ts';
  import { i18n } from '../i18n/locale.svelte.ts';
  import { formatMs, formatSize } from '../i18n/t.ts';
  import { cachedVocabEntries, clearVocabCaches, type CachedEntry } from '../shell/cache-probe.ts';
  import { detectUnicodeVersion, PRETOKENIZER_UNICODE } from './unicode.ts';

  interface LastLoaded {
    readonly tokenizer: TokenizerId;
    readonly ms: number;
    readonly fromCache: boolean;
    readonly bytesTransferred?: number;
    readonly layer: string;
    readonly contentEncoding: string | null;
  }

  let features: Features | null = $state(null);
  let workerFeatures: Features | null = $state(null);
  /** undefined while probing; null when the Cache API is unavailable. */
  let entries: CachedEntry[] | null | undefined = $state();
  let last: LastLoaded | null = $state(null);
  let message = $state('');
  let browserUnicode: string | null = $state(null);

  const FEATURE_ROWS = [
    { key: 'cacheApi', label: 'about.diagnostics.cacheApi' },
    { key: 'segmenter', label: 'about.diagnostics.segmenter' },
    { key: 'brotli', label: 'about.diagnostics.brotli' },
    { key: 'subtleCrypto', label: 'about.diagnostics.subtleCrypto' },
  ] as const;

  function readJson(key: string): unknown {
    try {
      const raw = readStored(key, 'session');
      return raw === null ? null : (JSON.parse(raw) as unknown);
    } catch {
      return null;
    }
  }

  function readLast(): LastLoaded | null {
    const parsed = readJson(STORAGE_KEYS.lastLoaded) as Partial<LastLoaded> | null;
    if (parsed === null) return null;
    const known = TOKENIZERS.some((entry) => entry.id === parsed.tokenizer);
    return known && typeof parsed.ms === 'number' ? (parsed as LastLoaded) : null;
  }

  function readWorkerFeatures(): Features | null {
    const parsed = readJson(STORAGE_KEYS.workerFeatures) as Partial<Record<keyof Features, unknown>> | null;
    if (parsed === null) return null;
    return FEATURE_ROWS.every((row) => typeof parsed[row.key] === 'boolean') ? (parsed as Features) : null;
  }

  function available(value: boolean | undefined): string {
    return value === undefined ? '…' : at(value ? 'about.diagnostics.yes' : 'about.diagnostics.no');
  }

  async function refresh(): Promise<void> {
    entries = await cachedVocabEntries();
  }

  async function clear(): Promise<void> {
    await clearVocabCaches();
    await refresh();
    message = at('about.diagnostics.cleared');
  }

  onMount(() => {
    features = probeFeatures();
    workerFeatures = readWorkerFeatures();
    last = readLast();
    browserUnicode = detectUnicodeVersion();
    void refresh();
  });
</script>

<div class="diagnostics" data-testid="diagnostics">
  <h3>{at('about.diagnostics.features')}</h3>
  <dl class="features" data-testid="diagnostics-features">
    {#each FEATURE_ROWS as row (row.key)}
      <div>
        <dt>{at(row.label)}</dt>
        <dd>{available(features?.[row.key])}</dd>
      </div>
    {/each}
  </dl>
  <h3>{at('about.diagnostics.workerFeatures')}</h3>
  {#if workerFeatures === null}
    <p class="prose">{at('about.diagnostics.workerNone')}</p>
  {:else}
    <dl class="features" data-testid="diagnostics-worker">
      {#each FEATURE_ROWS as row (row.key)}
        <div>
          <dt>{at(row.label)}</dt>
          <dd>{available(workerFeatures[row.key])}</dd>
        </div>
      {/each}
    </dl>
  {/if}

  <h3>{at('about.diagnostics.cache')}</h3>
  {#if entries === null}
    <p class="prose">{at('about.diagnostics.cacheUnavailable')}</p>
  {:else if entries?.length === 0}
    <p class="prose">{at('about.diagnostics.cacheEmpty')}</p>
  {:else if entries !== undefined}
    <ul class="urls" data-testid="diagnostics-cache">
      {#each entries as entry (entry.url)}
        <li class="mono">
          {at('about.diagnostics.cacheEntry', {
            path: new URL(entry.url).pathname,
            size: entry.bytes === null ? '?' : formatSize(entry.bytes, i18n.current),
          })}
        </li>
      {/each}
    </ul>
  {/if}
  <p class="prose muted">{at('about.diagnostics.safari')}</p>
  <p>
    <button type="button" class="btn" onclick={() => void clear()} disabled={entries === null}>
      {at('about.diagnostics.clear')}
    </button>
  </p>
  <p role="status" class="prose">{message}</p>

  <h3>{at('about.diagnostics.lastLoad')}</h3>
  {#if last === null}
    <p class="prose">{at('about.diagnostics.lastLoadNone')}</p>
  {:else}
    <p class="prose" data-testid="diagnostics-last-load">
      {at('about.diagnostics.lastLoadValue', {
        name: tokenizerEntry(last.tokenizer).displayName[i18n.current],
        ms: formatMs(last.ms, i18n.current),
        source: at(last.fromCache ? 'about.diagnostics.fromCache' : 'about.diagnostics.fromNetwork'),
        bytes: formatSize(last.bytesTransferred ?? 0, i18n.current),
        layer: last.layer,
        encoding: last.contentEncoding ?? at('about.diagnostics.none'),
      })}
    </p>
  {/if}

  <p class="prose" data-testid="diagnostics-unicode">
    {browserUnicode === null
      ? at('about.diagnostics.unicodeUnknown', { pinned: PRETOKENIZER_UNICODE })
      : at('about.diagnostics.unicode', { pinned: PRETOKENIZER_UNICODE, version: browserUnicode })}
  </p>
  <p class="prose" data-testid="diagnostics-build">
    {at('about.diagnostics.build', { sha: BUILD_SHA.slice(0, 7), date: BUILD_DATE })}
  </p>
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
