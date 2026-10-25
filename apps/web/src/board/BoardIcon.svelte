<script lang="ts" module>
  /** The board's semantic marks (AD-36): never text glyphs, always inline SVG in `currentColor`. */
  export type BoardIconName =
    'continued' | 'continues' | 'zeroWidth' | 'hatch' | 'lock' | 'byte' | 'normalized' | 'copy' | 'pin' | 'expand';
</script>

<script lang="ts">
  /**
   * Inline SVG marks of the board and the inspector (05 §4: continuation marks replacing ⤷/⤍, the zero-width marker, the
   * partial-split hatch mark, the USER_DEFINED lock, the Byte-kind icon, the NFKC arrow; copy/pin/expand for controls).
   * Always `aria-hidden`: the cell's `aria-label` or the control's name carries the text alternative.
   */
  interface Props {
    name: BoardIconName;
    size?: number;
    class?: string;
  }
  let { name, size = 12, class: className = '' }: Props = $props();
</script>

<svg
  class={`bd-icon ${className}`}
  width={size}
  height={size}
  viewBox="0 0 16 16"
  aria-hidden="true"
  focusable="false"
  fill="none"
  stroke="currentColor"
  stroke-width="1.6"
  stroke-linecap="round"
  stroke-linejoin="round"
>
  {#if name === 'continued'}
    <path d="M3 2v6.5a2 2 0 0 0 2 2h8M10 7.5l3 3-3 3" />
  {:else if name === 'continues'}
    <path d="M2 8h10M9 4.5L12.5 8 9 11.5M14.5 3v10" />
  {:else if name === 'zeroWidth'}
    <path d="M8 2.5L13.5 8 8 13.5 2.5 8z" />
    <path d="M8 6v4" />
  {:else if name === 'hatch'}
    <rect x="2" y="2" width="12" height="12" rx="1.5" />
    <path d="M2 9L9 2M2 14L14 2M7 14l7-7" />
  {:else if name === 'lock'}
    <rect x="3" y="7" width="10" height="7" rx="1.5" />
    <path d="M5.5 7V5a2.5 2.5 0 0 1 5 0v2" />
  {:else if name === 'byte'}
    <rect x="2.5" y="3.5" width="11" height="9" rx="1.5" />
    <path d="M5.5 6.5v3M8 6.5v3M10.5 6.5v3" />
  {:else if name === 'normalized'}
    <path d="M8 2.5v10M4.5 9L8 12.5 11.5 9" />
  {:else if name === 'copy'}
    <rect x="5.5" y="5.5" width="8" height="8" rx="1.5" />
    <path d="M10.5 5.5V3.5a1 1 0 0 0-1-1h-6a1 1 0 0 0-1 1v6a1 1 0 0 0 1 1h2" />
  {:else if name === 'pin'}
    <path d="M6 2.5h4l-.5 4 2.5 2.5H4l2.5-2.5zM8 9v4.5" />
  {:else}
    <path d="M4 10l4-4 4 4" />
  {/if}
</svg>
