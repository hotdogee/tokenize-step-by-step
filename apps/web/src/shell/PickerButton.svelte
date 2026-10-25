<script lang="ts">
  /**
   * The tokenizer chip in the header (05 §3.4 sketch, §3.5 ARIA table): name + fidelity badge; while a tokenizer loads,
   * `aria-busy` on the button and a 2 px `role="progressbar"` beneath it with a localized `aria-valuetext`.
   */
  import { appState } from '../app/context.ts';
  import { i18n } from '../i18n/locale.svelte.ts';
  import { formatPercent } from '../i18n/t.ts';
  import FidelityBadge from './FidelityBadge.svelte';
  import Icon from './Icon.svelte';
  import { phaseKey, progressPercent } from './progress.ts';

  interface Props {
    onopen: () => void;
  }
  let { onopen }: Props = $props();
  const app = appState();

  const name = $derived(app.entry.displayName[i18n.current]);
  const loading = $derived(app.loading);
  const percent = $derived(loading === null ? 0 : progressPercent(loading));
  const valueText = $derived(
    loading === null
      ? ''
      : i18n.t('a11y.progress', {
          phase: i18n.t(phaseKey(loading.phase)),
          name: app.entry.displayName[i18n.current],
          percent: formatPercent(percent / 100, i18n.current),
        }),
  );
</script>

<div class="picker">
  <button
    type="button"
    class="btn chip"
    aria-haspopup="dialog"
    aria-busy={loading !== null}
    onclick={onopen}
    data-testid="picker-button"
  >
    <span class="name">{name}</span>
    <FidelityBadge fidelity={app.entry.fidelity} />
    <span class="visually-hidden">— {i18n.t('picker.change')}</span>
    <Icon name="chevron" size={16} />
  </button>
  {#if loading !== null}
    <div
      class="bar"
      role="progressbar"
      aria-label={i18n.t('status.loading', { name })}
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={percent}
      aria-valuetext={valueText}
      style:--progress={percent / 100}
    ></div>
  {/if}
</div>

<style>
  .picker {
    position: relative;
    min-width: 0;
  }

  .chip {
    width: 100%;
    justify-content: flex-start;
    flex-wrap: wrap;
    text-align: start;
    min-height: 2.75rem;
  }

  .name {
    font-weight: 600;
    overflow-wrap: anywhere;
  }

  .chip > :global(svg:last-child) {
    margin-inline-start: auto;
  }

  .bar {
    position: absolute;
    inset-inline: 0;
    bottom: -3px;
    height: 2px;
    background: var(--accent);
    transform: scaleX(var(--progress, 0));
    transform-origin: left;
    transition: transform var(--dur) var(--ease);
  }

  @media (prefers-reduced-motion: reduce) {
    .bar {
      transition: none;
    }
  }
</style>
