<script lang="ts">
  /** Inline SVG icons (AD-36). Always aria-hidden: the control that contains one names itself. */
  import type { IconName } from './icons.ts';

  interface Props {
    name: IconName;
    size?: number;
  }
  let { name, size = 18 }: Props = $props();
</script>

<svg
  class="icon"
  width={size}
  height={size}
  viewBox="0 0 24 24"
  aria-hidden="true"
  focusable="false"
  fill="none"
  stroke="currentColor"
  stroke-width="2"
  stroke-linecap="round"
  stroke-linejoin="round"
>
  {#if name === 'locale'}
    <path d="M3 5h9M7.5 3v2M5 5c.6 3.5 3 6.3 6 7.5M10 5c-.7 3.4-2.9 6.4-6 8" />
    <path d="M13 21l4-10 4 10M14.5 17.5h5" />
  {:else if name === 'theme'}
    <path d="M20 14.5A8 8 0 0 1 9.5 4a8 8 0 1 0 10.5 10.5z" />
  {:else if name === 'help'}
    <circle cx="12" cy="12" r="9" />
    <path d="M9.5 9.5a2.5 2.5 0 1 1 3.5 2.3c-.6.3-1 .8-1 1.5v.7" />
    <path d="M12 17.2v.1" />
  {:else if name === 'chevron'}
    <path d="M6 9l6 6 6-6" />
  {:else if name === 'close'}
    <path d="M6 6l12 12M18 6L6 18" />
  {:else if name === 'check'}
    <path d="M5 12.5l4.5 4.5L19 7.5" />
  {:else if name === 'approx'}
    <path d="M5 10c2-2 4-2 7 0s5 2 7 0M5 15c2-2 4-2 7 0s5 2 7 0" />
  {:else if name === 'clock'}
    <circle cx="12" cy="12" r="9" />
    <path d="M12 7v5l3 2" />
  {:else if name === 'hatch'}
    <rect x="3.5" y="3.5" width="17" height="17" rx="2" />
    <path d="M3.5 13L13 3.5M3.5 20.5l17-17M11 20.5l9.5-9.5" />
  {:else if name === 'download'}
    <path d="M12 4v11M7 10l5 5 5-5M5 20h14" />
  {:else}
    <path d="M14 4h6v6M20 4l-9 9M18 14v5a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V7a1 1 0 0 1 1-1h5" />
  {/if}
</svg>

<style>
  .icon {
    flex: none;
    vertical-align: middle;
  }
</style>
