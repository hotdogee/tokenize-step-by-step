<script lang="ts">
  /**
   * The counts line (05 §1, §3.5 ARIA table): `<ul role="list">` of code points · grapheme clusters · bytes · tokens ·
   * partial-character tokens; the "·" separators are CSS generated content with empty alt text, so screen readers hear
   * "4 code points, 4 grapheme clusters, 12 bytes, …". Code points, graphemes and bytes are always live from the text;
   * tokens come from the current result (precomputed or live badge) and wait for the tokenizer otherwise.
   */
  import { appState } from '../app/context.ts';
  import { textStats } from '../app/text-stats.ts';
  import { i18n } from '../i18n/locale.svelte.ts';

  const app = appState();
  const stats = $derived(textStats(app.text, 0));
  const result = $derived(app.currentResult);
</script>

<div class="counts">
  <ul role="list" aria-label={i18n.t('counts.label')} data-testid="counts">
    <li>{i18n.t('counts.codePoints', { n: stats.codePoints })}</li>
    <li>{i18n.t('counts.graphemes', { n: stats.graphemes })}</li>
    <li>{i18n.t('counts.bytes', { n: stats.bytes })}</li>
    {#if result !== null}
      <li>{i18n.t('counts.tokens', { n: result.stats.tokens })}</li>
      <li>{i18n.t('counts.partial', { n: result.stats.partialTokens })}</li>
    {:else}
      <li class="pending">{i18n.t('counts.tokensPending')}</li>
    {/if}
  </ul>
  {#if result !== null}
    <span class="badge control-label" data-source={app.resultSource}
      >{i18n.t(app.resultSource === 'live' ? 'badge.live' : 'badge.precomputed')}</span
    >
  {/if}
</div>

<style>
  .counts {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 0.25rem 0.75rem;
  }

  ul {
    display: flex;
    flex-wrap: wrap;
    gap: 0 0.5rem;
    margin: 0;
    padding: 0;
    list-style: none;
    font-variant-numeric: tabular-nums;
  }

  li + li::before {
    content: '·';
    content: '·' / '';
    margin-inline-end: 0.5rem;
    color: var(--fg-muted);
  }

  .pending {
    color: var(--fg-muted);
  }

  .badge {
    padding: 0 0.4rem;
    border: var(--border-width) dashed var(--border);
    border-radius: var(--radius);
    color: var(--fg-muted);
    font-size: 0.75rem;
    text-transform: uppercase;
    letter-spacing: 0.04em;
  }

  .badge[data-source='live'] {
    border-style: solid;
    color: var(--fg);
  }
</style>
