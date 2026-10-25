<script lang="ts">
  /**
   * The status region (`role="status"`, polite: load completion, stage changes) and, as a separate element, the alert
   * (`role="alert"`, assertive, once) for errors with their 05 §12 copy and action (05 §3.5 ARIA table).
   */
  import { appState } from '../app/context.ts';
  import type { UiError } from '../app/app-state.svelte.ts';
  import { tokenizerEntry, DEFAULT_TOKENIZER } from '../app/registry.ts';
  import { i18n } from '../i18n/locale.svelte.ts';

  const app = appState();

  function message(error: UiError): string {
    const name = tokenizerEntry(error.tokenizer).displayName[i18n.current];
    switch (error.code) {
      case 'fetch':
        return i18n.t('error.fetch');
      case 'integrity':
        return i18n.t('error.integrity');
      case 'oom':
        return i18n.t('error.oom', {
          name,
          fallback: tokenizerEntry(error.previous ?? DEFAULT_TOKENIZER).displayName[i18n.current],
        });
      case 'quota':
        return i18n.t('error.quota');
      default:
        return i18n.t('error.internal', { message: error.message });
    }
  }

  function action(error: UiError): string | null {
    switch (error.code) {
      case 'fetch':
        return i18n.t('action.reload');
      case 'oom':
        return i18n.t('action.back');
      case 'quota':
        return null;
      default:
        return i18n.t('action.retry');
    }
  }
</script>

<div class="visually-hidden" role="status" aria-live="polite" data-testid="status">{app.status}</div>
{#if app.error !== null}
  {@const error = app.error}
  {@const label = action(error)}
  <div class="alert">
    <p role="alert" class="prose">{message(error)}</p>
    <div class="actions">
      {#if label !== null}
        <button type="button" class="btn" onclick={() => void app.recover()}>{label}</button>
      {/if}
      <button
        type="button"
        class="btn btn-quiet"
        onclick={() => {
          app.dismissError();
        }}>{i18n.t('action.dismiss')}</button
      >
    </div>
  </div>
{/if}

<style>
  .alert {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 0.5rem 1rem;
    margin-block: 0.5rem;
    padding: 0.5rem 0.75rem;
    border: calc(var(--border-width) * 2) solid var(--fg);
    border-radius: var(--radius);
    background: var(--surface-2);
  }

  .alert p {
    flex: 1 1 16rem;
    margin: 0;
    font-weight: 600;
  }

  .actions {
    display: flex;
    gap: 0.5rem;
  }
</style>
