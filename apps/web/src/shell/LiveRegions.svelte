<script lang="ts">
  /**
   * The status region (`role="status"`, polite: load completion, stage changes) and, as a separate element, the alert
   * toast (`role="alert"`, assertive, once) for errors with their 05 §12 copy and action (05 §3.5 ARIA table). The
   * message and action come from `app/errors.ts` (WP13); the toast floats above the bottom sheet, so it never shifts the
   * page.
   */
  import { appState } from '../app/context.ts';
  import { errorView, type ErrorView } from '../app/errors.ts';
  import { DEFAULT_TOKENIZER, tokenizerEntry } from '../app/registry.ts';
  import { i18n } from '../i18n/locale.svelte.ts';

  const app = appState();

  const view: ErrorView | null = $derived(
    app.error === null
      ? null
      : errorView(app.error, (id) => tokenizerEntry(id).displayName[i18n.current], DEFAULT_TOKENIZER),
  );

  function actionLabel(action: NonNullable<ErrorView['action']>): string {
    switch (action) {
      case 'reload':
        return i18n.t('action.reload');
      case 'retry':
        return i18n.t('action.retry');
      case 'back':
        return i18n.t('action.back');
    }
  }
</script>

<div class="visually-hidden" role="status" aria-live="polite" data-testid="status">{app.status}</div>
{#if app.error !== null && view !== null}
  <div class="alert" data-testid="error-toast" data-code={app.error.code} data-informational={view.informational}>
    <p role="alert" class="prose">{i18n.t(view.key, view.params)}</p>
    <div class="actions">
      {#if view.action !== null}
        <button type="button" class="btn" data-testid="error-action" onclick={() => void app.recover()}
          >{actionLabel(view.action)}</button
        >
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
    position: fixed;
    z-index: 30;
    inset-inline: max(1rem, calc((100vw - 40rem) / 2));
    bottom: calc(var(--sheet-height, 0px) + 1rem);
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 0.5rem 1rem;
    padding: 0.5rem 0.75rem;
    border: calc(var(--border-width) * 2) solid var(--fg);
    border-radius: var(--radius);
    background: var(--surface-2);
    box-shadow: 0 0.25rem 1rem rgb(0 0 0 / 0.2);
  }

  .alert[data-informational='true'] {
    border-color: var(--border);
  }

  .alert p {
    flex: 1 1 16rem;
    margin: 0;
    font-weight: 600;
    line-break: strict;
    overflow-wrap: anywhere;
  }

  .actions {
    display: flex;
    gap: 0.5rem;
  }
</style>
