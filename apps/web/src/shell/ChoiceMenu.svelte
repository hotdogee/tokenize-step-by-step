<script lang="ts">
  /**
   * Icon-only header button that discloses a small panel of native radio buttons (the UI-language menu 文/A and the theme
   * toggle, 05 §3.5). Native radios give arrow-key selection for free; the choice applies immediately. Esc closes the
   * panel and returns focus to the button; so does a click outside or Tab leaving the panel.
   *
   * A press inside the menu never moves focus (`mousedown` is cancelled): WebKit does not focus a radio or button on
   * mousedown but blurs the focused radio with no `relatedTarget`, and after a tap it fires that compatibility mousedown
   * only after `pointerup`, so the blur would close the panel before the click selects the choice. The click still lands
   * and moves focus itself: the clicked radio takes it, and the button takes it back when it closes the panel.
   */
  import Icon from './Icon.svelte';
  import type { IconName } from './icons.ts';

  interface Choice {
    readonly value: string;
    readonly label: string;
    readonly lang?: string;
  }
  interface Props {
    id: string;
    /** Accessible name of the icon-only button (catalog `a11y.*`). */
    label: string;
    icon: IconName;
    choices: readonly Choice[];
    value: string;
    onchange: (value: string) => void;
  }
  let { id, label, icon, choices, value, onchange }: Props = $props();

  let open = $state(false);
  let root: HTMLDivElement | undefined = $state();
  let button: HTMLButtonElement | undefined = $state();

  function close(returnFocus: boolean): void {
    open = false;
    if (returnFocus) button?.focus();
  }

  function onKeydown(event: KeyboardEvent): void {
    if (event.key === 'Escape' && open) {
      event.stopPropagation();
      close(true);
    }
  }

  function onFocusOut(event: FocusEvent): void {
    if (open && !(event.relatedTarget instanceof Node && root?.contains(event.relatedTarget) === true)) close(false);
  }

  function onWindowPointer(event: PointerEvent): void {
    if (open && !(event.target instanceof Node && root?.contains(event.target) === true)) close(false);
  }

  function toggle(): void {
    open = !open;
    if (open) queueMicrotask(() => root?.querySelector<HTMLInputElement>('input:checked')?.focus());
    else button?.focus();
  }
</script>

<svelte:window onpointerdown={onWindowPointer} />

<div
  class="menu"
  bind:this={root}
  onkeydown={onKeydown}
  onfocusout={onFocusOut}
  onmousedown={(event) => {
    event.preventDefault();
  }}
  role="presentation"
>
  <button
    bind:this={button}
    type="button"
    class="btn btn-icon btn-quiet"
    aria-label={label}
    aria-expanded={open}
    aria-controls={`${id}-panel`}
    onclick={toggle}
  >
    <Icon name={icon} size={20} />
  </button>
  <div id={`${id}-panel`} class="panel" hidden={!open}>
    <fieldset>
      <legend>{label}</legend>
      {#each choices as choice (choice.value)}
        <label class="choice">
          <input
            type="radio"
            name={id}
            value={choice.value}
            checked={choice.value === value}
            onchange={() => {
              onchange(choice.value);
            }}
            onclick={(event) => {
              event.currentTarget.focus(); // the press moved no focus (see above); Esc and Tab-out need it here
            }}
          />
          <span class="control-label" lang={choice.lang}>{choice.label}</span>
        </label>
      {/each}
    </fieldset>
  </div>
</div>

<style>
  .menu {
    position: relative;
  }

  .panel {
    position: absolute;
    z-index: 20;
    inset-inline-end: 0;
    top: calc(100% + 0.25rem);
    min-width: 11rem;
    max-width: calc(100vw - 2 * var(--gutter));
    padding: 0.5rem;
    border: var(--border-width) solid var(--border);
    border-radius: var(--radius);
    background: var(--bg);
    box-shadow: 0 6px 24px rgb(0 0 0 / 0.18);
  }

  .panel[hidden] {
    display: none;
  }

  fieldset {
    margin: 0;
    padding: 0;
    border: 0;
  }

  legend {
    padding: 0 0.25rem 0.25rem;
    color: var(--fg-muted);
    font-size: 0.8125rem;
  }

  .choice {
    display: flex;
    align-items: center;
    gap: 0.5rem;
    min-height: 2.5rem;
    padding: 0 0.5rem;
    border-radius: var(--radius);
    cursor: pointer;
  }

  .choice:hover {
    background: var(--surface-2);
  }

  input {
    width: 1.125rem;
    height: 1.125rem;
    margin: 0;
    accent-color: var(--accent);
  }
</style>
