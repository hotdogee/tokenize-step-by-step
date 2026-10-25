<script lang="ts">
  /**
   * The open drawer (05 §13), a lazy chunk: the warning — the key stays in this tab's memory, goes only to the provider
   * over HTTPS and is forgotten on reload; no backend, no analytics — then the Anthropic count panel and the xAI tokenize
   * panel. Its teardown (the drawer collapsing) and `pagehide` forget both keys and both answers, which also removes the
   * live token tier from the board. Shared panel styles live here (`.byok-panel …`).
   */
  import { onMount, tick } from 'svelte';
  import { i18n } from '../i18n/locale.svelte.ts';
  import AnthropicCountPanel from './AnthropicCountPanel.svelte';
  import type { BodyProps } from './body.ts';
  import { translateByok } from './i18n/catalogs.ts';
  import { keys } from './keys.svelte.ts';
  import { answers } from './live-state.svelte.ts';
  import XaiTokenizePanel from './XaiTokenizePanel.svelte';

  let { focus, onfocused }: BodyProps = $props();
  let root: HTMLDivElement | undefined = $state();

  function forgetEverything(): void {
    keys.forgetAll();
    answers.clear();
  }

  onMount(() => {
    window.addEventListener('pagehide', forgetEverything);
    return () => {
      window.removeEventListener('pagehide', forgetEverything);
      forgetEverything();
    };
  });

  // The picker's live-check row: focus the requested panel's heading once it is in the DOM.
  $effect(() => {
    const panel = focus;
    const element = root;
    if (panel === null || element === undefined) return;
    void tick().then(() => {
      const heading = element.querySelector<HTMLElement>(`[data-panel="${panel}"] h3`);
      heading?.focus();
      heading?.scrollIntoView({ block: 'nearest' });
      onfocused();
    });
  });
</script>

<div class="drawer" bind:this={root}>
  <p class="warning prose" data-testid="byok-warning">{translateByok(i18n.current, 'byok.warning')}</p>
  <div class="panels">
    <AnthropicCountPanel />
    <XaiTokenizePanel />
  </div>
</div>

<style>
  .drawer {
    display: grid;
    gap: 1rem;
    padding-top: 0.5rem;
  }

  .warning {
    margin: 0;
    padding: 0.5rem 0.75rem;
    border-inline-start: 4px solid var(--accent);
    background: var(--surface);
    font-size: 0.875rem;
  }

  .panels {
    display: grid;
    gap: 1rem;
  }

  @media (min-width: 1024px) {
    .panels {
      grid-template-columns: repeat(2, minmax(0, 1fr));
      align-items: start;
    }
  }

  .drawer :global(.byok-panel) {
    display: grid;
    gap: 0.625rem;
    min-width: 0;
    padding: 0.75rem;
    border: var(--border-width) solid var(--border);
    border-radius: var(--radius);
    background: var(--bg);
  }

  .drawer :global(.byok-panel h3) {
    margin: 0;
    font-size: 1rem;
  }

  .drawer :global(.byok-panel p) {
    margin: 0;
    font-size: 0.875rem;
  }

  .drawer :global(.byok-muted) {
    color: var(--fg-muted);
  }

  .drawer :global(.byok-field) {
    display: grid;
    gap: 0.25rem;
    font-size: 0.875rem;
  }

  .drawer :global(.byok-field > span),
  .drawer :global(.byok-auth legend) {
    color: var(--fg-muted);
  }

  .drawer :global(.byok-field input),
  .drawer :global(.byok-field select) {
    min-height: 2.5rem;
    width: 100%;
    min-width: 0;
    padding: 0.25rem 0.5rem;
    border: var(--border-width) solid var(--border);
    border-radius: var(--radius);
    background: var(--surface);
  }

  .drawer :global(.byok-auth) {
    display: flex;
    flex-wrap: wrap;
    gap: 0.25rem 1rem;
    margin: 0;
    padding: 0;
    border: 0;
    font-size: 0.875rem;
  }

  .drawer :global(.byok-auth legend) {
    width: 100%;
    margin-bottom: 0.125rem;
    padding: 0;
  }

  .drawer :global(.byok-auth label) {
    display: inline-flex;
    align-items: center;
    gap: 0.375rem;
    min-height: 2.5rem;
    cursor: pointer;
  }

  .drawer :global(.byok-auth input) {
    width: 1.125rem;
    height: 1.125rem;
    margin: 0;
    accent-color: var(--accent);
  }

  .drawer :global(.byok-actions) {
    display: flex;
    flex-wrap: wrap;
    gap: 0.5rem;
  }

  .drawer :global(.byok-run) {
    font-weight: 600;
  }

  .drawer :global(.btn:disabled) {
    cursor: not-allowed;
    opacity: 0.6;
  }

  .drawer :global(.byok-result) {
    display: grid;
    gap: 0.5rem;
  }

  .drawer :global(.byok-sentence) {
    font-weight: 600;
  }
</style>
