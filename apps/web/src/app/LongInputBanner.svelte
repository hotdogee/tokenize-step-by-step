<script lang="ts">
  /**
   * The long-input banners (AD-27, 05 §6): above 20,000 code points live tokenization pauses behind "Long input —
   * tokenize on demand" and a button that tokenizes the WHOLE (analysed) text once; above 200,000 code points a second
   * line says only the first 200,000 are analysed (the text stays in the textarea, never truncated). The banner text is
   * a polite status, so pasting a long text announces it once. While a run is in flight the button stays focusable
   * (`aria-disabled`, not `disabled`, with a guard): disabling the focused button would drop keyboard focus to the body
   * (05 §8).
   */
  import { i18n } from '../i18n/locale.svelte.ts';
  import { appState } from './context.ts';
  import { ANALYSED_MAX, isOnDemand } from './long-input.ts';

  const app = appState();
  const shown = $derived(isOnDemand(app.longInput));
  const capped = $derived(app.longInput === 'capped');

  function run(): void {
    if (!app.running) void app.runOnDemand();
  }
</script>

{#if shown}
  <div class="banner" data-testid="long-input-banner" data-capped={capped}>
    <div class="text prose" role="status">
      <p>{i18n.t('longInput.banner')}</p>
      {#if capped}<p data-testid="cap-banner">{i18n.t('longInput.capped', { n: ANALYSED_MAX })}</p>{/if}
    </div>
    <button
      type="button"
      class="btn"
      data-testid="long-input-run"
      aria-disabled={app.running}
      aria-busy={app.running}
      onclick={run}>{app.running ? i18n.t('progress.encode') : i18n.t('longInput.run')}</button
    >
  </div>
{/if}

<style>
  .banner {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    justify-content: space-between;
    gap: 0.5rem 1rem;
    padding: 0.5rem 0.75rem;
    border: var(--border-width) solid var(--border);
    border-inline-start-width: 4px;
    border-radius: var(--radius);
    background: var(--surface);
  }

  .text {
    flex: 1 1 16rem;
  }

  .text p {
    margin: 0;
    line-break: strict;
    overflow-wrap: anywhere;
  }

  .text p:first-child {
    font-weight: 600;
  }

  .btn {
    min-height: 2.5rem;
  }

  .btn[aria-disabled='true'] {
    cursor: progress;
  }
</style>
