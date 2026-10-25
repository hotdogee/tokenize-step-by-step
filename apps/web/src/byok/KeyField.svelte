<script lang="ts">
  /**
   * The masked API-key input of a panel (05 §13): `type="password"`, `autocomplete="off"`, no spellcheck or
   * autocapitalisation, password-manager opt-outs, and no `<form>` (nothing can submit it into a URL). Its value is the
   * provider's entry in the in-memory key store; Enter runs the panel's request. (Plain value + input handlers instead of
   * `bind:` directives keep Svelte's binding helpers out of this lazy chunk, which lazy-chunks.ts would otherwise count
   * as initial: they are reachable from the Svelte runtime's index.)
   */
  import type { ByokProvider } from './errors.ts';
  import { keys } from './keys.svelte.ts';

  interface Props {
    provider: ByokProvider;
    label: string;
    onenter: () => void;
  }
  let { provider, label, onenter }: Props = $props();
</script>

<label class="byok-field">
  <span>{label}</span>
  <input
    type="password"
    autocomplete="off"
    spellcheck="false"
    autocapitalize="off"
    data-1p-ignore=""
    data-lpignore="true"
    data-testid={`${provider}-key`}
    value={keys[provider]}
    oninput={(event) => {
      keys[provider] = event.currentTarget.value;
    }}
    onkeydown={(event) => {
      if (event.key !== 'Enter' || event.isComposing) return;
      event.preventDefault();
      onenter();
    }}
  />
</label>
