<script lang="ts">
  /** Fidelity badge (PD-6, AD-23): ✓ confirmed · ≈ inferred · ◷ legacy, drawn as SVG with the word beside it. */
  import type { ModelRow } from '@tsbs/registry';
  import { i18n } from '../i18n/locale.svelte.ts';
  import Icon from './Icon.svelte';
  import type { IconName } from './icons.ts';

  interface Props {
    fidelity: ModelRow['fidelity'];
  }
  let { fidelity }: Props = $props();

  const ICON: Readonly<Record<ModelRow['fidelity'], IconName>> = {
    confirmed: 'check',
    inferred: 'approx',
    legacy: 'clock',
    reconstruction: 'approx',
    unavailable: 'close',
  };
  const LABEL = {
    confirmed: 'fidelity.confirmed',
    inferred: 'fidelity.inferred',
    legacy: 'fidelity.legacy',
    reconstruction: 'fidelity.reconstruction',
    unavailable: 'fidelity.unavailable',
  } as const;
</script>

<span class="badge control-label" data-fidelity={fidelity}>
  <Icon name={ICON[fidelity]} size={14} />{i18n.t(LABEL[fidelity])}
</span>

<style>
  .badge {
    display: inline-flex;
    align-items: center;
    gap: 0.2rem;
    padding: 0 0.4rem;
    border: var(--border-width) solid var(--border);
    border-radius: 999px;
    background: var(--surface);
    color: var(--fg);
    font-size: 0.8125rem;
    line-height: 1.5;
  }

  .badge[data-fidelity='inferred'],
  .badge[data-fidelity='unavailable'] {
    border-style: dashed;
  }
</style>
