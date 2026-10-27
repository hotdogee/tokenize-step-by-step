<script lang="ts">
  /**
   * Footer (05 §1 region 6, §3.5): the selected tokenizer's fidelity sentence (on `/`), links to About and the licences,
   * the source repository, the privacy line and the build stamp. The notices strip renders just above it.
   */
  import type { Snippet } from 'svelte';
  import type { TokenizerEntry } from '@tsbs/registry';
  import { BUILD_DATE, BUILD_SHA } from '../app/build-info.ts';
  import { i18n } from '../i18n/locale.svelte.ts';
  import FidelityBadge from './FidelityBadge.svelte';

  interface Props {
    entry?: TokenizerEntry;
    /** Rendered above the links (the notices strip on `/`). */
    notices?: Snippet;
  }
  let { entry, notices }: Props = $props();

  const REPOSITORY = 'https://github.com/hotdogee/tokenize-step-by-step';
</script>

<footer class="footer">
  <div class="frame">
    {@render notices?.()}
    {#if entry !== undefined}
      <p class="fidelity prose">
        <span class="label">{i18n.t('footer.fidelity')}</span>
        <FidelityBadge fidelity={entry.fidelity} />
        <span>{entry.fidelityNote[i18n.current]}</span>
      </p>
    {/if}
    <nav aria-label={i18n.t('nav.about')}>
      <ul class="links">
        <li><a href="/about/">{i18n.t('nav.about')}</a></li>
        <li><a href="/about/#licences">{i18n.t('nav.licences')}</a></li>
        <li><a href={REPOSITORY} rel="noopener noreferrer">{i18n.t('nav.source')}</a></li>
      </ul>
    </nav>
    <p class="meta prose">
      {i18n.t('footer.privacy')}
      <span class="build mono">{i18n.t('footer.build', { sha: BUILD_SHA, date: BUILD_DATE })}</span>
    </p>
  </div>
</footer>

<style>
  .footer {
    margin-top: 1.5rem;
    border-block-start: var(--border-width) solid var(--border);
    background: var(--surface);
    padding-block: 0.75rem 1.25rem;
    font-size: 0.875rem;
  }

  .fidelity {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 0.25rem 0.5rem;
    margin: 0.75rem 0;
  }

  .label {
    color: var(--fg-muted);
  }

  .links {
    display: flex;
    flex-wrap: wrap;
    gap: 0.25rem 1.25rem;
    margin: 0.5rem 0;
    padding: 0;
    list-style: none;
  }

  .links a {
    display: inline-block;
    padding-block: 0.25rem;
  }

  .meta {
    margin: 0.5rem 0 0;
    color: var(--fg-muted);
  }

  .build {
    margin-inline-start: 0.5rem;
    font-size: 0.8125rem;
  }
</style>
