<script lang="ts">
  /** About › Fidelity (05 §14 item 2): model → tokenizer → status → evidence → checked on, from models.json. */
  import { MODELS, tokenizerEntry } from '../app/registry.ts';
  import { at } from '../i18n/about/t.ts';
  import { i18n } from '../i18n/locale.svelte.ts';
  import FidelityBadge from '../shell/FidelityBadge.svelte';

  const dateFormat = $derived(new Intl.DateTimeFormat(i18n.current, { dateStyle: 'medium', timeZone: 'UTC' }));
  const LEGEND = [
    { fidelity: 'confirmed', key: 'fidelity.legend.confirmed' },
    { fidelity: 'inferred', key: 'fidelity.legend.inferred' },
    { fidelity: 'legacy', key: 'fidelity.legend.legacy' },
    { fidelity: 'reconstruction', key: 'fidelity.legend.reconstruction' },
  ] as const;
</script>

<div class="scroll" role="region" aria-labelledby="fidelity-caption">
  <table>
    <caption id="fidelity-caption">{at('about.fidelity.caption')}</caption>
    <thead>
      <tr>
        <th scope="col">{at('about.fidelity.model')}</th>
        <th scope="col">{at('about.fidelity.tokenizer')}</th>
        <th scope="col">{at('about.fidelity.status')}</th>
        <th scope="col">{at('about.fidelity.evidence')}</th>
        <th scope="col">{at('about.fidelity.checked')}</th>
      </tr>
    </thead>
    <tbody>
      {#each MODELS as row (row.model)}
        <tr>
          <th scope="row" lang="en">{row.model}</th>
          <td>
            {#if row.tokenizer === null}
              {at('about.fidelity.liveCheck')}
            {:else}
              {tokenizerEntry(row.tokenizer).displayName[i18n.current]}
            {/if}
          </td>
          <td><FidelityBadge fidelity={row.fidelity} /></td>
          <td><a href={row.evidenceUrl} rel="noopener noreferrer">{at('about.fidelity.source')}</a></td>
          <td class="date">{dateFormat.format(new Date(row.checkedOn))}</td>
        </tr>
      {/each}
    </tbody>
  </table>
</div>
<dl class="legend">
  {#each LEGEND as item (item.fidelity)}
    <div>
      <dt><FidelityBadge fidelity={item.fidelity} /></dt>
      <dd class="prose">{at(item.key)}</dd>
    </div>
  {/each}
</dl>

<style>
  .scroll {
    max-width: 100%;
    overflow-x: auto;
  }

  table {
    width: 100%;
    border-collapse: collapse;
    font-size: 0.9375rem;
  }

  caption {
    padding-block-end: 0.5rem;
    color: var(--fg-muted);
    text-align: start;
  }

  th,
  td {
    padding: 0.4rem 0.5rem;
    border-block-end: var(--border-width) solid var(--surface-3);
    text-align: start;
    vertical-align: top;
  }

  thead th {
    border-block-end-color: var(--border);
    font-size: 0.8125rem;
    color: var(--fg-muted);
    white-space: nowrap;
  }

  tbody th {
    font-weight: 600;
  }

  .date {
    white-space: nowrap;
    font-variant-numeric: tabular-nums;
  }

  .legend {
    display: grid;
    gap: 0.375rem;
    margin: 1rem 0 0;
  }

  .legend div {
    display: flex;
    flex-wrap: wrap;
    align-items: baseline;
    gap: 0.25rem 0.5rem;
  }

  dt,
  dd {
    margin: 0;
  }

  dd {
    flex: 1 1 16rem;
    font-size: 0.875rem;
  }
</style>
