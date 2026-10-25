<script lang="ts">
  /**
   * Grapheme-cluster brackets (05 §4): a 1 px bracket above each cluster of more than one code point (ZWJ emoji, flags,
   * IVS, combining sequences), open on the side where the cluster continues on another row. Decorative: the inspector's
   * Character section states the cluster ("cluster 0: 5 code points, 18 bytes"). Hidden by the `g` toggle and when the
   * segmenter is the fallback (PD-4).
   */
  import type { BracketModel } from './cells.ts';
  import { placeClass } from './cell-state.ts';

  interface Props {
    brackets: readonly BracketModel[];
  }
  let { brackets }: Props = $props();
</script>

<div class="bd-brackets" aria-hidden="true">
  {#each brackets as bracket (bracket.key)}
    <span
      class={`bd-gbracket ${placeClass(bracket.col, bracket.span)}`}
      class:open-start={!bracket.first}
      class:open-end={!bracket.last}
      data-grapheme={bracket.key}
    ></span>
  {/each}
</div>
