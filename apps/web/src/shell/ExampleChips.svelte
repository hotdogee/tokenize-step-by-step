<script lang="ts">
  /**
   * Example chips (05 §6, AD-16, AD-38): the registry's chips as one horizontal `listbox` (one tab stop, ←/→ roving focus,
   * Home/End, Enter/Space/click applies). Labels never truncate — the row scrolls (`touch-action: pan-x`). Each chip carries
   * the `lang` of its resolved text language; a chip whose precomputed result splits a character on the selected tokenizer
   * shows the SVG hatch mark with visually hidden text.
   */
  import { appState } from '../app/context.ts';
  import { exampleWhy } from '../app/example-why.svelte.ts';
  import { CHIP_SPLITS, EXAMPLES, type SiteExampleChip as ExampleChip } from '../app/registry.ts';
  import { i18n } from '../i18n/locale.svelte.ts';
  import { resolveTextLang } from '../i18n/text-lang.ts';
  import Icon from './Icon.svelte';

  const app = appState();
  let list: HTMLDivElement | undefined = $state();

  const selectedIndex = $derived(EXAMPLES.findIndex((chip) => chip.text === app.text));
  let focusIndex = $state(0);
  const tabIndexOf = $derived(selectedIndex === -1 ? focusIndex : selectedIndex);
  const splits = $derived(new Set(CHIP_SPLITS[app.tokenizer]));
  const selected = $derived(selectedIndex === -1 ? null : (EXAMPLES[selectedIndex] ?? null));

  function chipLang(chip: ExampleChip): string | undefined {
    // A localized label is in the UI language; only a chip that shows its own text takes the text's language.
    return chip.label === undefined ? resolveTextLang(chip.lang, chip.text, i18n.current) : undefined;
  }

  /** Chip text on one line: segments between line breaks; each break shows the ⏎ stand-in (05 §4). */
  function chipLines(chip: ExampleChip): string[] {
    return chip.label === undefined ? chip.text.split(/\r?\n/) : [chip.label[i18n.current]];
  }

  function focusChip(index: number): void {
    const count = EXAMPLES.length;
    focusIndex = (index + count) % count;
    const el = list?.querySelectorAll<HTMLElement>('[role="option"]')[focusIndex];
    el?.focus();
    el?.scrollIntoView({ block: 'nearest', inline: 'nearest' });
  }

  function onKeydown(event: KeyboardEvent, index: number): void {
    switch (event.key) {
      case 'ArrowRight':
        event.preventDefault();
        focusChip(index + 1);
        break;
      case 'ArrowLeft':
        event.preventDefault();
        focusChip(index - 1);
        break;
      case 'Home':
        event.preventDefault();
        focusChip(0);
        break;
      case 'End':
        event.preventDefault();
        focusChip(EXAMPLES.length - 1);
        break;
      case 'Enter':
      case ' ': {
        event.preventDefault();
        const chip = EXAMPLES[index];
        if (chip !== undefined) app.chooseExample(chip);
        break;
      }
      default:
        break;
    }
  }
</script>

<div class="examples">
  <span id="examples-label" class="label">{i18n.t('examples.label')}</span>
  <div
    class="chips"
    role="listbox"
    aria-labelledby="examples-label"
    aria-orientation="horizontal"
    bind:this={list}
    data-testid="example-chips"
  >
    {#each EXAMPLES as chip, index (chip.key)}
      <div
        role="option"
        class="chip control-label"
        aria-selected={index === selectedIndex}
        tabindex={index === tabIndexOf ? 0 : -1}
        lang={chipLang(chip)}
        data-key={chip.key}
        onclick={() => {
          focusIndex = index;
          app.chooseExample(chip);
        }}
        onkeydown={(event) => {
          onKeydown(event, index);
        }}
        onfocus={() => {
          focusIndex = index;
        }}
      >
        <span class="text"
          >{#each chipLines(chip) as line, i (i)}{#if i > 0}<span class="standin" aria-hidden="true">⏎</span
              >{/if}{line}{/each}</span
        >
        {#if splits.has(chip.key)}
          <Icon name="hatch" size={14} />
          <span class="visually-hidden" lang={i18n.current}>({i18n.t('a11y.chipSplits')})</span>
        {/if}
      </div>
    {/each}
  </div>
  {#if selected !== null}
    <p class="why prose">{exampleWhy.text(selected, i18n.current)}</p>
  {/if}
</div>

<style>
  .examples {
    min-width: 0;
  }

  .label {
    display: block;
    margin-bottom: 0.25rem;
    color: var(--fg-muted);
    font-size: 0.875rem;
  }

  .chips {
    display: flex;
    gap: 0.375rem;
    overflow-x: auto;
    overscroll-behavior-x: contain;
    touch-action: pan-x;
    padding: 4px;
    margin: -4px;
    scrollbar-width: thin;
  }

  .chip {
    position: relative; /* contains the visually hidden label, which would otherwise escape the scrolling row */
    flex: none;
    display: inline-flex;
    align-items: center;
    gap: 0.25rem;
    min-height: 2.5rem;
    padding: 0.25rem 0.75rem;
    border: var(--border-width) solid var(--border);
    border-radius: 999px;
    background: var(--surface);
    cursor: pointer;
  }

  .chip:hover {
    background: var(--surface-2);
  }

  .chip[aria-selected='true'] {
    border-color: var(--accent);
    background: var(--surface-2);
    box-shadow: inset 0 0 0 1px var(--accent);
  }

  .chip:focus-visible {
    box-shadow: var(--focus);
  }

  .text {
    white-space: pre;
  }

  .standin {
    color: var(--fg-muted);
    font-family: var(--font-standin);
  }

  .why {
    margin: 0.25rem 0 0;
    color: var(--fg-muted);
    font-size: 0.875rem;
  }
</style>
