<script lang="ts">
  /**
   * The merge-step scrubber (05 §2, §8, §9): a native `<input type="range" min=0 max=steps>` over the replay scope, with
   * chunk-boundary ticks (`<datalist>`, also drawn under the track), `aria-valuetext` = the merge sentence and
   * `touch-action: pan-y` on the input (horizontal drags scrub, vertical pans scroll; a pseudo-element thumb cannot carry
   * its own). Native keys: arrows ±1, Page Up/Down, Home/End = first/last step; Space plays/pauses while the scrubber has
   * focus (AD-22; it is component-scoped, so the "Single-key shortcuts" setting does not affect it). Thumb 28 px on fine
   * pointers, 44 px on coarse ones (05 §3.3).
   */
  interface Props {
    max: number;
    value: number;
    ticks: readonly number[];
    label: string;
    valueText: string;
    counter: string;
    disabled: boolean;
    onseek: (position: number) => void;
    ontoggle: () => void;
  }
  let { max, value, ticks, label, valueText, counter, disabled, onseek, ontoggle }: Props = $props();
</script>

<div class="scrubber">
  <div class="track">
    <input
      type="range"
      min="0"
      {max}
      step="1"
      {value}
      list={ticks.length > 0 ? 'tsbs-scrub-ticks' : undefined}
      aria-label={label}
      aria-valuetext={valueText}
      {disabled}
      data-testid="scrubber"
      oninput={(event) => {
        onseek(Number(event.currentTarget.value));
      }}
      onkeydown={(event) => {
        if (event.key !== ' ' && event.code !== 'Space') return;
        event.preventDefault();
        ontoggle();
      }}
    />
    {#if ticks.length > 0}
      <datalist id="tsbs-scrub-ticks">
        {#each ticks as tick (tick)}<option value={tick}></option>{/each}
      </datalist>
      <div class="ticks" aria-hidden="true">
        {#each ticks as tick (tick)}<span style:--at={tick / Math.max(1, max)}></span>{/each}
      </div>
    {/if}
  </div>
  <span class="counter mono control-label" aria-hidden="true">{counter}</span>
</div>

<style>
  .scrubber {
    --thumb: 28px;
    display: flex;
    flex: 1 1 16rem;
    align-items: center;
    gap: 0.75rem;
    min-width: 0;
  }

  @media (pointer: coarse) {
    .scrubber {
      --thumb: 44px;
    }
  }

  .track {
    position: relative;
    flex: 1 1 auto;
    min-width: 8rem;
  }

  input {
    display: block;
    width: 100%;
    height: calc(var(--thumb) + 8px);
    margin: 0;
    background: transparent;
    appearance: none;
    touch-action: pan-y;
    cursor: pointer;
  }

  input:disabled {
    cursor: default;
    opacity: 0.5;
  }

  input:focus-visible {
    box-shadow: none;
  }

  input::-webkit-slider-runnable-track {
    height: 4px;
    border-radius: 2px;
    background: var(--surface-3);
  }

  input::-moz-range-track {
    height: 4px;
    border-radius: 2px;
    background: var(--surface-3);
  }

  input::-webkit-slider-thumb {
    width: var(--thumb);
    height: var(--thumb);
    margin-top: calc(2px - var(--thumb) / 2);
    border: 2px solid var(--accent);
    border-radius: 50%;
    background: var(--bg);
    appearance: none;
  }

  input::-moz-range-thumb {
    box-sizing: border-box;
    width: var(--thumb);
    height: var(--thumb);
    border: 2px solid var(--accent);
    border-radius: 50%;
    background: var(--bg);
  }

  input:focus-visible::-webkit-slider-thumb {
    box-shadow: var(--focus);
  }

  input:focus-visible::-moz-range-thumb {
    box-shadow: var(--focus);
  }

  .ticks {
    position: absolute;
    inset-inline: calc(var(--thumb) / 2);
    bottom: 2px;
    height: 6px;
    pointer-events: none;
  }

  .ticks span {
    position: absolute;
    left: calc(var(--at) * 100%);
    width: 1px;
    height: 100%;
    background: var(--fg-muted);
  }

  .counter {
    min-width: 7ch;
    color: var(--fg-muted);
    font-size: 0.875rem;
  }

  @media (forced-colors: active) {
    input:focus-visible {
      outline: 2px solid Highlight;
    }

    input::-webkit-slider-thumb {
      border-color: Highlight;
    }

    input::-moz-range-thumb {
      border-color: Highlight;
    }
  }
</style>
