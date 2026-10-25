<script lang="ts">
  /**
   * Hosts the inspector panel on the surface the viewport WIDTH selects (AD-34; pointer type never does):
   * ≥ 1024 px a sticky side-rail column; 768–1023 px an anchored panel beside the active cell (manual placement with a
   * flip above when there is no room below); < 768 px a fixed bottom sheet, collapsed 56 px / expanded 40 vh, toggled by
   * an `aria-expanded` handle button (no drag needed, WCAG 2.5.7). The region is non-modal everywhere: the board is never
   * made inert and focus stays in the grid while pinned.
   */
  import { i18n } from '../i18n/locale.svelte.ts';
  import BoardIcon from '../board/BoardIcon.svelte';
  import type { InspectorSurface } from '../board/viewport.svelte.ts';
  import InspectorPanel from './InspectorPanel.svelte';
  import type { InspectorModel } from './model.ts';

  interface Props {
    surface: InspectorSurface;
    model: InspectorModel | null;
    pinned: boolean;
    /** Anchored surface: show it (a cell is focused, hovered or pinned, or the panel has focus). */
    open: boolean;
    /** Anchored surface: position relative to the board layout, px. */
    anchor: { readonly top: number; readonly left: number } | null;
    expanded?: boolean;
    panel?: HTMLElement | undefined;
    host?: HTMLElement | undefined;
    oncopy: (value: string) => void;
    onunpin: () => void;
    onshowstep: (step: number) => void;
    onselect: (range: readonly [number, number]) => void;
    onescape: () => void;
    onhover: (inside: boolean) => void;
  }
  let {
    surface,
    model,
    pinned,
    open,
    anchor,
    expanded = $bindable(false),
    panel = $bindable(),
    host = $bindable(),
    ...handlers
  }: Props = $props();

  const hidden = $derived(surface === 'anchored' && !open);
</script>

<div
  class="host"
  data-surface={surface}
  data-expanded={surface === 'sheet' ? String(expanded) : undefined}
  data-testid="inspector-host"
  hidden={hidden || undefined}
  bind:this={host}
  style:--anchor-top={anchor === null ? undefined : `${String(anchor.top)}px`}
  style:--anchor-left={anchor === null ? undefined : `${String(anchor.left)}px`}
>
  {#if surface === 'sheet'}
    <button
      type="button"
      class="handle"
      aria-expanded={expanded}
      aria-controls="inspector-panel"
      aria-label={i18n.t('inspector.details')}
      data-testid="sheet-handle"
      onclick={() => {
        expanded = !expanded;
      }}
    >
      <span class="grip" aria-hidden="true"></span>
      <span class="chevron" class:flip={expanded}><BoardIcon name="expand" size={18} /></span>
    </button>
  {/if}
  <InspectorPanel
    {model}
    {pinned}
    collapsed={surface === 'sheet' && !expanded}
    bind:panel
    oncopy={handlers.oncopy}
    onunpin={handlers.onunpin}
    onshowstep={handlers.onshowstep}
    onselect={handlers.onselect}
    onescape={handlers.onescape}
    onhover={handlers.onhover}
  />
</div>

<style>
  .host {
    min-width: 0;
    color: var(--fg);
  }

  .host[hidden] {
    display: none;
  }

  /* < 768 px: bottom sheet (fixed; the board pads its scroll container by --sheet-height, 05 §5). */
  .host[data-surface='sheet'] {
    position: fixed;
    inset-inline: 0;
    bottom: 0;
    z-index: 40;
    display: grid;
    grid-template-columns: minmax(0, 1fr) auto;
    align-items: start;
    gap: 0 0.5rem;
    height: 56px;
    padding: 6px var(--gutter);
    overflow: hidden;
    border-top: calc(var(--border-width) * 2) solid var(--border);
    background: var(--surface);
    box-shadow: 0 -4px 12px rgb(0 0 0 / 0.12);
  }

  .host[data-surface='sheet'][data-expanded='true'] {
    height: 40vh;
    overflow-y: auto;
    overscroll-behavior: contain;
  }

  .host[data-surface='sheet'] .handle {
    grid-column: 2;
    grid-row: 1;
  }

  .host[data-surface='sheet'] :global(.panel) {
    grid-column: 1;
    grid-row: 1;
  }

  .host[data-surface='sheet'][data-expanded='false'] :global(.heading),
  .host[data-surface='sheet'][data-expanded='false'] :global(.summary) {
    white-space: nowrap;
    overflow: hidden;
    text-overflow: clip;
  }

  .handle {
    display: inline-grid;
    place-items: center;
    width: 44px;
    height: 44px;
    padding: 0;
    border: var(--border-width) solid var(--border);
    border-radius: var(--radius);
    background: var(--bg);
    color: var(--fg);
    cursor: pointer;
  }

  .grip {
    display: none;
  }

  .chevron {
    display: inline-grid;
  }

  .chevron.flip {
    transform: rotate(180deg);
  }

  /* 768–1023 px: anchored panel beside the active cell. */
  .host[data-surface='anchored'] {
    position: absolute;
    top: var(--anchor-top, 0);
    left: var(--anchor-left, 0);
    z-index: 30;
    width: min(320px, 100%);
    max-height: 60vh;
    overflow-y: auto;
    padding: 0.75rem;
    border: var(--border-width) solid var(--border);
    border-radius: calc(var(--radius) * 2);
    background: var(--surface);
    box-shadow: 0 6px 18px rgb(0 0 0 / 0.16);
  }

  /* ≥ 1024 px: the side rail (320 px; 420 px at ≥ 2560). */
  .host[data-surface='rail'] {
    position: sticky;
    top: 1rem;
    align-self: start;
    max-height: calc(100vh - 2rem);
    overflow-y: auto;
    padding: 0.75rem;
    margin-inline-start: var(--gutter);
    border: var(--border-width) solid var(--border);
    border-radius: calc(var(--radius) * 2);
    background: var(--surface);
  }
</style>
