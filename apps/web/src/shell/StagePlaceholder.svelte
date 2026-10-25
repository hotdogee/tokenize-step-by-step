<script lang="ts">
  /**
   * TODO(WP09): placeholder for the pipeline rail (WP09 replaces it with the `radiogroup`, scrubber and Play).
   * It reserves the region and shows which of the six stops is current, so the `[` `]` `1`–`6` `,` `.` shortcuts have a
   * visible effect; it is a plain ordered list, not a control.
   */
  import { appState } from '../app/context.ts';
  import { i18n } from '../i18n/locale.svelte.ts';

  const app = appState();
  const STAGES = [
    { n: 1, key: 'stage.1' },
    { n: 2, key: 'stage.2' },
    { n: 3, key: 'stage.3' },
    { n: 4, key: 'stage.4.chunks', spm: 'stage.4.symbols' },
    { n: 5, key: 'stage.5' },
    { n: 6, key: 'stage.6' },
  ] as const;
  const spm = $derived(app.entry.family === 'spm-bpe');
</script>

<div class="rail" data-testid="pipeline">
  <ol>
    {#each STAGES as stage (stage.n)}
      <li aria-current={app.stage === stage.n ? 'step' : undefined}>
        <span class="num" aria-hidden="true">{stage.n}</span>
        <span class="control-label">{i18n.t('spm' in stage && spm ? stage.spm : stage.key)}</span>
      </li>
    {/each}
  </ol>
</div>

<style>
  ol {
    display: flex;
    flex-wrap: wrap;
    gap: 0.25rem;
    margin: 0;
    padding: 0;
    list-style: none;
  }

  li {
    display: inline-flex;
    flex: none;
    align-items: center;
    gap: 0.375rem;
    min-height: 2.5rem;
    padding: 0.25rem 0.625rem;
    border: var(--border-width) solid transparent;
    border-radius: 999px;
    color: var(--fg-muted);
  }

  li[aria-current='step'] {
    border-color: var(--accent);
    color: var(--fg);
    font-weight: 600;
  }

  .num {
    display: inline-grid;
    place-items: center;
    width: 1.375rem;
    height: 1.375rem;
    border: var(--border-width) solid var(--border);
    border-radius: 50%;
    font-size: 0.75rem;
    font-variant-numeric: tabular-nums;
  }
</style>
