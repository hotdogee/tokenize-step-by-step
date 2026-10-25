<script lang="ts">
  /**
   * TODO(WP-integration): placeholder region for the BYOK drawer (WP10 owns `src/byok`). It keeps the drawer's place in
   * the tab order (after the footer, 05 §8) and is the target of the picker's "Claude 3+ → live check" row.
   */
  import { i18n } from '../i18n/locale.svelte.ts';

  interface Props {
    heading?: HTMLHeadingElement | undefined;
  }
  let { heading = $bindable() }: Props = $props();
</script>

<aside class="live-check frame" aria-labelledby="live-check-heading" id="live-check">
  <h2 id="live-check-heading" tabindex="-1" bind:this={heading}>{i18n.t('liveCheck.heading')}</h2>
  <p class="prose">{i18n.t('liveCheck.privacy')}</p>
  <p class="prose muted">{i18n.t('liveCheck.unavailable')}</p>
</aside>

<style>
  .live-check {
    padding-block: 1rem 2rem;
  }

  h2 {
    margin: 0 0 0.25rem;
    font-size: 1rem;
  }

  p {
    margin: 0.25rem 0;
    font-size: 0.875rem;
  }

  .muted {
    color: var(--fg-muted);
  }
</style>
