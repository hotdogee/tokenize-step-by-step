<script lang="ts">
  /**
   * The step-by-step board's lazy part (PA-19): the pipeline rail (six stops, scrubber, play, speed, reduce motion, merge
   * list) and the alignment board with its inspector, imported the first time the Advanced disclosure opens (Advanced.svelte),
   * as the picker dialog is — none of it is part of the startup JS of `/`. The rail stays before the board: its motion
   * director's `$effect.pre` snapshots FLIP geometry before the board commits. While mounted it runs AppState's result
   * swaps in the board's crossfade (precomputed → live, one tokenizer's answer → another's).
   */
  import { onMount } from 'svelte';
  import { appState } from '../app/context.ts';
  import { motionPrefs } from '../motion/motion-prefs.svelte.ts';
  import { crossfade } from '../motion/view-transition.ts';
  import PipelineRail from '../pipeline/PipelineRail.svelte';
  import Board from './Board.svelte';

  const app = appState();

  onMount(() => {
    app.setResultTransition((update) => crossfade(document.getElementById('board'), update, motionPrefs.reduced));
    return () => {
      app.setResultTransition(null);
    };
  });
</script>

<PipelineRail />
<Board />
