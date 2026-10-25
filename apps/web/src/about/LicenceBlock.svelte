<script lang="ts">
  /**
   * One per-asset licence block (05 §14 item 3): description, lab, SPDX, obligations verbatim, provenance, pinned upstream
   * URL + revision + date, SHA-256 of the upstream file and of the served `.bin`, the MODIFIED statement, and each licence
   * text in a `<details>` whose body is fetched from `/licenses/<assetId>/<file>` when first opened (same origin, so the
   * CSP's `connect-src 'self'` allows it). Legal text is never translated and is marked `lang="en"`.
   */
  import { notice } from '../app/registry.ts';
  import { at } from '../i18n/about/t.ts';
  import { i18n } from '../i18n/locale.svelte.ts';
  import { licenceTextUrl, type GeneratedLicence } from './licences.ts';

  interface Props {
    licence: GeneratedLicence;
  }
  let { licence }: Props = $props();

  type TextState = { status: 'idle' | 'loading' | 'failed' } | { status: 'loaded'; text: string };
  let texts: Record<string, TextState> = $state({});

  async function load(file: string): Promise<void> {
    if (texts[file] !== undefined && texts[file].status !== 'failed') return;
    texts[file] = { status: 'loading' };
    try {
      const response = await fetch(licenceTextUrl(licence.assetId, file), { credentials: 'omit' });
      if (!response.ok) throw new Error(String(response.status));
      texts[file] = { status: 'loaded', text: await response.text() };
    } catch {
      texts[file] = { status: 'failed' };
    }
  }

  const headingId = $derived(`licence-${licence.assetId}`);
</script>

<article class="licence" aria-labelledby={headingId}>
  <h3 id={headingId}><span class="mono">{licence.assetId}</span></h3>
  <p class="description prose" lang="en">{licence.description}</p>
  <dl>
    <dt>{at('about.licence.lab')}</dt>
    <dd lang="en">{licence.lab}</dd>
    <dt>{at('about.licence.spdx')}</dt>
    <dd class="mono">{licence.spdx}</dd>
    <dt>{at('about.licence.obligations')}</dt>
    <dd>
      <ul class="obligations" lang="en">
        {#each licence.obligations as obligation, i (i)}
          <li class="prose">{obligation}</li>
        {/each}
      </ul>
    </dd>
    {#if licence.notice !== null}
      <dt lang="en">{licence.notice.file}</dt>
      <dd class="notice prose" lang="en">{licence.notice.text}</dd>
    {/if}
    <dt>{at('about.licence.upstream')}</dt>
    <dd><a class="url" href={licence.upstream.url} rel="noopener noreferrer">{licence.upstream.file}</a></dd>
    <dt>{at('about.licence.revision')}</dt>
    <dd class="mono">{licence.upstream.revision}</dd>
    <dt>{at('about.licence.retrieved')}</dt>
    <dd class="mono">{licence.upstream.retrievedOn}</dd>
    <dt>{at('about.licence.sha')}</dt>
    <dd class="mono hash">{licence.upstream.sha256}</dd>
    <dt>{at('about.licence.shaShipped')}</dt>
    <dd class={licence.shipped === null ? 'muted' : 'mono hash'}>
      {licence.shipped === null ? at('about.licence.shaPending') : licence.shipped.sha256}
    </dd>
    <dt>{at('about.licence.modified')}</dt>
    <dd class="prose">
      {#if licence.modified !== null}<span lang="en">{licence.modified}</span>{:else}{notice('modified-asset').body[
          i18n.current
        ]}{/if}
    </dd>
    <dt>{at('about.licence.provenance')}</dt>
    <dd class="prose notes" lang="en">{licence.notes}</dd>
  </dl>
  {#each licence.licenceFiles as file (file)}
    {@const text = texts[file]}
    <details
      ontoggle={(event) => {
        if (event.currentTarget.open) void load(file);
      }}
    >
      <summary>{at('about.licence.text', { file })}</summary>
      {#if text?.status === 'loaded'}
        <!-- svelte-ignore a11y_no_noninteractive_tabindex (a scrollable region must be keyboard-reachable) -->
        <pre lang="en" tabindex="0">{text.text}</pre>
      {:else if text?.status === 'failed'}
        <p class="prose">{at('about.licence.textFailed')}</p>
      {:else}
        <p class="prose muted">{at('about.licence.textLoading')}</p>
      {/if}
      <p><a href={licenceTextUrl(licence.assetId, file)}>{at('about.licence.open', { file })}</a></p>
    </details>
  {/each}
</article>

<style>
  .licence {
    padding: 1rem;
    border: var(--border-width) solid var(--border);
    border-radius: var(--radius);
    background: var(--surface);
  }

  h3 {
    margin: 0 0 0.25rem;
    font-size: 1.0625rem;
  }

  .description {
    margin: 0 0 0.75rem;
  }

  dl {
    display: grid;
    grid-template-columns: minmax(0, 1fr);
    gap: 0.125rem 1rem;
    margin: 0;
  }

  @media (min-width: 640px) {
    dl {
      grid-template-columns: minmax(8rem, 12rem) minmax(0, 1fr);
    }
  }

  dt {
    color: var(--fg-muted);
    font-size: 0.875rem;
  }

  dd {
    margin: 0 0 0.5rem;
    min-width: 0;
  }

  .hash,
  .url {
    overflow-wrap: anywhere;
    word-break: break-all;
  }

  .obligations {
    margin: 0;
    padding-inline-start: 1.25rem;
  }

  .notes {
    font-size: 0.875rem;
  }

  .muted {
    color: var(--fg-muted);
  }

  details {
    margin-top: 0.5rem;
  }

  summary {
    min-height: 2.5rem;
    padding-block: 0.5rem;
    cursor: pointer;
    font-weight: 600;
  }

  pre {
    max-height: 24rem;
    overflow: auto;
    padding: 0.75rem;
    border: var(--border-width) solid var(--border);
    border-radius: var(--radius);
    background: var(--bg);
    font-size: 0.8125rem;
    white-space: pre-wrap;
    overflow-wrap: anywhere;
  }
</style>
