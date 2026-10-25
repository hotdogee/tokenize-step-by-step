<script lang="ts">
  /**
   * Play / pause of the merge replay (05 §2, §3.5): a toggle `<button aria-pressed>` with a constant accessible name
   * (Space and Enter are native) and an inline SVG play/pause mark (AD-36).
   */
  interface Props {
    playing: boolean;
    label: string;
    disabled: boolean;
    ontoggle: () => void;
  }
  let { playing, label, disabled, ontoggle }: Props = $props();
</script>

<button
  type="button"
  class="btn btn-icon"
  aria-pressed={playing}
  aria-label={label}
  {disabled}
  data-testid="play"
  onclick={ontoggle}
>
  <svg width="18" height="18" viewBox="0 0 24 24" aria-hidden="true" focusable="false" fill="currentColor">
    {#if playing}<path d="M7 5h3.5v14H7zm6.5 0H17v14h-3.5z" />{:else}<path d="M8 5v14l11-7z" />{/if}
  </svg>
</button>

<style>
  button:disabled {
    cursor: default;
    opacity: 0.5;
  }
</style>
