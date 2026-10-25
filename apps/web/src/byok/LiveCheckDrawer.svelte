<script lang="ts">
  /**
   * The BYOK drawer (05 §1 region 7, §13; OD-5): closed by default behind "Live check with your own API key" — a
   * disclosure button with `aria-expanded` inside the region's heading, after the footer in the tab order. Only this
   * trigger is first-paint code; the drawer's body (the warning, the Anthropic and xAI panels, their clients and strings)
   * is a lazy chunk imported on the first open (PA-7, PA-10). Collapsing unmounts the body, whose teardown forgets the
   * keys and the answers (LiveCheckBody). The picker's "Claude 3+ → live check" row opens it through `openLiveCheck`
   * (drawer.svelte.ts), which also names the panel to focus.
   */
  import type { Component } from 'svelte';
  import { appState } from '../app/context.ts';
  import { i18n } from '../i18n/locale.svelte.ts';
  import Icon from '../shell/Icon.svelte';
  import type { BodyProps } from './body.ts';
  import { drawer } from './drawer.svelte.ts';

  const app = appState();

  let Body: Component<BodyProps> | null = $state.raw(null);
  let loading = false;

  // First open: import the body (a lazy chunk). A chunk that fails to load means a page older than the deploy: the
  // shell's `fetch` alert offers the reload.
  $effect(() => {
    if (!drawer.open || Body !== null || loading) return;
    loading = true;
    import('./LiveCheckBody.svelte').then(
      (module) => {
        Body = module.default;
      },
      (error: unknown) => {
        loading = false;
        drawer.open = false;
        app.error = {
          code: 'fetch',
          message: String(error),
          retryable: false,
          tokenizer: app.tokenizer,
          previous: null,
        };
      },
    );
  });
</script>

<aside class="live-check frame" aria-labelledby="live-check-heading" id="live-check" data-testid="live-check">
  <h2 id="live-check-heading" class="heading">
    <button
      type="button"
      class="btn btn-quiet toggle"
      aria-expanded={drawer.open}
      aria-controls="live-check-body"
      data-testid="live-check-toggle"
      onclick={() => {
        drawer.open = !drawer.open;
      }}
    >
      <Icon name="chevron" />
      <span class="prose">{i18n.t('liveCheck.heading')}</span>
    </button>
  </h2>
  <div id="live-check-body" class="body" hidden={!drawer.open} aria-busy={drawer.open && Body === null}>
    {#if drawer.open && Body !== null}
      <Body
        focus={drawer.focus}
        onfocused={() => {
          drawer.focus = null;
        }}
      />
    {/if}
  </div>
</aside>

<style>
  .live-check {
    padding-block: 0.5rem 2rem;
  }

  .heading {
    margin: 0;
    font-size: 1rem;
  }

  .toggle {
    justify-content: flex-start;
    padding-inline: 0.25rem 0.5rem;
    font-weight: 600;
    text-align: start;
  }

  .toggle :global(.icon) {
    transform: rotate(-90deg);
  }

  .toggle[aria-expanded='true'] :global(.icon) {
    transform: none;
  }
</style>
