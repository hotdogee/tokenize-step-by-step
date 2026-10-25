<script lang="ts">
  /**
   * The three-tier alignment board (05 §3–§9; AD-17, AD-18, AD-25, AD-34): the `/` region between the pipeline rail and
   * the notices strip. It owns
   *
   * - layout: K = clamp(8, floor((boardWidth − 2·gutter) / cell), 64) from a ResizeObserver on the board column and a
   *   `--cell`/`--row-h` probe (debounced one frame), `packRows` once per (result, K), `withParts` per step;
   * - the APG layout grid: `role="grid"` with `aria-rowcount`/`aria-colcount`, one tab stop (roving tabindex on the
   *   focused cell, keyed by a byte-offset anchor that survives re-tokenization, a new K and virtual remounts), the
   *   05 §8 keys, and `scrollIntoView` on every focus move with the sheet height as scroll padding;
   * - arithmetic virtualization (fixed row heights, `content-visibility: auto`), always mounting the focused and pinned
   *   rows;
   * - pointer/touch: hover after 120 ms (fine pointers), click/tap pins, tap elsewhere unpins;
   * - the inspector host (side rail / anchored panel / bottom sheet by viewport width) and selection sync with the
   *   textarea (CSS Custom Highlight API where supported).
   *
   * While no tokenizer result belongs to the text, stops 1–3 are live from `analyzeText` and the token tier waits.
   */
  import { onMount, tick, untrack } from 'svelte';
  import type { TokenizationResult } from '@tsbs/core';
  import type { TokenizerEntry } from '@tsbs/registry';
  import { packRows, withParts } from '@tsbs/core/layout/pack-rows';
  import { TokenFlag, TokenKind } from '@tsbs/core/model/result';
  import { hexByte } from '@tsbs/core/text/utf8';
  import { appState } from '../app/context.ts';
  import { readStored, writeStored } from '../app/storage.ts';
  import { i18n } from '../i18n/locale.svelte.ts';
  import { formatPercent } from '../i18n/t.ts';
  import { resolveTextLang } from '../i18n/text-lang.ts';
  import { motionPrefs } from '../motion/motion-prefs.svelte.ts';
  import InspectorHost from '../inspector/InspectorHost.svelte';
  import type * as InspectorCatalogModule from '../inspector/i18n/catalogs.ts';
  import type { InspectorTranslate } from '../inspector/i18n/catalogs.ts';
  import { copyValueOf, inspectorModel } from '../inspector/model.ts';
  import { progressPercent } from '../shell/progress.ts';
  import { isComposing } from '../shell/shortcuts.ts';
  import { placePanel, type Extent } from './anchor.ts';
  import type { InteractionState } from './cell-state.ts';
  import { nfkcSource, type BoardContext } from './cells.ts';
  import { extraTier, extraTierFor } from './extra-tier.svelte.ts';
  import { appTier, columnsFor, GUTTER, tiersFor, tokenMode, type BoardTier } from './geometry.ts';
  import { spokenGlyph } from './labels.ts';
  import { navigate, navKeyOf, resolveAnchor as resolveAnchorIn } from './navigation.ts';
  import Row from './Row.svelte';
  import { byteRangeOfSelection, highlightSelection } from './selection.ts';
  import { textOnlyResult } from './text-only.ts';
  import { BoardUnits, type Anchor, type CellRef, type Span } from './units.ts';
  import { viewOf } from './view-cache.ts';
  import { BoardViewport } from './viewport.svelte.ts';
  import { mountedRows, spacers, visibleRows } from './window.ts';
  import './grid-classes.css';
  import './board.css';

  /** Hover delay on fine pointers (05 §5, WCAG 1.4.13). */
  const HOVER_MS = 120;
  /** localStorage: the keyboard hint under the board is shown until the board keys have been used (05 §8). */
  const HINT_KEY = 'tsbs:boardKeysUsed';
  /** The first of these anywhere on the page loads the inspector catalog (PA-7: it is not part of the startup JS). */
  const ENGAGE_EVENTS = ['pointerdown', 'pointermove', 'keydown', 'focusin'] as const;

  const app = appState();
  const viewport = new BoardViewport();

  let layout: HTMLDivElement | undefined = $state();
  let main: HTMLDivElement | undefined = $state();
  let grid: HTMLDivElement | undefined = $state();
  let probe: HTMLDivElement | undefined = $state();
  let panel: HTMLElement | undefined = $state();
  let host: HTMLElement | undefined = $state();

  // ---- measurements ----
  let contentWidth = $state(0);
  let cellPx = $state(0);
  let rowPx = $state(0);
  let viewTop = $state(0);
  let viewHeight = $state(900);

  // ---- data ----
  const pending = $derived(app.currentResult === null);
  const result: TokenizationResult = $derived(
    app.currentResult ?? textOnlyResult(app.text, app.tokenizer, app.entry.family),
  );
  const lang = $derived(resolveTextLang(app.textLang, app.text, i18n.current));
  const view = $derived(viewOf(result, lang));
  const stage = $derived(app.stage);
  const step = $derived(Math.min(Math.max(0, app.step), view.stepCount));
  const K = $derived(columnsFor(contentWidth + 2 * GUTTER, cellPx));
  const baseRows = $derived(packRows(result, K));
  const parts = $derived(!pending && tokenMode(stage) === 'parts' ? view.partsAt(stage === 4 ? 0 : step) : null);
  const rows = $derived(parts === null ? baseRows : withParts(baseRows, result, parts));
  const units = $derived(new BoardUnits(result, rows, parts));
  const tiers = $derived(
    tiersFor({ stage, byteView: app.byteView, wide: viewport.wide, chunkTier: viewport.small, tokens: !pending }),
  );
  const fusedDummy = $derived(fusesDummy(result, app.entry));
  const nfkc = $derived(nfkcSource(result));
  /** WP10's live token tier (extra-tier.svelte.ts): one more decorative track per row while it applies. */
  const extra = $derived(extraTierFor(extraTier.current, result, stage, pending));
  const ctx: BoardContext = $derived({
    result,
    units,
    tiers,
    stage,
    pending,
    uLabels: stage >= 2 && viewport.small,
    idLine: viewport.small,
    brackets: app.graphemes,
    fusedDummy,
    lang,
    t: i18n.t,
    nfkc,
  });

  // ---- focus, pin, hover (anchors are byte offsets, AD-17) ----
  let focusAnchor: Anchor = $state({ tier: 'char', byte: 0, slot: -1 });
  let pinAnchor: Anchor | null = $state(null);
  let hoverRef: CellRef | null = $state(null);
  let gridFocused = $state(false);
  /** The inspector shows content once the board has been focused, hovered or tapped (until then: its hint). */
  let engaged = $state(false);
  let panelFocused = $state(false);
  let panelHovered = false;
  let sheetExpanded = $state(false);
  let selected: Span | null = $state(null);
  let anchor: { top: number; left: number } | null = $state(null);
  let keysUsed = $state(readStored(HINT_KEY) === 'true');
  let hoverTimer: ReturnType<typeof setTimeout> | undefined;

  const focusRef = $derived(resolveAnchor(focusAnchor));
  const pinRef = $derived(pinAnchor === null ? null : resolveAnchor(pinAnchor));
  const inspected = $derived(pinRef ?? hoverRef ?? (engaged ? focusRef : null));
  const sliceRef = $derived(pinRef ?? hoverRef ?? (gridFocused ? focusRef : null));
  const interaction: InteractionState = $derived({
    focus: focusRef,
    pinned: pinRef,
    slice: sliceRef === null ? null : units.span(sliceRef.tier, sliceRef.index),
    selected,
  });
  /**
   * The inspector catalog (a lazy chunk, PA-7) loads on the first interaction with the page — a pointer, a key or a focus
   * anywhere, so board engagement (focus, hover, tap) always includes it — never at startup; until then the panel shows
   * its empty text and the keyboard hint's reserved lines stay blank.
   */
  let inspectorCatalog: typeof InspectorCatalogModule | null = $state.raw(null);
  const ti: InspectorTranslate | null = $derived.by(() => {
    const catalog = inspectorCatalog;
    const locale = i18n.current;
    return catalog === null ? null : (key, params) => catalog.translateInspector(locale, key, params);
  });
  const model = $derived(
    inspected === null || ti === null
      ? null
      : inspectorModel({ result, units, ref: inspected, t: i18n.t, ti, fusedDummy, lang, step }),
  );

  // ---- virtual window ----
  const range = $derived(visibleRows(viewTop, viewHeight, rowPx, rows.length));
  const mounted = $derived(
    mountedRows(
      range,
      [focusRef === null ? null : units.rowOf(focusRef), pinRef === null ? null : units.rowOf(pinRef)],
      rows.length,
    ),
  );
  const gaps = $derived(spacers(mounted, rows.length, rowPx));

  const pendingText = $derived(
    app.loading === null
      ? i18n.t('board.pending')
      : i18n.t('board.loading', { percent: formatPercent(progressPercent(app.loading) / 100, i18n.current) }),
  );

  /** The first spm piece fuses the dummy prefix when the engine adds one and no bare `▁` token exists (03 §B.3). */
  function fusesDummy(r: TokenizationResult, entry: TokenizerEntry): boolean {
    if (entry.engine.kind !== 'spm-bpe' || !entry.engine.addDummyPrefix || r.tokens.count === 0) return false;
    for (let t = 0; t < r.tokens.count; t++) if (r.tokens.kind[t] === TokenKind.DummyPrefix) return false;
    return r.utf8.length > 0;
  }

  /** The navigable unit holding `a` among the shown tiers (navigation.ts `resolveAnchor`). */
  function resolveAnchor(a: Anchor): CellRef | null {
    return resolveAnchorIn(units, tiers, a);
  }

  function sameRef(a: CellRef | null, b: CellRef | null): boolean {
    return a !== null && b !== null && a.tier === b.tier && a.index === b.index;
  }

  function refOf(target: EventTarget | null): CellRef | null {
    if (!(target instanceof Element)) return null;
    const cell = target.closest<HTMLElement>('[role="gridcell"][data-tier]');
    if (cell === null) return null;
    const tier = cell.dataset['tier'] as BoardTier;
    const index = Number(cell.dataset['index']);
    return Number.isInteger(index) ? { tier, index } : null;
  }

  function cellElement(ref: CellRef): HTMLElement | null {
    return (
      grid?.querySelector<HTMLElement>(`[data-tier="${ref.tier}"][data-index="${String(ref.index)}"][data-first]`) ??
      null
    );
  }

  /** The system setting and the in-app Reduce motion switch together (05 §7): 'auto' under reduced motion. */
  function scrollBehavior(): ScrollBehavior {
    return motionPrefs.scrollBehavior;
  }

  /**
   * Keyboard input takes the inspector and the slice back from a resting pointer (the most recent input wins, 05 §5):
   * hover returns on the next `pointerover`.
   */
  function dropHover(): void {
    clearTimeout(hoverTimer);
    hoverRef = null;
  }

  /** Moves the roving tab stop to `ref`, mounts its row, focuses it and keeps it clear of the sheet (05 §5, §8). */
  async function moveFocus(ref: CellRef): Promise<void> {
    dropHover();
    focusAnchor = units.anchorOf(ref);
    app.focus = { tier: appTier(ref.tier), byte: focusAnchor.byte };
    await tick();
    const element = cellElement(ref);
    if (element === null) return;
    element.focus({ preventScroll: true });
    element.scrollIntoView({ block: 'nearest', inline: 'nearest', behavior: scrollBehavior() });
  }

  function pinnedMessage(ref: CellRef): string {
    const { tier, index } = ref;
    const count = units.count(tier);
    if (tier === 'token' && units.parts === null) {
      const partial = ((result.tokens.flags[index] ?? 0) & TokenFlag.Partial) !== 0;
      return i18n.t(partial ? 'status.pinnedPartial' : 'status.pinned', {
        index: index + 1,
        count,
        id: result.tokens.id[index] ?? 0,
      });
    }
    let label: string;
    if (tier === 'char')
      label = i18n.t('a11y.cell.char', { index: index + 1, count, glyph: spokenGlyph(result, index, i18n.t) });
    else if (tier === 'hex' || tier === 'dec')
      label = i18n.t('a11y.cell.byte', { index: index + 1, count, hex: hexByte(result.utf8[index] ?? 0) });
    else if (tier === 'chunk') label = i18n.t('a11y.cell.chunk', { index: index + 1, count });
    else label = i18n.t('a11y.cell.part', { index: index + 1, count });
    return i18n.t('status.pinnedCell', { label });
  }

  function pin(ref: CellRef): void {
    pinAnchor = units.anchorOf(ref);
    app.pinned = { byte: pinAnchor.byte, tier: appTier(ref.tier) };
    app.announce(pinnedMessage(ref));
  }

  function unpin(): void {
    if (pinAnchor === null) return;
    pinAnchor = null;
    app.pinned = null;
    app.announce(i18n.t('status.unpinned'));
  }

  function togglePin(ref: CellRef): void {
    if (sameRef(pinRef, ref)) unpin();
    else pin(ref);
  }

  async function copyValue(value: string): Promise<void> {
    try {
      await navigator.clipboard.writeText(value);
    } catch {
      // Clipboard unavailable (insecure context, permission): the status line still names the value.
    }
    app.announce(i18n.t('status.copied', { value }));
  }

  async function focusPanel(): Promise<void> {
    if (viewport.surface === 'sheet') sheetExpanded = true;
    await tick();
    const target = panel?.querySelector<HTMLElement>('button, [href], [tabindex="0"]') ?? panel;
    target?.focus();
    app.inspectorFocus = 'panel';
  }

  function backFromPanel(): void {
    app.inspectorFocus = 'grid';
    if (focusRef !== null) void moveFocus(focusRef);
  }

  function focusTextarea(): void {
    document.getElementById('text-input')?.focus();
  }

  function markKeysUsed(): void {
    if (keysUsed) return;
    keysUsed = true;
    writeStored(HINT_KEY, 'true');
  }

  // ---- keyboard (05 §8) ----
  function onKeydown(event: KeyboardEvent): void {
    if (isComposing(event)) return;
    const ref = refOf(event.target);
    if (ref === null) return;
    const key = navKeyOf(event);
    if (key !== null) {
      event.preventDefault();
      markKeysUsed();
      const next = navigate(units, tiers, ref, key);
      if (next !== null) void moveFocus(next);
      return;
    }
    if (event.ctrlKey || event.metaKey || event.altKey) return;
    if (event.key === 'Enter' || event.key === ' ' || event.code === 'Space') {
      event.preventDefault();
      markKeysUsed();
      togglePin(ref);
      return;
    }
    if (event.key === 'Escape') {
      event.preventDefault();
      if (hoverRef !== null) hoverRef = null;
      else if (pinAnchor !== null) unpin();
      else focusTextarea();
      return;
    }
    const letter = event.key.toLowerCase();
    if (letter === 'i') {
      event.preventDefault();
      void focusPanel();
    } else if (letter === 'c') {
      event.preventDefault();
      void copyValue(copyValueOf(result, units, ref));
    }
  }

  function onFocusIn(event: FocusEvent): void {
    gridFocused = true;
    engaged = true;
    const ref = refOf(event.target);
    if (ref === null) return;
    const element = event.target as HTMLElement;
    // Tab into the grid (or a script focus after keyboard use) is keyboard input; a click is pointer input.
    if (element.matches(':focus-visible')) dropHover();
    if (!('first' in element.dataset)) {
      // A non-first fragment got focus (click): the logical cell's focus lives on its first fragment (05 §8).
      void moveFocus(ref);
      return;
    }
    if (!sameRef(ref, focusRef)) {
      focusAnchor = units.anchorOf(ref);
      app.focus = { tier: appTier(ref.tier), byte: focusAnchor.byte };
    }
  }

  function onFocusOut(event: FocusEvent): void {
    const next = event.relatedTarget;
    if (!(next instanceof Node) || !(grid?.contains(next) ?? false)) gridFocused = false;
  }

  // ---- pointer (05 §9) ----

  function onPointerOver(event: PointerEvent): void {
    if (event.pointerType !== 'mouse') return;
    const ref = refOf(event.target);
    clearTimeout(hoverTimer);
    if (ref === null) return;
    hoverTimer = setTimeout(() => {
      hoverRef = ref;
    }, HOVER_MS);
  }

  function onPointerLeave(event: PointerEvent): void {
    if (event.pointerType !== 'mouse') return;
    clearTimeout(hoverTimer);
    hoverTimer = setTimeout(() => {
      if (!panelHovered) hoverRef = null;
    }, HOVER_MS);
  }

  function onPanelHover(inside: boolean): void {
    panelHovered = inside;
    if (inside) clearTimeout(hoverTimer);
    else
      hoverTimer = setTimeout(() => {
        hoverRef = null;
      }, HOVER_MS);
  }

  function onClick(event: MouseEvent): void {
    const ref = refOf(event.target);
    if (ref === null) return;
    togglePin(ref);
  }

  // ---- selection sync (05 §6) ----
  function onSelectionChange(): void {
    const textarea = document.getElementById('text-input');
    if (!(textarea instanceof HTMLTextAreaElement) || document.activeElement !== textarea) return;
    selected = byteRangeOfSelection(result, textarea.selectionStart, textarea.selectionEnd);
  }

  function selectInText(utf16: readonly [number, number]): void {
    const textarea = document.getElementById('text-input');
    if (!(textarea instanceof HTMLTextAreaElement)) return;
    textarea.focus({ preventScroll: true });
    textarea.setSelectionRange(utf16[0], utf16[1]);
  }

  function showStep(k: number): void {
    app.setStage(5);
    app.step = k;
  }

  // ---- measurement and window ----
  function measure(): void {
    if (main !== undefined) contentWidth = main.clientWidth;
    if (probe !== undefined) {
      const rect = probe.getBoundingClientRect();
      cellPx = rect.width;
      rowPx = rect.height;
    }
    updateView();
  }

  function updateView(): void {
    if (grid === undefined) return;
    viewTop = -grid.getBoundingClientRect().top;
    viewHeight = window.innerHeight;
  }

  function updateAnchor(): void {
    if (viewport.surface !== 'anchored' || layout === undefined || inspected === null) {
      anchor = null;
      return;
    }
    const element = cellElement(inspected);
    if (element === null) return;
    // Beside the active cell without covering its packed row (the vertical slice the panel explains) nor, while a pinned
    // or hovered cell is inspected, the row holding keyboard focus (WCAG 2.4.11: stay pinned and keep arrowing).
    const rows = [rowExtent(element)];
    const focused = gridFocused && focusRef !== null && !sameRef(focusRef, inspected) ? cellElement(focusRef) : null;
    if (focused !== null) rows.push(rowExtent(focused));
    const cell = element.getBoundingClientRect();
    const box = layout.getBoundingClientRect();
    const width = Math.min(320, box.width);
    const top = placePanel(rows, host?.offsetHeight ?? 0, window.innerHeight) - box.top;
    const left = Math.min(Math.max(0, cell.left - box.left), Math.max(0, box.width - width));
    anchor = { top: Math.round(top), left: Math.round(left) };
  }

  /** Viewport extent of the packed row holding `element`. */
  function rowExtent(element: HTMLElement): Extent {
    const { top, bottom } = (element.closest('.bd-row') ?? element).getBoundingClientRect();
    return { top, bottom };
  }

  onMount(() => {
    measure();
    const loadCatalog = (): void => {
      for (const type of ENGAGE_EVENTS) document.removeEventListener(type, loadCatalog, true);
      void import('../inspector/i18n/catalogs.ts').then(
        (catalog) => {
          inspectorCatalog = catalog;
        },
        () => {
          // A stale deploy (chunk gone): the panel keeps its empty text; the shell's reload alert covers the rest.
        },
      );
    };
    for (const type of ENGAGE_EVENTS) document.addEventListener(type, loadCatalog, { capture: true, passive: true });
    let frame = 0;
    const schedule = (): void => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(measure);
    };
    const observer = new ResizeObserver(schedule);
    if (main !== undefined) observer.observe(main);
    if (probe !== undefined) observer.observe(probe);
    let scrollFrame = 0;
    const onScroll = (): void => {
      if (scrollFrame !== 0) return;
      scrollFrame = requestAnimationFrame(() => {
        scrollFrame = 0;
        updateView();
        updateAnchor();
      });
    };
    const onDocumentPointerDown = (event: PointerEvent): void => {
      // Tap elsewhere unpins on touch (05 §5, §9).
      if (event.pointerType !== 'touch' || pinAnchor === null) return;
      const target = event.target;
      if (target instanceof Node && ((grid?.contains(target) ?? false) || (host?.contains(target) ?? false))) return;
      unpin();
    };
    const onWindowKeydown = (event: KeyboardEvent): void => {
      // Hover content is dismissible with Esc wherever focus is (WCAG 1.4.13).
      if (event.key === 'Escape' && hoverRef !== null && !(grid?.contains(event.target as Node) ?? false))
        hoverRef = null;
    };
    const onDocumentFocusIn = (event: FocusEvent): void => {
      if (selected !== null && (event.target as HTMLElement | null)?.id !== 'text-input') selected = null;
      panelFocused = host?.contains(event.target as Node) ?? false;
    };
    window.addEventListener('scroll', onScroll, { passive: true });
    window.addEventListener('resize', onScroll);
    window.addEventListener('keydown', onWindowKeydown);
    document.addEventListener('selectionchange', onSelectionChange);
    document.addEventListener('pointerdown', onDocumentPointerDown, true);
    document.addEventListener('focusin', onDocumentFocusIn);
    return () => {
      for (const type of ENGAGE_EVENTS) document.removeEventListener(type, loadCatalog, true);
      observer.disconnect();
      cancelAnimationFrame(frame);
      cancelAnimationFrame(scrollFrame);
      clearTimeout(hoverTimer);
      window.removeEventListener('scroll', onScroll);
      window.removeEventListener('resize', onScroll);
      window.removeEventListener('keydown', onWindowKeydown);
      document.removeEventListener('selectionchange', onSelectionChange);
      document.removeEventListener('pointerdown', onDocumentPointerDown, true);
      document.removeEventListener('focusin', onDocumentFocusIn);
      document.documentElement.style.removeProperty('--sheet-height');
      viewport.destroy();
    };
  });

  // The sheet's height (plus an 8 px gap in the CSS below) feeds scroll-padding-block-end so the focused row is never
  // under it (WCAG 2.4.11).
  $effect(() => {
    const height = viewport.surface === 'sheet' ? (sheetExpanded ? '40vh' : '56px') : null;
    if (height === null) document.documentElement.style.removeProperty('--sheet-height');
    else document.documentElement.style.setProperty('--sheet-height', height);
  });

  /** Reads its arguments so an effect re-runs when they change (explicit dependency list). */
  function track(..._values: unknown[]): void {
    // dependencies only
  }

  // Hover refs belong to one layout; drop them when it changes.
  $effect(() => {
    track(units);
    untrack(() => {
      hoverRef = null;
    });
  });

  // Focus restore after a remount (re-tokenization, new K, stage change): back to the cell at the same anchor (05 §8).
  let restoreFocus = false;
  $effect.pre(() => {
    track(rows, tiers);
    untrack(() => {
      restoreFocus = grid?.contains(document.activeElement) ?? false;
    });
  });
  $effect(() => {
    track(rows, tiers);
    untrack(() => {
      if (!restoreFocus) return;
      restoreFocus = false;
      // Cells are keyed by unit index, so a kept element may now hold another unit: focus follows the byte anchor.
      const ref = focusRef;
      const element = ref === null ? null : cellElement(ref);
      if (element !== null && document.activeElement !== element) element.focus({ preventScroll: true });
    });
  });

  // Anchored panel placement follows the inspected cell and keyboard focus (a focus move while pinned re-places it).
  $effect(() => {
    track(inspected, focusRef, gridFocused, viewport.surface, K);
    void tick().then(updateAnchor);
  });

  // Textarea selection → CSS Custom Highlight on the covered glyphs (no-op where unsupported).
  $effect(() => {
    const span = selected;
    track(mounted);
    void tick().then(() => {
      highlightSelection(grid, span);
    });
  });
</script>

<section class="board-region" id="board" aria-labelledby="board-label" data-reflow-exempt data-testid="board">
  <h2 id="board-label" class="visually-hidden">{i18n.t('board.label')}</h2>
  <div
    class="layout"
    bind:this={layout}
    data-surface={viewport.surface}
    data-inspector={ti === null ? 'loading' : 'ready'}
  >
    <div
      class="main"
      class:nfkc={nfkc !== null}
      class:extra={extra !== null}
      class:overflow={K * cellPx > contentWidth + 0.5}
      bind:this={main}
      data-k={K}
    >
      <div class="probe" aria-hidden="true" bind:this={probe}></div>
      <!-- svelte-ignore a11y_interactive_supports_focus (the grid's single tab stop is its active gridcell, APG layout grid) -->
      <div
        class="bd-grid"
        class:nfkc={nfkc !== null}
        class:extra={extra !== null}
        role="grid"
        aria-labelledby="board-label"
        aria-rowcount={rows.length * tiers.length}
        aria-colcount={K}
        data-testid="board-grid"
        data-stage={stage}
        data-pending={pending ? '' : undefined}
        style:--k={K}
        bind:this={grid}
        onkeydown={onKeydown}
        onfocusin={onFocusIn}
        onfocusout={onFocusOut}
        onpointerover={onPointerOver}
        onpointerleave={onPointerLeave}
        onclick={onClick}
      >
        {#each mounted as r, k (r)}
          {@const row = rows[r]}
          {#if (gaps[k] ?? 0) > 0}<div
              class="bd-spacer"
              aria-hidden="true"
              style:height={`${String(gaps[k])}px`}
            ></div>{/if}
          {#if row !== undefined}
            <Row {row} {ctx} {interaction} {extra} emptyLabel={i18n.t('a11y.cell.empty')} />
          {/if}
        {/each}
        {#if (gaps.at(-1) ?? 0) > 0}
          <div class="bd-spacer" aria-hidden="true" style:height={`${String(gaps.at(-1))}px`}></div>
        {/if}
      </div>
      {#if pending}<p class="pending prose" data-testid="board-pending">{pendingText}</p>{/if}
      {#if !keysUsed}<p class="hint prose">{ti?.('board.hint') ?? ''}</p>{/if}
    </div>
    <InspectorHost
      surface={viewport.surface}
      {model}
      pinned={pinRef !== null}
      open={pinRef !== null || hoverRef !== null || gridFocused || panelFocused}
      {anchor}
      bind:expanded={sheetExpanded}
      bind:panel
      bind:host
      oncopy={(value: string) => {
        void copyValue(value);
      }}
      onunpin={unpin}
      onshowstep={showStep}
      onselect={selectInText}
      onescape={backFromPanel}
      onhover={onPanelHover}
    />
  </div>
</section>

<style>
  .board-region {
    min-height: var(--row-h);
  }

  .layout {
    position: relative;
    display: grid;
    grid-template-columns: minmax(0, 1fr);
  }

  @media (min-width: 1024px) {
    .layout {
      grid-template-columns: minmax(0, 1fr) var(--rail-w);
    }
  }

  .main {
    position: relative;
    min-width: 0;
  }

  /* K's floor of 8 columns can be wider than the column (cell size L at 320 px on a coarse pointer: 8 × 40 > 288 px):
     the grid then scrolls inside the board region (exempt from 1.4.10 reflow) instead of widening the page. Only then,
     so edge cells' focus rings are never clipped otherwise. */
  .main.overflow {
    overflow-x: auto;
  }

  .main.overflow :global(.bd-grid) {
    touch-action: pan-x pan-y pinch-zoom;
  }

  .probe {
    position: absolute;
    top: 0;
    left: 0;
    width: var(--cell);
    height: var(--row-h);
    visibility: hidden;
    pointer-events: none;
  }

  .main.nfkc .probe {
    height: calc(var(--row-h) + 16px);
  }

  /* The extra tier's track (board.css .bd-grid.extra --extra-h). */
  .main.extra .probe {
    height: calc(var(--row-h) + 32px);
  }

  .pending,
  .hint {
    margin: 0.5rem 0 0;
    font-size: 0.875rem;
    line-height: 1.3;
    color: var(--fg-muted);
  }

  /* The hint's text arrives with the inspector catalog (lazy, first interaction): its lines are reserved (no CLS). */
  .hint {
    min-height: 2.6em;
  }

  @media (min-width: 768px) {
    .hint {
      min-height: 1.3em;
    }
  }

  /* The sheet height plus a gap, so a focused cell scrolled "nearest" never sits flush against the sheet: flush, its
     focus ring is cut off, and a sub-pixel layout difference (fonts, scrollbars) already counts as overlap. The same gap
     at the top edge keeps the ring of a cell scrolled up to it (Ctrl+Home, a long jump upward) whole. */
  :global(html) {
    scroll-padding-block-start: 8px;
    scroll-padding-block-end: calc(var(--sheet-height, 0px) + 8px);
  }

  :global(body) {
    padding-block-end: var(--sheet-height);
  }
</style>
