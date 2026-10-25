<script lang="ts">
  /**
   * Tokenizer picker (05 §6): a modal `<dialog>` holding a listbox grouped by lab in the brief's order (OpenAI, Anthropic,
   * Google, Meta, xAI), secondary tokenizers under "More from <lab>". Each option shows name, vocabulary size, wire size
   * (from the client's `assets`, 04 §6) or "downloaded" (a `cache.keys()` probe each time the dialog opens), the fidelity
   * badge and the licence tag; the Anthropic option carries the "not the Claude 3+ tokenizer" label. Covered models with
   * their badges and dated evidence are shown for the focused option in the details panel beside the list (interactive
   * content is not allowed inside options). Keys: ↑/↓, Home/End, typeahead, Enter/Space selects, Esc closes.
   */
  import type { AssetSummary, TokenizerId } from '@tsbs/core';
  import type { Lab, TokenizerEntry } from '@tsbs/registry';
  import { appState } from '../app/context.ts';
  import { LICENCE_TAGS, MODELS, TOKENIZERS } from '../app/registry.ts';
  import { i18n } from '../i18n/locale.svelte.ts';
  import { formatSize } from '../i18n/t.ts';
  import { cachedTokenizers, cachedVocabUrls } from './cache-probe.ts';
  import Dialog from './Dialog.svelte';
  import FidelityBadge from './FidelityBadge.svelte';
  import Icon from './Icon.svelte';

  interface Props {
    open: boolean;
    assets: AssetSummary | null;
    onclose: () => void;
    onlivecheck: () => void;
  }
  let { open, assets, onclose, onlivecheck }: Props = $props();
  const app = appState();

  const LABS: readonly Lab[] = ['openai', 'anthropic', 'google', 'meta', 'xai'];
  const LAB_KEY = {
    openai: 'lab.openai',
    anthropic: 'lab.anthropic',
    google: 'lab.google',
    meta: 'lab.meta',
    xai: 'lab.xai',
  } as const;

  interface Group {
    readonly id: string;
    readonly label: string;
    readonly entries: readonly TokenizerEntry[];
  }

  const visible = TOKENIZERS.filter((entry) => entry.withdrawn !== true);
  const groups = $derived<Group[]>(
    LABS.flatMap((lab) => {
      const name = i18n.t(LAB_KEY[lab]);
      const primary = visible.filter((entry) => entry.lab === lab && entry.tier === 'primary');
      const secondary = visible.filter((entry) => entry.lab === lab && entry.tier === 'secondary');
      const out: Group[] = [];
      if (primary.length > 0) out.push({ id: `${lab}-primary`, label: name, entries: primary });
      if (secondary.length > 0)
        out.push({ id: `${lab}-more`, label: i18n.t('picker.more', { lab: name }), entries: secondary });
      return out;
    }),
  );
  const order = $derived(groups.flatMap((group) => group.entries.map((entry) => entry.id)));

  let active: TokenizerId = $state(app.tokenizer);
  let downloaded: ReadonlySet<TokenizerId> = $state(new Set());
  let listbox: HTMLDivElement | undefined = $state();
  let typed = '';
  let typedAt = 0;

  const activeEntry = $derived(visible.find((entry) => entry.id === active) ?? app.entry);
  const activeModels = $derived(MODELS.filter((row) => row.tokenizer === active));

  $effect(() => {
    if (!open) return;
    active = app.tokenizer;
    void cachedVocabUrls().then((urls) => {
      downloaded = urls === null ? new Set() : cachedTokenizers(urls, order);
    });
  });

  function optionEl(id: TokenizerId): HTMLElement | null {
    return listbox?.querySelector<HTMLElement>(`[data-id="${id}"]`) ?? null;
  }

  function focusOption(id: TokenizerId): void {
    active = id;
    optionEl(id)?.focus();
  }

  function choose(id: TokenizerId): void {
    onclose();
    void app.selectTokenizer(id);
  }

  function onKeydown(event: KeyboardEvent): void {
    const index = order.indexOf(active);
    const move = (to: number): void => {
      event.preventDefault();
      const id = order[Math.max(0, Math.min(order.length - 1, to))];
      if (id !== undefined) focusOption(id);
    };
    switch (event.key) {
      case 'ArrowDown':
        move(index + 1);
        return;
      case 'ArrowUp':
        move(index - 1);
        return;
      case 'Home':
        move(0);
        return;
      case 'End':
        move(order.length - 1);
        return;
      case 'Enter':
      case ' ':
        event.preventDefault();
        choose(active);
        return;
      default:
        break;
    }
    if (event.key.length === 1 && !event.ctrlKey && !event.metaKey && !event.altKey) {
      // Typeahead: accumulate keys typed within 600 ms and focus the next matching name.
      const now = performance.now();
      typed = now - typedAt > 600 ? event.key.toLowerCase() : typed + event.key.toLowerCase();
      typedAt = now;
      const names = order.map((id) => visible.find((entry) => entry.id === id)?.displayName[i18n.current] ?? id);
      const start = typed.length > 1 ? index : index + 1;
      for (let i = 0; i < order.length; i++) {
        const at = (start + i) % order.length;
        if ((names[at] ?? '').toLowerCase().startsWith(typed)) {
          move(at);
          return;
        }
      }
    }
  }

  function sizeLabel(id: TokenizerId): string | null {
    if (downloaded.has(id)) return i18n.t('picker.downloaded');
    const size = assets?.[id].bytesCompressed;
    return size === undefined ? null : i18n.t('picker.wire', { size: formatSize(size, i18n.current) });
  }

  const dateFormat = $derived(new Intl.DateTimeFormat(i18n.current, { dateStyle: 'medium', timeZone: 'UTC' }));
</script>

<Dialog {open} labelledby="picker-title" {onclose} wide initialFocus={() => optionEl(app.tokenizer)}>
  <div class="head">
    <h2 id="picker-title">{i18n.t('picker.title')}</h2>
    <button type="button" class="btn btn-icon btn-quiet" aria-label={i18n.t('picker.close')} onclick={onclose}>
      <Icon name="close" />
    </button>
  </div>
  <p class="prose hint">{i18n.t('picker.description')}</p>
  <div class="body">
    <div
      class="listbox"
      role="listbox"
      aria-labelledby="picker-title"
      bind:this={listbox}
      onkeydown={onKeydown}
      tabindex="-1"
    >
      {#each groups as group (group.id)}
        <div role="group" aria-label={group.label} class="group">
          <div class="group-label" aria-hidden="true">{group.label}</div>
          {#each group.entries as entry (entry.id)}
            {@const size = sizeLabel(entry.id)}
            <!-- svelte-ignore a11y_click_events_have_key_events (keys are handled on the listbox: ↑/↓, Enter, Space) -->
            <div
              role="option"
              class="option"
              data-id={entry.id}
              aria-selected={entry.id === app.tokenizer}
              tabindex={entry.id === active ? 0 : -1}
              onclick={() => {
                choose(entry.id);
              }}
              onfocus={() => {
                active = entry.id;
              }}
            >
              <span class="option-head">
                <span class="option-name">{entry.displayName[i18n.current]}</span>
                {#if entry.id === app.tokenizer}<Icon name="check" size={16} />{/if}
              </span>
              <span class="option-meta">
                <FidelityBadge fidelity={entry.fidelity} />
                <span class="control-label">{i18n.t('picker.vocab', { n: entry.vocabSize })}</span>
                {#if size !== null}
                  <span class="control-label">
                    {#if downloaded.has(entry.id)}<Icon name="check" size={14} />{/if}{size}
                  </span>
                {/if}
                <span class="control-label"
                  >{i18n.t('picker.licence', { licence: LICENCE_TAGS[entry.licence] ?? entry.licence })}</span
                >
              </span>
              {#if entry.lab === 'anthropic'}
                <span class="warning prose">{i18n.t('picker.notClaude3')}</span>
              {/if}
            </div>
          {/each}
        </div>
      {/each}
    </div>
    <section class="details" aria-labelledby="picker-details-heading">
      <h3 id="picker-details-heading">{i18n.t('picker.details', { name: activeEntry.displayName[i18n.current] })}</h3>
      <p class="prose">{activeEntry.fidelityNote[i18n.current]}</p>
      <h4>{i18n.t('picker.covers')}</h4>
      <ul class="models">
        {#each activeModels as row (row.model)}
          <li>
            <span class="model" lang="en">{row.model}</span>
            <FidelityBadge fidelity={row.fidelity} />
            <span class="evidence">
              <a href={row.evidenceUrl} rel="noopener noreferrer" target="_blank">{i18n.t('picker.evidence')}</a>
              · {i18n.t('picker.checkedOn', { date: dateFormat.format(new Date(row.checkedOn)) })}
            </span>
          </li>
        {/each}
      </ul>
    </section>
  </div>
  <div class="live">
    <button
      type="button"
      class="btn"
      onclick={() => {
        onclose();
        onlivecheck();
      }}
    >
      {i18n.t('picker.claude3')}
    </button>
    <p class="prose hint">{i18n.t('picker.claude3Hint')}</p>
  </div>
</Dialog>

<style>
  .head {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 0.5rem;
  }

  h2 {
    margin: 0;
    font-size: 1.25rem;
  }

  h3 {
    margin: 0 0 0.25rem;
    font-size: 1rem;
  }

  h4 {
    margin: 0.75rem 0 0.25rem;
    font-size: 0.875rem;
    color: var(--fg-muted);
  }

  .hint {
    margin: 0.25rem 0 0.75rem;
    color: var(--fg-muted);
    font-size: 0.875rem;
  }

  .body {
    display: grid;
    gap: 1rem;
  }

  @media (min-width: 768px) {
    .body {
      grid-template-columns: minmax(0, 3fr) minmax(0, 2fr);
    }
  }

  .listbox {
    display: grid;
    gap: 0.75rem;
  }

  .group {
    display: grid;
    gap: 0.25rem;
  }

  .group-label {
    color: var(--fg-muted);
    font-size: 0.8125rem;
    font-weight: 600;
  }

  .option {
    display: grid;
    gap: 0.25rem;
    padding: 0.5rem 0.625rem;
    border: var(--border-width) solid var(--border);
    border-radius: var(--radius);
    background: var(--surface);
    cursor: pointer;
  }

  .option:hover {
    background: var(--surface-2);
  }

  .option[aria-selected='true'] {
    border-color: var(--accent);
    box-shadow: inset 0 0 0 1px var(--accent);
  }

  .option:focus-visible {
    box-shadow: var(--focus);
  }

  .option-head {
    display: flex;
    align-items: center;
    gap: 0.375rem;
    font-weight: 600;
  }

  .option-meta {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 0.25rem 0.75rem;
    color: var(--fg-muted);
    font-size: 0.8125rem;
  }

  .warning {
    color: var(--fg);
    font-size: 0.8125rem;
    font-weight: 600;
    text-decoration: underline wavy var(--tok-h0);
  }

  .details {
    padding: 0.75rem;
    border: var(--border-width) solid var(--border);
    border-radius: var(--radius);
    background: var(--surface);
    align-self: start;
  }

  .models {
    margin: 0;
    padding: 0;
    list-style: none;
    display: grid;
    gap: 0.5rem;
  }

  .models li {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 0.25rem 0.5rem;
  }

  .model {
    font-weight: 600;
  }

  .evidence {
    color: var(--fg-muted);
    font-size: 0.8125rem;
  }

  .live {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 0.25rem 0.75rem;
    margin-top: 1rem;
  }

  .live .hint {
    margin: 0;
    flex: 1 1 16rem;
  }
</style>
