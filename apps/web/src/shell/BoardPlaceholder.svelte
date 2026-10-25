<script lang="ts">
  /**
   * TODO(WP-integration): placeholder for the alignment board (WP08 owns `src/board`). It holds the board's region with
   * the right role (`role="grid"`, one tab stop, `aria-rowcount`/`aria-colcount`, `aria-rowindex`/`aria-colindex`/
   * `aria-colspan`) and a reserved height (`--row-h`), and renders the char, byte and token tiers of the first 64 code
   * points as one strip so the shell is usable before WP08 lands. It claims the WCAG 1.4.10 two-dimensional exemption
   * (`data-reflow-exempt`, 06 §1): the strip scrolls inside its own container.
   */
  import { appState } from '../app/context.ts';
  import { byteHex, codePointLabel, textStats } from '../app/text-stats.ts';
  import { i18n } from '../i18n/locale.svelte.ts';
  import { formatPercent } from '../i18n/t.ts';
  import { resolveTextLang } from '../i18n/text-lang.ts';
  import { progressPercent } from './progress.ts';

  const LIMIT = 64;
  /** Between char cells so the row's text reads "台 灣 台 南", not one run (grid layout ignores the space). */
  const SEPARATOR = ' ';
  const app = appState();

  const stats = $derived(textStats(app.text, LIMIT));
  const columns = $derived(
    stats.chars.length === 0 ? 1 : (stats.chars.at(-1)?.byteStart ?? 0) + (stats.chars.at(-1)?.bytes.length ?? 1),
  );
  const lang = $derived(resolveTextLang(app.textLang, app.text, i18n.current));
  const result = $derived(app.currentResult);
  const tokens = $derived.by(() => {
    const r = result;
    if (r === null) return [];
    const out: Array<{ index: number; id: number; start: number; end: number; partial: boolean }> = [];
    for (let t = 0; t < r.tokens.count; t++) {
      const start = r.tokens.byteStart[t] ?? 0;
      const end = r.tokens.byteStart[t + 1] ?? start;
      if (start >= columns) break;
      out.push({
        index: t,
        id: r.tokens.id[t] ?? 0,
        start,
        end: Math.min(end, columns),
        partial: ((r.tokens.flags[t] ?? 0) & 1) !== 0,
      });
    }
    return out;
  });
  const pendingText = $derived(
    app.loading === null
      ? i18n.t('board.pending')
      : i18n.t('board.loading', { percent: formatPercent(progressPercent(app.loading) / 100, i18n.current) }),
  );

  /** Roving focus: "tier:byteStart" of the cell that holds the board's single tab stop. */
  let focusKey = $state('0:0');
  let grid: HTMLDivElement | undefined = $state();

  function cellsOf(tier: number): HTMLElement[] {
    return [...(grid?.querySelectorAll<HTMLElement>(`[data-tier="${String(tier)}"]`) ?? [])];
  }

  function focusCell(cell: HTMLElement | undefined): void {
    if (cell === undefined) return;
    focusKey = `${cell.dataset['tier'] ?? '0'}:${cell.dataset['start'] ?? '0'}`;
    cell.focus();
    cell.scrollIntoView({ block: 'nearest', inline: 'nearest' });
  }

  function onKeydown(event: KeyboardEvent): void {
    const cell = event.target instanceof HTMLElement ? event.target.closest<HTMLElement>('[data-tier]') : null;
    if (cell === null) return;
    const tier = Number(cell.dataset['tier']);
    const start = Number(cell.dataset['start']);
    const row = cellsOf(tier);
    const at = row.indexOf(cell);
    const atByte = (t: number): HTMLElement | undefined =>
      cellsOf(t).find((c) => Number(c.dataset['start']) <= start && start < Number(c.dataset['end'])) ?? cellsOf(t)[0];
    const moves: Record<string, () => HTMLElement | undefined> = {
      ArrowLeft: () => row[at - 1],
      ArrowRight: () => row[at + 1],
      Home: () => row[0],
      End: () => row.at(-1),
      ArrowUp: () => (tier > 0 ? atByte(tier - 1) : undefined),
      ArrowDown: () => (tier < 2 ? atByte(tier + 1) : undefined),
    };
    const move = moves[event.key];
    if (move === undefined) return;
    event.preventDefault();
    focusCell(move());
  }

  const tabIndex = (tier: number, start: number): 0 | -1 => (focusKey === `${String(tier)}:${String(start)}` ? 0 : -1);
</script>

<section class="board-region" id="board" aria-labelledby="board-label" data-reflow-exempt data-testid="board">
  <h2 id="board-label" class="visually-hidden">{i18n.t('board.label')}</h2>
  <div class="scroller">
    <!-- svelte-ignore a11y_interactive_supports_focus (the grid's single tab stop is its active gridcell) -->
    <div
      class="grid"
      role="grid"
      aria-labelledby="board-label"
      aria-rowcount={3}
      aria-colcount={columns}
      bind:this={grid}
      onkeydown={onKeydown}
      style:--cols={columns}
    >
      <div role="row" aria-rowindex={1} class="tier tier-char">
        {#if stats.chars.length === 0}<span role="gridcell" class="cell empty" aria-colindex={1}></span>{/if}
        {#each stats.chars as char (char.byteStart)}
          <span
            role="gridcell"
            class="cell char"
            aria-colindex={char.byteStart + 1}
            aria-colspan={char.bytes.length}
            aria-label={i18n.t('board.cell.char', { glyph: char.char, cp: codePointLabel(char.cp) })}
            tabindex={tabIndex(0, char.byteStart)}
            data-tier="0"
            data-start={char.byteStart}
            data-end={char.byteStart + char.bytes.length}
            style:grid-column-end={`span ${String(char.bytes.length)}`}
            {lang}>{char.char}</span
          >{SEPARATOR}
        {/each}
      </div>
      <div role="row" aria-rowindex={2} class="tier tier-byte">
        {#if stats.chars.length === 0}<span role="gridcell" class="cell empty" aria-colindex={1}></span>{/if}
        {#each stats.chars as char (char.byteStart)}
          {#each char.bytes as byte, i (i)}
            <span
              role="gridcell"
              class="cell byte mono"
              class:lead={i === 0}
              aria-colindex={char.byteStart + i + 1}
              aria-label={i18n.t('board.cell.byte', { hex: byteHex(byte) })}
              tabindex={tabIndex(1, char.byteStart + i)}
              data-tier="1"
              data-start={char.byteStart + i}
              data-end={char.byteStart + i + 1}
            >
              {#if app.byteView !== 'dec'}<span>{byteHex(byte)}</span>{/if}
              {#if app.byteView !== 'hex'}<span class="dec">{byte}</span>{/if}
            </span>
          {/each}
        {/each}
      </div>
      <div role="row" aria-rowindex={3} class="tier tier-token">
        {#if tokens.length > 0}
          {#each tokens as token (token.index)}
            <span
              role="gridcell"
              class={`cell token mono t${String(token.index % 8)}`}
              class:partial={token.partial}
              aria-colindex={token.start + 1}
              aria-colspan={Math.max(1, token.end - token.start)}
              aria-label={i18n.t('board.cell.token', { id: token.id })}
              tabindex={tabIndex(2, token.start)}
              data-tier="2"
              data-start={token.start}
              data-end={token.end}
              style:grid-column={`${String(token.start + 1)} / span ${String(Math.max(1, token.end - token.start))}`}
              >{token.id}</span
            >
          {/each}
        {:else}
          <span
            role="gridcell"
            class="cell pending"
            aria-colindex={1}
            aria-colspan={columns}
            tabindex={tabIndex(2, 0)}
            data-tier="2"
            data-start="0"
            data-end={columns}
            style:grid-column={`1 / span ${String(columns)}`}>{pendingText}</span
          >
        {/if}
      </div>
    </div>
  </div>
</section>

<style>
  .board-region {
    min-height: var(--row-h);
    padding-block: 0.5rem;
  }

  .scroller {
    position: relative;
    max-width: 100%;
    overflow-x: auto;
    padding: 4px;
  }

  .grid {
    display: grid;
    gap: var(--gap);
    width: max-content;
  }

  .tier {
    display: grid;
    grid-template-columns: repeat(var(--cols), var(--cell));
    gap: var(--gap) 0;
  }

  .cell {
    display: grid;
    place-items: center;
    min-width: 0;
    border: var(--border-width) solid var(--border);
    border-radius: var(--radius);
    background: var(--surface);
  }

  .cell:focus-visible {
    position: relative;
    z-index: 1;
  }

  .char {
    min-height: 40px;
    font-size: 1.375rem;
  }

  .byte {
    min-height: 24px;
    background: var(--surface-2);
    font-size: 0.8125rem;
    line-height: 1.2;
  }

  .byte.lead {
    font-weight: 700;
  }

  .byte .dec {
    color: var(--fg-muted);
  }

  .token {
    min-height: 28px;
    font-size: 0.8125rem;
  }

  .token.partial {
    border-style: dashed;
  }

  .pending {
    justify-items: start;
    min-height: 28px;
    padding-inline: 0.5rem;
    color: var(--fg-muted);
    border-style: dashed;
    font-size: 0.875rem;
  }

  .empty {
    min-height: 24px;
    border-style: dashed;
  }

  .t0 {
    background: var(--tok-h0);
  }
  .t1 {
    background: var(--tok-h1);
  }
  .t2 {
    background: var(--tok-h2);
  }
  .t3 {
    background: var(--tok-h3);
  }
  .t4 {
    background: var(--tok-h4);
  }
  .t5 {
    background: var(--tok-h5);
  }
  .t6 {
    background: var(--tok-h6);
  }
  .t7 {
    background: var(--tok-h7);
  }
</style>
