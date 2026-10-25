<script lang="ts">
  /** "Single-key shortcuts: on / off" (AD-22, WCAG 2.2 SC 2.1.4), persisted; shown in the `?` dialog and About › Keyboard. */
  import { i18n } from '../i18n/locale.svelte.ts';
  import { preferences } from './preferences.svelte.ts';

  interface Props {
    id: string;
  }
  let { id }: Props = $props();
</script>

<div class="setting">
  <label class="toggle">
    <input
      id={`${id}-input`}
      type="checkbox"
      role="switch"
      checked={preferences.singleKeyShortcuts}
      aria-describedby={`${id}-hint`}
      onchange={(event) => {
        preferences.setSingleKeyShortcuts(event.currentTarget.checked);
      }}
    />
    <span class="control-label">{i18n.t('help.singleKey')}</span>
  </label>
  <p id={`${id}-hint`} class="prose hint">{i18n.t('help.singleKeyHint')}</p>
</div>

<style>
  .setting {
    padding: 0.75rem;
    border: var(--border-width) solid var(--border);
    border-radius: var(--radius);
    background: var(--surface);
  }

  .toggle {
    display: inline-flex;
    align-items: center;
    gap: 0.5rem;
    min-height: 2.5rem;
    font-weight: 600;
    cursor: pointer;
  }

  input {
    width: 1.25rem;
    height: 1.25rem;
    margin: 0;
    accent-color: var(--accent);
  }

  .hint {
    margin: 0.25rem 0 0;
    color: var(--fg-muted);
    font-size: 0.875rem;
  }
</style>
