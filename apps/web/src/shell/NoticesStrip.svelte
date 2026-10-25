<script lang="ts">
  /**
   * Notices strip (05 §15): while tokenizer T is selected, every key of `requiredNotices` renders above the footer —
   * explanatory text in the UI locale, legal strings verbatim (marked `lang="en"`, never translated). It is never collapsed
   * and wraps at 360 px; with no notices it renders nothing.
   */
  import type { NoticeKey, TokenizerEntry } from '@tsbs/registry';
  import { NOTICES } from '../app/registry-stub.ts';
  import { i18n } from '../i18n/locale.svelte.ts';

  interface Props {
    entry: TokenizerEntry;
  }
  let { entry }: Props = $props();

  const notices = $derived(entry.requiredNotices.map((key: NoticeKey) => ({ key, ...NOTICES[key] })));
</script>

{#if notices.length > 0}
  <section
    class="notices"
    aria-label={i18n.t('notices.label', { name: entry.displayName[i18n.current] })}
    data-testid="notices"
  >
    <ul>
      {#each notices as notice (notice.key)}
        <li class="prose" class:headline={notice.key === 'powered-by-xai' || notice.key === 'built-with-meta-llama-3'}>
          {#if notice.href !== undefined}
            <a href={notice.href} lang={notice.legal ? 'en' : undefined}>{notice.text[i18n.current]}</a>
          {:else}
            <span lang={notice.legal ? 'en' : undefined}>{notice.text[i18n.current]}</span>
          {/if}
        </li>
      {/each}
    </ul>
  </section>
{/if}

<style>
  .notices {
    border-block-start: var(--border-width) solid var(--border);
    padding-block: 0.75rem;
  }

  ul {
    display: flex;
    flex-wrap: wrap;
    gap: 0.25rem 1.25rem;
    margin: 0;
    padding: 0;
    list-style: none;
    font-size: 0.875rem;
  }

  li {
    min-width: 0;
  }

  .headline {
    font-size: 1rem;
    font-weight: 700;
  }
</style>
