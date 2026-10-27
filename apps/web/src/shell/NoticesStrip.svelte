<script lang="ts">
  /**
   * Notices strip (05 §15): every notice that a tokenizer on screen requires renders above the footer — PA-19: the
   * deduplicated union of `requiredNotices` over the table's rows and, while Advanced is open, the board's tokenizer,
   * prominent legal notices first ("Powered by xAI", "Built with Meta Llama 3", heading-sized), then the other legal
   * strings (verbatim, marked `lang="en"`, never translated), then the explanatory ones in the UI locale; the first
   * occurrence of a notice key wins. A legal notice is a link of its own (its first licences.json link); an explanatory
   * one is plain muted text followed by that link under its short licences.json label (PA-19 review: the default page's
   * notices read lighter). It is never collapsed and wraps at 360 px; with no notices it renders nothing.
   */
  import type { TokenizerEntry } from '@tsbs/registry';
  import { notice, noticeText } from '../app/registry.ts';
  import { i18n } from '../i18n/locale.svelte.ts';

  interface Props {
    /** The tokenizers on screen, in display order (repeats are fine). */
    entries: readonly TokenizerEntry[];
  }
  let { entries }: Props = $props();

  /** At most this many tokenizer names in the strip's label; more are counted instead. */
  const NAMED = 3;

  const notices = $derived.by(() => {
    const keys = [...new Set(entries.flatMap((entry) => entry.requiredNotices))];
    const rank = (legal: boolean, prominent: boolean): number => (legal ? (prominent ? 0 : 1) : 2);
    return keys
      .map((key, order) => {
        const found = notice(key);
        const legal = found.kind === 'legal';
        const prominent = found.prominent === true;
        return {
          key,
          order,
          legal,
          prominent,
          text: noticeText(found, i18n.current),
          href: found.links?.[0]?.href,
          label: found.links?.[0]?.label[i18n.current],
        };
      })
      .sort((a, b) => rank(a.legal, a.prominent) - rank(b.legal, b.prominent) || a.order - b.order);
  });
  const named = $derived([
    ...new Set(entries.filter((entry) => entry.requiredNotices.length > 0).map((e) => e.displayName[i18n.current])),
  ]);
  const label = $derived(
    named.length > NAMED
      ? i18n.t('notices.labelMany', { count: named.length })
      : i18n.t('notices.label', { name: named.join(i18n.t('a11y.sep')) }),
  );
</script>

{#if notices.length > 0}
  <section class="notices" aria-label={label} data-testid="notices">
    <ul>
      {#each notices as notice (notice.key)}
        <li class="prose" class:headline={notice.prominent} data-notice={notice.key}>
          {#if notice.href !== undefined && notice.legal}
            <a href={notice.href} lang="en">{notice.text}</a>
          {:else if notice.href !== undefined}
            <span class="explain">{notice.text}</span>
            <a href={notice.href}>{notice.label}</a>
          {:else}
            <span lang={notice.legal ? 'en' : undefined}>{notice.text}</span>
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

  /* A notice is a link of its own, not a link inside running text: ≥ 24 px tall to tap (WCAG 2.5.8; PA-19 puts
     "Powered by xAI" on the default view). */
  a {
    display: inline-block;
    padding-block: 0.25rem;
  }

  .headline {
    font-size: 1rem;
    font-weight: 700;
  }

  .explain {
    color: var(--fg-muted);
  }
</style>
