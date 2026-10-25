<script lang="ts">
  /**
   * A BYOK failure (05 §12, §3.5 ARIA table): a `role="alert"` element of its own (assertive, announced once when it
   * appears), the mapped sentence and, when the provider sent one, its own message with the key masked out.
   */
  import { i18n } from '../i18n/locale.svelte.ts';
  import { errorMessageKey, PROVIDER_NAMES, type ByokError, type ByokProvider } from './errors.ts';
  import { translateByok } from './i18n/catalogs.ts';
  import { TIMEOUT_SECONDS } from './request.ts';

  interface Props {
    error: ByokError;
    provider: ByokProvider;
    /** The provider's API host (network/CORS sentence). */
    host: string;
  }
  let { error, provider, host }: Props = $props();

  const message = $derived(
    translateByok(i18n.current, errorMessageKey(error.code), { status: error.status ?? 0, host, n: TIMEOUT_SECONDS }),
  );
</script>

<div class="alert" role="alert" data-testid="byok-error" data-code={error.code}>
  <p class="prose">{message}</p>
  {#if error.detail !== null}
    <p class="prose detail">
      {translateByok(i18n.current, 'byok.error.detail', { provider: PROVIDER_NAMES[provider], detail: error.detail })}
    </p>
  {/if}
</div>

<style>
  .alert {
    display: grid;
    gap: 0.25rem;
    padding: 0.5rem 0.75rem;
    border: calc(var(--border-width) * 2) solid var(--fg);
    border-radius: var(--radius);
    background: var(--surface-2);
  }

  .alert p {
    margin: 0;
    font-size: 0.875rem;
  }

  .alert p:first-child {
    font-weight: 600;
  }

  .detail {
    color: var(--fg-muted);
  }
</style>
