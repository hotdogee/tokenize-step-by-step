<script lang="ts">
  /**
   * The inspector panel (05 §5, AD-34): one `role="region"` labelled by its heading ("Inspector — token 2 of 5") in every
   * surface — never a tooltip or dialog, never modal. Sections Token / Character / Byte / Step (Chunk for a chunk cell) as
   * definition lists with a copy button per value, the explanatory sentences, "show this step" and "select in text".
   * Esc returns focus to the originating cell (the host's `onescape`); the pointer hovering the panel keeps hover content
   * open (WCAG 1.4.13).
   */
  import { i18n } from '../i18n/locale.svelte.ts';
  import BoardIcon from '../board/BoardIcon.svelte';
  import type { InspectorModel } from './model.ts';

  interface Props {
    model: InspectorModel | null;
    pinned: boolean;
    /** Collapsed bottom sheet: heading and summary only. */
    collapsed: boolean;
    panel?: HTMLElement | undefined;
    oncopy: (value: string) => void;
    onunpin: () => void;
    onshowstep: (step: number) => void;
    onselect: (range: readonly [number, number]) => void;
    onescape: () => void;
    onhover: (inside: boolean) => void;
  }
  let {
    model,
    pinned,
    collapsed,
    panel = $bindable(),
    oncopy,
    onunpin,
    onshowstep,
    onselect,
    onescape,
    onhover,
  }: Props = $props();

  function onKeydown(event: KeyboardEvent): void {
    if (event.key !== 'Escape') return;
    event.preventDefault();
    event.stopPropagation();
    onescape();
  }
</script>

<!-- svelte-ignore a11y_no_noninteractive_element_interactions (Esc returns focus to the cell; hovering keeps hover content open, WCAG 1.4.13) -->
<div
  id="inspector-panel"
  class="panel"
  role="region"
  aria-labelledby="inspector-heading"
  tabindex="-1"
  data-testid="inspector"
  bind:this={panel}
  onkeydown={onKeydown}
  onpointerenter={() => {
    onhover(true);
  }}
  onpointerleave={() => {
    onhover(false);
  }}
>
  <div class="head">
    <h3 id="inspector-heading" class="heading">{model?.heading ?? i18n.t('inspector.heading')}</h3>
    {#if pinned}
      <span class="badge control-label">{i18n.t('inspector.pinnedBadge')}</span>
      {#if !collapsed}
        <button type="button" class="btn btn-quiet unpin" onclick={onunpin}>
          <BoardIcon name="pin" size={14} /><span class="control-label">{i18n.t('inspector.unpin')}</span>
        </button>
      {/if}
    {/if}
  </div>
  {#if model === null}
    <p class="prose empty">{i18n.t('inspector.empty')}</p>
  {:else}
    <p class="summary mono" lang={model.lang}>{model.summary}</p>
    <div class="sections" hidden={collapsed}>
      {#each model.sections as section, s (`${section.kind}:${String(s)}`)}
        <div class="section" data-section={section.kind}>
          <h4 class="section-title">{section.title}</h4>
          <dl>
            {#each section.fields as entry (entry.key)}
              <div class="field">
                <dt>{entry.label}</dt>
                <dd>
                  <span
                    class="value"
                    class:mono={entry.mono}
                    class:glyph={entry.glyph === true}
                    lang={entry.glyph === true ? model.lang : undefined}>{entry.value}</span
                  >{#if entry.note !== undefined}<span class="visually-hidden">{entry.note}</span>{/if}
                  {#if entry.copy}
                    <button
                      type="button"
                      class="copy"
                      aria-label={entry.copyLabel}
                      onclick={() => {
                        oncopy(entry.value);
                      }}><BoardIcon name="copy" size={14} /></button
                    >
                  {/if}
                </dd>
              </div>
            {/each}
          </dl>
          {#each section.notes as note, n (n)}
            <p class="prose note" lang={model.lang}>{note}</p>
          {/each}
          {#if section.step !== null && section.kind !== 'char'}
            {@const step = section.step}
            <button
              type="button"
              class="btn action"
              onclick={() => {
                onshowstep(step);
              }}>{model.actions.showStep}</button
            >
          {/if}
        </div>
      {/each}
      {#if model.select !== null}
        {@const range = model.select}
        <button
          type="button"
          class="btn action"
          onclick={() => {
            onselect(range);
          }}>{model.actions.selectInText}</button
        >
      {/if}
    </div>
  {/if}
</div>

<style>
  .panel {
    display: grid;
    gap: 0.5rem;
    min-width: 0;
    outline: none;
  }

  .panel:focus-visible {
    box-shadow: var(--focus);
  }

  .head {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 0.25rem 0.5rem;
  }

  .heading {
    flex: 1 1 12rem;
    margin: 0;
    font-size: 0.9375rem;
    line-break: strict;
    overflow-wrap: anywhere;
  }

  .badge {
    padding: 0.125rem 0.375rem;
    border: var(--border-width) solid var(--fg);
    border-radius: 999px;
    font-size: 0.75rem;
  }

  .unpin {
    min-height: 2rem;
    padding-block: 0.125rem;
  }

  .empty,
  .summary,
  .note {
    margin: 0;
    font-size: 0.875rem;
  }

  .summary {
    color: var(--fg);
    overflow-wrap: anywhere;
  }

  .sections {
    display: grid;
    gap: 0.75rem;
  }

  .section {
    display: grid;
    gap: 0.375rem;
    padding-top: 0.5rem;
    border-top: var(--border-width) solid var(--border);
  }

  .section-title {
    margin: 0;
    font-size: 0.8125rem;
    color: var(--fg-muted);
  }

  dl {
    display: grid;
    gap: 0.125rem;
    margin: 0;
  }

  .field {
    display: grid;
    grid-template-columns: minmax(5.5rem, max-content) minmax(0, 1fr);
    align-items: center;
    gap: 0.5rem;
  }

  dt {
    font-size: 0.8125rem;
    color: var(--fg-muted);
  }

  dd {
    display: flex;
    align-items: center;
    gap: 0.25rem;
    min-width: 0;
    margin: 0;
  }

  .value {
    min-width: 0;
    overflow-wrap: anywhere;
    font-size: 0.875rem;
  }

  .value.glyph {
    font-size: 2rem;
    line-height: 1.1;
  }

  .copy {
    display: inline-grid;
    flex: none;
    place-items: center;
    width: 2rem;
    height: 2rem;
    padding: 0;
    border: var(--border-width) solid transparent;
    border-radius: var(--radius);
    background: transparent;
    color: var(--fg);
    cursor: pointer;
  }

  .copy:hover {
    border-color: var(--border);
  }

  .action {
    justify-self: start;
    min-height: 2.25rem;
  }

  @media (pointer: coarse) {
    .copy {
      width: 2.75rem;
      height: 2.75rem;
    }
  }
</style>
