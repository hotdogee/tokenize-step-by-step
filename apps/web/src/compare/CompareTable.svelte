<script lang="ts">
  /**
   * The comparison table (PA-19, 05 §4): the default view of `/` — one row per lab, the lab's newest local tokenizer by
   * default (each row's select switches it), on one byte-column axis with the header box (the text's characters and
   * UTF-8 bytes). Edge to edge, never wrapped: three horizontal scrollers stay in step (scroll-sync.ts) — the header box,
   * pinned under the sticky app header while the page scrolls past the table; the rows, whose captions stay at the left
   * edge; and a scrollbar pinned to the bottom of the viewport until the table ends. Every scroller renders the same
   * column window (compare-window.ts: ≤ 128 columns around the visible ones, with hysteresis), placed with the generated
   * classes rebased to the window start; `--cmp-cols` / `--cmp-win` / `--cmp-start` are written only where they differ
   * from their defaults, so the static first paint (12 columns, no window) has no `style` attribute.
   *
   * ARIA: one `role="grid"` (`compare-grid`) owns the header rows and the chip rows through `aria-owns`; the captions,
   * with their selects, live outside the grid. One tab stop (roving tabindex on the chips; the OpenAI row's first chip by
   * default): ←/→ move along a row, ↑/↓ to the chip of the row above/below covering the same byte, Home/End to a row's
   * ends, PageUp/PageDown to the first/last row, Enter/Space opens Advanced on that row's tokenizer with the board's token
   * cell at that byte focused, Esc returns to the text box. A focus move mounts the chip first (the window follows it),
   * then scrolls it into view clear of the app header and the pinned boxes: the chips, the caption selects and buttons
   * keep `scroll-margin-block` of the header box's and the scrollbar box's heights (`--cmp-head-h` / `--cmp-foot-h`,
   * measured on the section all along), and a Tab or Shift+Tab that lands under either box scrolls it clear, which the
   * browser does not do for an element it counts as on screen (WCAG 2.4.11).
   *
   * The rows' results come from the result hub: this component holds every visible row's entry (`retain`/`release`, fixed
   * `ROW_OPTIONS`) and asks for it on every text change of a live tier, after the board's 40 ms debounce (the board's
   * request goes first, so a row on the board's tokenizer and options shares its traced request), on a row switch (which
   * also loads the new tokenizer, `ensureRows`) and after the board's on-demand run (`app.rowRun`, one row after another).
   * The hub answers from the precomputed examples while a row's tokenizer is not loaded, and loads it for free text.
   */
  import { onMount, tick, untrack } from 'svelte';
  import type { TokenizationResult, TokenizerId } from '@tsbs/core';
  import type { Lab } from '@tsbs/registry';
  import { ENCODE_DEBOUNCE_MS } from '../app/app-state.svelte.ts';
  import { appState } from '../app/context.ts';
  import { isOnDemand, longInputMode } from '../app/long-input.ts';
  import { ROW_OPTIONS } from '../app/result-hub.svelte.ts';
  import { i18n } from '../i18n/locale.svelte.ts';
  import { resolveTextLang } from '../i18n/text-lang.ts';
  import { hasLeadingMarker, headerText, tokenAtByte } from './compare-cells.ts';
  import CompareHeader from './CompareHeader.svelte';
  import CompareRow from './CompareRow.svelte';
  import { nextWindow, type ColumnWindow } from './compare-window.ts';
  import { rowState, runRows, type RowChoice } from './rows.svelte.ts';
  import { syncScroll, type ScrollSync } from './scroll-sync.ts';
  import '../board/grid-classes.css';
  import '../board/board.css';
  import './compare.css';

  const app = appState();

  // ---- data ----
  const text = $derived(app.analysed);
  const source = $derived(headerText(text));
  const lang = $derived(resolveTextLang(app.textLang, app.text, i18n.current));
  const byteViews: ReadonlyArray<'hex' | 'dec'> = $derived(app.byteView === 'both' ? ['hex', 'dec'] : [app.byteView]);
  const onDemand = $derived(isOnDemand(app.longInput));
  /** The on-demand run whose rows the table is asking for, one after another, until the last has answered. */
  let rowsRun: { readonly text: string } | null = $state.raw(null);

  const views = $derived(
    app.rows.labs.map((row) => {
      const choice = app.rows.choice(row.lab);
      const entry = app.rows.entryFor(row.lab);
      const hub = entry === null ? null : app.hub.entry(entry.id);
      const state = rowState({
        api: entry === null,
        result: hub?.result ?? null,
        text,
        loaded: entry !== null && app.hub.loaded(entry.id),
        loading: hub?.progress !== null && hub?.progress !== undefined,
        failed: hub?.error !== null && hub?.error !== undefined,
        onDemand,
        queued: rowsRun?.text === text,
      });
      const result = state === 'current' || state === 'stale' ? (hub?.result ?? null) : null;
      return { row, choice, entry, hub, state, result };
    }),
  );
  /** One marker column before byte 1 when a row starts with a zero-width token (Grok-1's dummy prefix). */
  const marker = $derived(views.some((view) => view.result !== null && hasLeadingMarker(view.result)) ? 1 : 0);
  const cols = $derived(source.utf8.length + marker);
  const chipRows = $derived(views.filter((view) => view.state !== 'api'));
  /**
   * The rows with chips, in order. A function, not a `$derived`: a derived read only through lazy props would keep its
   * last array — and the whole-text results in it — alive after the hub let them go (AD-27).
   */
  const navigable = (): typeof views => views.filter((view) => view.result !== null && view.result.tokens.count > 0);
  const owns = $derived(
    [
      'cmp-r-char',
      ...byteViews.map((view) => `cmp-r-${view}`),
      ...chipRows.map((view) => `cmp-row-${view.row.lab}`),
    ].join(' '),
  );

  // ---- the rows' hub entries ----
  /** The tokenizers whose entries this table holds (the hub keeps their results while held, AD-27). */
  // eslint-disable-next-line svelte/prefer-svelte-reactivity -- bookkeeping, never read by the template
  const held = new Set<TokenizerId>();
  $effect(() => {
    const ids = new Set(app.rows.visibleTokenizers());
    for (const id of ids) if (!held.has(id)) app.hub.retain(id);
    for (const id of [...held]) if (!ids.has(id)) app.hub.release(id);
    held.clear();
    for (const id of ids) held.add(id);
  });
  $effect(() => () => {
    for (const id of held) app.hub.release(id);
    held.clear();
  });

  /** Asks for every visible row's result of `text`. */
  function requestRows(text: string, ids: readonly TokenizerId[]): void {
    for (const id of ids) void app.hub.request(id, text, ROW_OPTIONS, { trace: false });
  }

  // Every text change of a live tier, after the board's debounce (none while an IME composition is open, 05 §6).
  $effect(() => {
    const text = app.analysed;
    const ids = app.rows.visibleTokenizers();
    if (isOnDemand(app.longInput) || app.composing) return;
    const timer = setTimeout(() => {
      requestRows(text, ids);
    }, ENCODE_DEBOUNCE_MS);
    return () => {
      clearTimeout(timer);
    };
  });

  // After the board's on-demand run: the rows on the same text, one after another (AD-27); a failed row never holds up
  // the next (its caption shows the error with its action). Until its turn a row is `queued`, no longer "press Tokenize
  // now".
  $effect(() => {
    const run = app.rowRun;
    if (run === null) return;
    rowsRun = run;
    void runRows(
      app.rows.visibleTokenizers(),
      run.text,
      (id, text) => app.hub.request(id, text, ROW_OPTIONS, { trace: false }),
      () => app.analysed === run.text,
    ).then(() => {
      if (rowsRun === run) rowsRun = null;
    });
  });

  // A whole-text result that no longer answers the text goes at once (AD-27, the 8 MiB rule per entry): in an on-demand
  // tier a row shows no chips until the run (rowState `onDemand`), and an on-demand run's result is never the "stale"
  // result of another text, so no previous run is held while the next one is in flight or next to a short text.
  $effect(() => {
    const text = app.analysed;
    const waiting = isOnDemand(app.longInput);
    for (const id of app.rows.visibleTokenizers()) {
      const result = app.hub.entry(id).result;
      if (
        result !== null &&
        result.input.text !== text &&
        (waiting || isOnDemand(longInputMode(result.input.codePoints)))
      )
        untrack(() => {
          app.hub.forget(id);
        });
    }
  });

  /** A row's select (PA-19 load policy b): the new tokenizer loads and answers the text at once. */
  function selectRow(lab: Lab, value: RowChoice): void {
    app.rows.select(lab, value);
    const id = app.rows.entryFor(lab)?.id;
    if (id === undefined) return;
    app.hub.ensureRows([id]);
    if (!isOnDemand(app.longInput)) requestRows(app.analysed, [id]);
  }

  // ---- measurements, scrolling and the column window ----
  let section: HTMLElement | undefined = $state();
  let thead: HTMLDivElement | undefined = $state();
  let tbody: HTMLDivElement | undefined = $state();
  let sbar: HTMLDivElement | undefined = $state();
  let track: HTMLDivElement | undefined = $state();
  let probe: HTMLDivElement | undefined = $state();
  let scrollLeft = $state(0);
  let viewportWidth = $state(0);
  let pitch = $state(0);
  let overflow = $state(false);
  let pinned = $state(false);
  let sync: ScrollSync | null = null;
  /** The last window (the hysteresis of `nextWindow` starts from it). */
  let last: ColumnWindow = $state.raw({ start: 0, end: 0 });
  const win = $derived(nextWindow(last, scrollLeft, viewportWidth, pitch, cols));
  $effect(() => {
    if (last !== win) last = win;
  });
  const kClass = $derived(cols >= 8 && cols <= 64 ? `k${String(cols)}` : '');

  // ---- focus (roving tab stop) ----
  let focus: { lab: Lab; byte: number } = $state({ lab: 'openai', byte: 0 });
  let gridFocused = $state(false);

  /** Columns of token `index` (absolute) and the byte it starts at (−1: the zero-width marker). */
  function columnsOf(result: TokenizationResult, index: number): { col: number; span: number; byte: number } {
    const start = result.tokens.byteStart[index] ?? 0;
    const end = result.tokens.byteStart[index + 1] ?? start;
    return start === end ? { col: 0, span: 1, byte: -1 } : { col: start + marker, span: end - start, byte: start };
  }

  /** The chip of `result` covering `byte` (−1: the marker), clamped to the text; −1 when there is none. */
  function indexAt(result: TokenizationResult, byte: number): number {
    if (byte < 0 && hasLeadingMarker(result)) return 0;
    const found = tokenAtByte(result, Math.min(Math.max(0, byte), result.utf8.length - 1));
    return found < 0 ? result.tokens.count - 1 : found;
  }

  /** The tab stop: the focused byte's chip of the focused row when it is mounted, else the row's first mounted chip. */
  const tabStop = $derived.by(() => {
    const rows = navigable();
    const view = rows.find((candidate) => candidate.row.lab === focus.lab) ?? rows[0];
    const result = view?.result ?? null;
    if (view === undefined || result === null) return null;
    let index = indexAt(result, view.row.lab === focus.lab ? focus.byte : 0);
    const { col, span } = columnsOf(result, index);
    if (col + span <= win.start || col >= win.end) index = indexAt(result, win.start - marker);
    return { lab: view.row.lab, index };
  });

  function measure(): void {
    if (tbody === undefined) return;
    viewportWidth = tbody.clientWidth;
    pitch = probe?.getBoundingClientRect().width ?? 0;
    overflow = tbody.scrollWidth > tbody.clientWidth + 1;
    // The pinned boxes' heights, for the scroll margins that keep a focused control clear of them.
    section?.style.setProperty('--cmp-head-h', `${String(thead?.offsetHeight ?? 0)}px`);
    section?.style.setProperty('--cmp-foot-h', `${String(sbar?.offsetHeight ?? 0)}px`);
  }

  /** Scrolls the table sideways just enough for columns `[col, col + span)` to be on screen (the window follows). */
  function reveal(col: number, span: number): void {
    if (tbody === undefined || sync === null || !(pitch > 0)) return;
    const left = col * pitch;
    const right = (col + span) * pitch + 2;
    let target = tbody.scrollLeft;
    if (left < target) target = left;
    else if (right > target + viewportWidth) target = right - viewportWidth;
    if (Math.abs(target - tbody.scrollLeft) > 0.5) scrollLeft = sync.to(target);
  }

  async function moveFocus(lab: Lab, result: TokenizationResult, index: number): Promise<void> {
    const { col, span, byte } = columnsOf(result, index);
    focus = { lab, byte };
    reveal(col, span);
    await tick();
    const element = tbody?.querySelector<HTMLElement>(`[data-lab="${lab}"][data-index="${String(index)}"]`);
    if (element === null || element === undefined) return;
    element.focus({ preventScroll: true });
    element.scrollIntoView({ block: 'nearest', inline: 'nearest', behavior: 'auto' }); // instant, never smooth (reduced motion)
  }

  /** Enter/Space: the board on that row's tokenizer, its token cell at `byte` focused (the board clears the request). */
  function openInBoard(lab: Lab, byte: number): void {
    const id = app.rows.entryFor(lab)?.id;
    if (id === undefined) return;
    app.openAdvanced();
    if (id !== app.tokenizer) void app.selectTokenizer(id);
    app.boardFocus = Math.max(0, byte);
  }

  function onKeydown(event: KeyboardEvent): void {
    if (event.ctrlKey || event.metaKey || event.altKey) return;
    const cell = event.target instanceof Element ? event.target.closest<HTMLElement>('[data-lab][data-index]') : null;
    if (cell === null) return;
    const lab = cell.dataset['lab'] as Lab;
    const index = Number(cell.dataset['index']);
    const rows = navigable();
    const at = rows.findIndex((view) => view.row.lab === lab);
    const view = rows[at];
    const result = view?.result ?? null;
    if (view === undefined || result === null) return;
    const { byte } = columnsOf(result, index);
    const count = result.tokens.count;
    type Target = { lab: Lab; result: TokenizationResult; index: number } | null;
    /** The chip of another row covering the same byte. */
    const other = (row: (typeof rows)[number] | undefined): Target =>
      row?.result === null || row?.result === undefined
        ? null
        : { lab: row.row.lab, result: row.result, index: indexAt(row.result, byte) };
    let target: Target = null;
    switch (event.key) {
      case 'ArrowRight':
        if (index + 1 < count) target = { lab, result, index: index + 1 };
        break;
      case 'ArrowLeft':
        if (index > 0) target = { lab, result, index: index - 1 };
        break;
      case 'Home':
        target = { lab, result, index: 0 };
        break;
      case 'End':
        target = { lab, result, index: count - 1 };
        break;
      case 'ArrowUp':
        target = other(rows[at - 1]);
        break;
      case 'ArrowDown':
        target = other(rows[at + 1]);
        break;
      case 'PageUp':
        target = other(rows[0]);
        break;
      case 'PageDown':
        target = other(rows.at(-1));
        break;
      case 'Enter':
      case ' ':
        event.preventDefault();
        openInBoard(lab, byte);
        return;
      case 'Escape':
        event.preventDefault();
        document.getElementById('text-input')?.focus();
        return;
      default:
        return;
    }
    event.preventDefault();
    if (target !== null) void moveFocus(target.lab, target.result, target.index);
  }

  function onFocusIn(event: FocusEvent): void {
    const cell = event.target instanceof Element ? event.target.closest<HTMLElement>('[data-lab][data-index]') : null;
    if (cell === null) return;
    gridFocused = true;
    focus = { lab: cell.dataset['lab'] as Lab, byte: Number(cell.dataset['byte']) };
  }

  function onFocusOut(event: FocusEvent): void {
    const next = event.relatedTarget;
    if (next instanceof Element && next.closest('[data-lab][data-index]') !== null && tbody?.contains(next) === true)
      return;
    gridFocused = false;
  }

  /** A press is focusing what it landed on: set on `mousedown` (whose default action focuses), cleared a task later. */
  let pressing = false;

  /**
   * Focus that lands under the pinned header box or the pinned scrollbar (a Tab, a Shift+Tab): the browser scrolls
   * nothing it counts as on screen, sticky boxes or not, so the table scrolls it into view itself — its
   * `scroll-margin-block` then clears both boxes (WCAG 2.4.11). The header box's own controls are never under it, and the
   * pinned scrollbar (`tabindex="-1"`: a press on it focuses it) is the box itself — scrolling it into view would move
   * the page under the pointer that grabs it. A press (mouse, or a tap's compatibility `mousedown`) never scrolls: what
   * it focuses is under the pointer, and moving it before the release would send the click elsewhere.
   */
  function revealFocused(event: FocusEvent): void {
    const target = event.target;
    if (
      pressing ||
      !(target instanceof HTMLElement) ||
      thead === undefined ||
      sbar === undefined ||
      thead.contains(target) ||
      sbar.contains(target)
    )
      return;
    const rect = target.getBoundingClientRect();
    const header = document.querySelector('header')?.getBoundingClientRect().bottom ?? 0;
    if (
      rect.top < Math.max(header, thead.getBoundingClientRect().bottom) ||
      rect.bottom > sbar.getBoundingClientRect().top
    )
      target.scrollIntoView({ block: 'nearest', inline: 'nearest', behavior: 'auto' }); // instant, never smooth
  }

  onMount(() => {
    const scrollers = [thead, tbody, sbar].filter((element): element is HTMLDivElement => element !== undefined);
    sync = syncScroll(scrollers, (left) => {
      scrollLeft = left;
    });
    measure();
    let frame = 0;
    const schedule = (): void => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(measure);
    };
    const observer = new ResizeObserver(schedule);
    for (const element of [tbody, track, probe, thead, sbar]) if (element !== undefined) observer.observe(element);
    section?.addEventListener('focusin', revealFocused);
    const onPress = (): void => {
      pressing = true;
      setTimeout(() => {
        pressing = false;
      });
    };
    section?.addEventListener('mousedown', onPress, true);
    let scrollFrame = 0;
    const onPageScroll = (): void => {
      if (scrollFrame !== 0) return;
      scrollFrame = requestAnimationFrame(() => {
        scrollFrame = 0;
        const header = document.querySelector('header')?.getBoundingClientRect().bottom ?? 0;
        pinned = section !== undefined && section.getBoundingClientRect().top < header;
      });
    };
    window.addEventListener('scroll', onPageScroll, { passive: true });
    // The header box clips its overflow instead of scrolling (no scroll container without a tab stop, axe
    // scrollable-region-focusable): a sideways wheel or a horizontal touch drag on it moves the table.
    const onWheel = (event: WheelEvent): void => {
      if (sync === null || tbody === undefined || Math.abs(event.deltaX) <= Math.abs(event.deltaY)) return;
      event.preventDefault();
      scrollLeft = sync.to(tbody.scrollLeft + event.deltaX);
    };
    let drag: { readonly id: number; readonly x: number; readonly left: number } | null = null;
    const onPointerDown = (event: PointerEvent): void => {
      if (event.pointerType === 'touch' && tbody !== undefined)
        drag = { id: event.pointerId, x: event.clientX, left: tbody.scrollLeft };
    };
    const onPointerMove = (event: PointerEvent): void => {
      if (drag?.id === event.pointerId && sync !== null) scrollLeft = sync.to(drag.left - (event.clientX - drag.x));
    };
    const onPointerEnd = (): void => {
      drag = null;
    };
    thead?.addEventListener('wheel', onWheel, { passive: false });
    thead?.addEventListener('pointerdown', onPointerDown);
    thead?.addEventListener('pointermove', onPointerMove);
    thead?.addEventListener('pointerup', onPointerEnd);
    thead?.addEventListener('pointercancel', onPointerEnd);
    return () => {
      section?.removeEventListener('focusin', revealFocused);
      section?.removeEventListener('mousedown', onPress, true);
      thead?.removeEventListener('wheel', onWheel);
      thead?.removeEventListener('pointerdown', onPointerDown);
      thead?.removeEventListener('pointermove', onPointerMove);
      thead?.removeEventListener('pointerup', onPointerEnd);
      thead?.removeEventListener('pointercancel', onPointerEnd);
      sync?.stop();
      sync = null;
      observer.disconnect();
      cancelAnimationFrame(frame);
      cancelAnimationFrame(scrollFrame);
      window.removeEventListener('scroll', onPageScroll);
    };
  });
</script>

<section
  id="compare"
  class={`cmp ${kClass}`}
  class:scrolled={scrollLeft > 2}
  style:--cmp-cols={kClass === '' ? cols : undefined}
  style:--cmp-win={win.end - win.start === cols ? undefined : win.end - win.start}
  style:--cmp-start={win.start === 0 ? undefined : win.start}
  aria-labelledby="compare-label"
  data-testid="compare"
  data-reflow-exempt
  data-cols={cols}
  data-window={`${String(win.start)}-${String(win.end)}`}
  bind:this={section}
>
  <h2 id="compare-label" class="visually-hidden">{i18n.t('compare.label')}</h2>
  <div class="cmp-probe" aria-hidden="true" bind:this={probe}></div>
  <div
    role="grid"
    id="compare-grid"
    aria-labelledby="compare-label"
    aria-rowcount={1 + byteViews.length + chipRows.length}
    aria-colcount={cols}
    aria-owns={owns}
    data-testid="compare-grid"
  ></div>
  <CompareHeader {source} window={win} {marker} {byteViews} {lang} {overflow} {pinned} bind:element={thead} />
  <!-- svelte-ignore a11y_no_static_element_interactions (keys and focus are delegated from the chips, the grid's cells) -->
  <div class="cmp-tbody" bind:this={tbody} onkeydown={onKeydown} onfocusin={onFocusIn} onfocusout={onFocusOut}>
    <div class="cmp-track" bind:this={track}>
      {#each views as view (view.row.lab)}
        <CompareRow
          row={view.row}
          choice={view.choice}
          entry={view.entry}
          hub={view.hub}
          result={view.result}
          state={view.state}
          window={win}
          {marker}
          {cols}
          rowIndex={2 + byteViews.length + chipRows.indexOf(view)}
          tabStop={tabStop?.lab === view.row.lab ? tabStop.index : null}
          active={gridFocused && focus.lab === view.row.lab && view.result !== null
            ? indexAt(view.result, focus.byte)
            : null}
          {lang}
          onselect={selectRow}
        />
      {/each}
    </div>
  </div>
  <div class="cmp-sbar" tabindex="-1" aria-hidden="true" bind:this={sbar}><div class="cmp-track"></div></div>
</section>
