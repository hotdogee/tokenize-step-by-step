<script lang="ts">
  /**
   * A chip's token id (PA-17, 05 §4) in the digits subset: one line that narrows, then shrinks, to the room its chip
   * leaves it (`.d<n>` = digit count, board.css), or — the bare 1-column id of ≥ 5 digits (`idLines`, cells.ts) — two
   * lines split thousands-style, sized by the longer line, so the id keeps the chip's full size. Used by the token chips,
   * the zero-width markers and the BYOK live tier.
   */
  interface Props {
    id: number;
    digits: number;
    lines: readonly [string, string] | null;
  }
  let { id, digits, lines }: Props = $props();
</script>

{#if lines === null}
  <span class={`bd-id d${String(digits)}`}>{id}</span>
{:else}
  <span class={`bd-id two d${String(Math.max(3, lines[0].length))}`}
    ><span>{lines[0]}</span><span>{lines[1]}</span></span
  >
{/if}
