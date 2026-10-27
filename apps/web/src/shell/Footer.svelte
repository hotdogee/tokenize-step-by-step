<script lang="ts">
  /**
   * Footer (05 §1 region 6, §3.5): links to About and the licences, the source repository, the privacy line and the build
   * stamp. The notices strip renders just above it on `/`. PA-19 dropped the selected tokenizer's fidelity sentence: each
   * table row's caption carries its fidelity badge, and the picker and About explain them.
   */
  import type { Snippet } from 'svelte';
  import { BUILD_DATE, BUILD_SHA } from '../app/build-info.ts';
  import { i18n } from '../i18n/locale.svelte.ts';

  interface Props {
    /** Rendered above the links (the notices strip on `/`). */
    notices?: Snippet;
  }
  let { notices }: Props = $props();

  const REPOSITORY = 'https://github.com/hotdogee/tokenize-step-by-step';
</script>

<footer class="footer">
  <div class="frame">
    {@render notices?.()}
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
