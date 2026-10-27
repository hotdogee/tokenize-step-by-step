<script lang="ts">
  /**
   * The Examples menu (PA-19, 05 §6; AD-16): a menu button ("Examples" + chevron) that opens a panel of the registry's
   * examples, grouped (繁體中文 / 日本語 / English / Mixed and emoji, `example-groups.ts`) as `role="group"`s of
   * `menuitemradio`s — each the example's text on one line (a long one shows its label) with its "why" sentence under it
   * in small muted type (loaded lazily, `exampleWhy`). Choosing one applies its text (the text language is left as it is)
   * and closes the menu; ↑/↓ (wrapping), Home and End move inside it; Esc, a press outside and Tab out close it, Esc and a
   * choice returning focus to the button. Beside the button: the text-language note; under it, `p.why` with the selected
   * example's sentence (PA-18's LCP element, unchanged markup).
   *
   * A press inside the panel never moves focus (`mousedown` is cancelled), as in ChoiceMenu: WebKit blurs the focused item
   * with no `relatedTarget` on a press, which would close the panel before the click lands.
   */
  import { tick } from 'svelte';
  import { appState } from '../app/context.ts';
  import { exampleWhy } from '../app/example-why.svelte.ts';
  import { EXAMPLES, type SiteExampleChip as ExampleChip } from '../app/registry.ts';
  import { i18n } from '../i18n/locale.svelte.ts';
  import { resolveTextLang } from '../i18n/text-lang.ts';
  import { groupChips } from './example-groups.ts';
  import Icon from './Icon.svelte';

  const app = appState();
  const GROUP_LABEL = {
    zhHant: 'examples.group.zhHant',
    ja: 'examples.group.ja',
    en: 'examples.group.en',
    mixed: 'examples.group.mixed',
  } as const;
  const TEXT_LANG_LABEL = {
    auto: 'textLang.auto',
    'zh-Hant': 'textLang.zh-Hant',
    ja: 'textLang.ja',
    en: 'textLang.en',
  } as const;
  const GROUPS = groupChips(EXAMPLES);

  let open = $state(false);
  let root: HTMLDivElement | undefined = $state();
  let button: HTMLButtonElement | undefined = $state();
  let panel: HTMLDivElement | undefined = $state();

  const selected = $derived(EXAMPLES.find((chip) => chip.text === app.text) ?? null);

  function chipLang(chip: ExampleChip): string | undefined {
    // A localized label is in the UI language; only an item that shows its own text takes the text's language.
    return chip.label === undefined ? resolveTextLang(chip.lang, chip.text, i18n.current) : undefined;
  }

  /** The example's text on one line: segments between line breaks; each break shows the ⏎ stand-in (05 §4). */
  function chipLines(chip: ExampleChip): string[] {
    return chip.label === undefined ? chip.text.split(/\r?\n/) : [chip.label[i18n.current]];
  }

  function items(): HTMLElement[] {
    return [...(panel?.querySelectorAll<HTMLElement>('[role="menuitemradio"]') ?? [])];
  }

  function focusItem(index: number): void {
    const list = items();
    if (list.length === 0) return;
    const item = list[(index + list.length) % list.length];
    item?.focus();
    item?.scrollIntoView({ block: 'nearest' });
  }

  async function show(at: 'checked' | 'first' | 'last'): Promise<void> {
    open = true;
    await tick();
    const list = items();
    const checked = list.findIndex((item) => item.getAttribute('aria-checked') === 'true');
    focusItem(at === 'last' ? list.length - 1 : at === 'checked' && checked >= 0 ? checked : 0);
  }

  function close(returnFocus: boolean): void {
    open = false;
    if (returnFocus) button?.focus();
  }

  function choose(chip: ExampleChip): void {
    app.chooseExample(chip);
    close(true);
  }

  function onButtonKeydown(event: KeyboardEvent): void {
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      event.preventDefault();
      void show(event.key === 'ArrowUp' ? 'last' : 'checked');
    }
  }

  function onPanelKeydown(event: KeyboardEvent): void {
    const list = items();
    const index = list.indexOf(document.activeElement as HTMLElement);
    switch (event.key) {
      case 'ArrowDown':
        event.preventDefault();
        focusItem(index + 1);
        break;
      case 'ArrowUp':
        event.preventDefault();
        focusItem(index - 1);
        break;
      case 'Home':
        event.preventDefault();
        focusItem(0);
        break;
      case 'End':
        event.preventDefault();
        focusItem(list.length - 1);
        break;
      case 'Escape':
        event.preventDefault();
        event.stopPropagation();
        close(true);
        break;
      default:
        break;
    }
  }

  function onFocusOut(event: FocusEvent): void {
    if (open && !(event.relatedTarget instanceof Node && root?.contains(event.relatedTarget) === true)) close(false);
  }

  function onWindowPointer(event: PointerEvent): void {
    if (open && !(event.target instanceof Node && root?.contains(event.target) === true)) close(false);
  }
</script>

<svelte:window onpointerdown={onWindowPointer} />

<div class="examples">
  <div class="tools">
    <div class="menu" bind:this={root} onfocusout={onFocusOut} role="presentation">
      <button
        bind:this={button}
        type="button"
        id="examples-button"
        class="btn trigger"
        aria-haspopup="menu"
        aria-expanded={open}
        aria-controls="examples-menu"
        data-testid="examples-button"
        onclick={() => {
          if (open) close(false);
          else void show('checked');
        }}
        onkeydown={onButtonKeydown}
      >
        <span class="control-label">{i18n.t('examples.label')}</span>
        <Icon name="chevron" size={16} />
      </button>
      <div
        id="examples-menu"
        class="panel"
        role="menu"
        aria-labelledby="examples-button"
        tabindex="-1"
        hidden={!open}
        bind:this={panel}
        onkeydown={onPanelKeydown}
        onmousedown={(event) => {
          event.preventDefault();
        }}
        data-testid="examples-menu"
      >
        {#each GROUPS as { group, chips } (group)}
          <div class="group" role="group" aria-labelledby={`examples-group-${group}`}>
            <div class="group-title" id={`examples-group-${group}`} aria-hidden="true">
              {i18n.t(GROUP_LABEL[group])}
            </div>
            {#each chips as chip (chip.key)}
              <button
                type="button"
                class="item"
                role="menuitemradio"
                aria-checked={chip === selected}
                tabindex="-1"
                data-key={chip.key}
                onclick={(event) => {
                  event.currentTarget.focus(); // the press moved no focus (see above)
                  choose(chip);
                }}
              >
                <span class="text" lang={chipLang(chip)}
                  >{#each chipLines(chip) as line, i (i)}{#if i > 0}<span class="standin" aria-hidden="true">⏎</span
                      >{/if}{line}{/each}</span
                >
                {#if open}<span class="why prose">{exampleWhy.text(chip, i18n.current)}</span>{/if}
              </button>
            {/each}
          </div>
        {/each}
      </div>
    </div>
    <span class="lang-note control-label" data-testid="text-lang-note"
      >{i18n.t('textLang.label')}: <b>{i18n.t(TEXT_LANG_LABEL[app.textLang])}</b></span
    >
  </div>
  {#if selected !== null}
    <p class="why prose">{exampleWhy.text(selected, i18n.current)}</p>
  {/if}
</div>

<style>
  .examples {
    min-width: 0;
  }

  .tools {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 0.5rem 1rem;
  }

  .menu {
    position: relative;
  }

  .trigger {
    gap: 0.375rem;
  }

  .trigger[aria-expanded='true'] :global(svg) {
    transform: rotate(180deg);
  }

  .panel {
    position: absolute;
    z-index: 15;
    inset-inline-start: 0;
    top: calc(100% + 0.25rem);
    display: grid;
    gap: 0.25rem;
    width: max-content;
    min-width: min(18rem, calc(100vw - 2 * var(--gutter)));
    max-width: min(30rem, calc(100vw - 2 * var(--gutter)));
    max-height: min(32rem, 60vh);
    overflow: auto;
    overscroll-behavior: contain;
    padding: 0.375rem;
    border: var(--border-width) solid var(--border);
    border-radius: calc(var(--radius) * 2);
    background: var(--bg);
    box-shadow: 0 6px 24px rgb(0 0 0 / 0.18);
  }

  .panel[hidden] {
    display: none;
  }

  .group {
    display: grid;
  }

  .group-title {
    padding: 0.5rem 0.625rem 0.25rem;
    color: var(--fg-muted);
    font-size: 0.75rem;
    font-weight: 700;
    letter-spacing: 0.06em;
  }

  .item {
    display: grid;
    gap: 0.125rem;
    min-height: 2.5rem;
    padding: 0.375rem 0.625rem 0.375rem 1.75rem;
    border: 0;
    border-radius: var(--radius);
    background: transparent;
    color: var(--fg);
    font: inherit;
    text-align: start;
    cursor: pointer;
    position: relative;
  }

  .item:hover,
  .item:focus-visible {
    background: var(--surface-2);
  }

  /* The checked item: a check mark drawn with borders (kept by forced colours) and a tinted background. */
  .item[aria-checked='true'] {
    background: var(--surface);
  }

  .item[aria-checked='true']::before {
    content: '';
    position: absolute;
    inset-inline-start: 0.7rem;
    top: 0.85rem;
    width: 0.35rem;
    height: 0.65rem;
    border-right: 2px solid var(--accent);
    border-bottom: 2px solid var(--accent);
    transform: rotate(45deg);
  }

  .text {
    overflow: hidden;
    text-overflow: clip;
    white-space: pre;
  }

  .standin {
    color: var(--fg-muted);
    font-family: var(--font-standin);
  }

  .item .why {
    color: var(--fg-muted);
    font-size: 0.8125rem;
    white-space: normal;
  }

  .lang-note {
    color: var(--fg-muted);
    font-size: 0.875rem;
  }

  .lang-note b {
    color: var(--fg);
    font-weight: 600;
  }

  p.why {
    margin: 0.25rem 0 0;
    color: var(--fg-muted);
    font-size: 0.875rem;
  }
</style>
