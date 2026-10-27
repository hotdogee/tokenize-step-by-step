/**
 * The comparison table's rows (PA-19, 05 §4): one per lab, in the registry's (the picker's) lab order, each showing the
 * lab's `tier: 'primary'` tokenizer by default. The row's `<select>` switches it to the lab's other tokenizers; the
 * Anthropic row also offers `anthropic-api` (the API-key count: no chips, the Live check prompt). The choices that differ
 * from the defaults persist (`tsbs:rows`, a comma list; removed when empty) and travel in the URL as `r=` — the URL wins
 * for the visit, a choice made on the page is stored.
 */
import type { TokenizationResult, TokenizerId } from '@tsbs/core';
import type { Lab, TokenizerEntry } from '@tsbs/registry';
import { TOKENIZERS } from '../app/registry.ts';
import type { HubAnswer } from '../app/result-hub.svelte.ts';
import { readStored, removeStored, STORAGE_KEYS, writeStored } from '../app/storage.ts';

/** The Anthropic row's API-key mode (05 §13: current Claude models count tokens through the API only). */
export const ANTHROPIC_API = 'anthropic-api';

/** What a row shows: a tokenizer, or the Anthropic API prompt. */
export type RowChoice = TokenizerId | typeof ANTHROPIC_API;

/** One lab's row. */
export interface LabRow {
  readonly lab: Lab;
  /** The default: the lab's primary tokenizer. */
  readonly primary: TokenizerEntry;
  /** What the select offers: the primary, then the lab's secondary tokenizers (the picker's order). */
  readonly entries: readonly TokenizerEntry[];
  /** The select also offers `anthropic-api`. */
  readonly api: boolean;
}

const SHOWN = TOKENIZERS.filter((entry) => entry.withdrawn !== true);

/** The rows, one per lab in the registry's order. */
export const LAB_ROWS: readonly LabRow[] = SHOWN.map((entry) => entry.lab)
  .filter((lab, index, labs) => labs.indexOf(lab) === index)
  .flatMap((lab) => {
    const own = SHOWN.filter((entry) => entry.lab === lab);
    const primary = own.find((entry) => entry.tier === 'primary');
    if (primary === undefined) return [];
    return [
      { lab, primary, entries: [primary, ...own.filter((entry) => entry !== primary)], api: lab === 'anthropic' },
    ];
  });

/** Every value `r=` and `tsbs:rows` may carry: the non-default choices. */
export const ROW_CHOICES: readonly string[] = LAB_ROWS.flatMap((row) => [
  ...row.entries.slice(1).map((entry) => entry.id),
  ...(row.api ? [ANTHROPIC_API] : []),
]);

/** The lab a non-default choice belongs to. */
function labOf(value: string): LabRow | undefined {
  return LAB_ROWS.find(
    (row) => (row.api && value === ANTHROPIC_API) || row.entries.some((entry) => entry.id === value),
  );
}

/** The defaults with `values` (non-default choices; unknown ones ignored, a later value for the same lab wins) applied. */
function selectionOf(values: readonly string[]): Record<Lab, RowChoice> {
  const selection = Object.fromEntries(LAB_ROWS.map((row) => [row.lab, row.primary.id])) as Record<Lab, RowChoice>;
  for (const value of values) {
    const row = labOf(value);
    if (row !== undefined) selection[row.lab] = value as RowChoice;
  }
  return selection;
}

export class CompareRows {
  /** The choice of each lab's row. */
  selection: Readonly<Record<Lab, RowChoice>> = $state.raw(selectionOf([]));

  /**
   * `url`: the `r=` values of the page URL (validated by `parseUrlState`); without them the stored choices apply.
   * `stored`: the `tsbs:rows` value (read from localStorage by default).
   */
  constructor(url?: readonly string[], stored: string | null = readStored(STORAGE_KEYS.rows)) {
    this.selection = selectionOf(url ?? (stored ?? '').split(','));
  }

  /** The rows in display order. */
  get labs(): readonly LabRow[] {
    return LAB_ROWS;
  }

  /** The choice of `lab`'s row. */
  choice(lab: Lab): RowChoice {
    return this.selection[lab];
  }

  /** Switches `lab`'s row to `value` (one of its row's choices) and stores the non-default choices. */
  select(lab: Lab, value: RowChoice): void {
    const row = LAB_ROWS.find((candidate) => candidate.lab === lab);
    const allowed =
      row !== undefined && ((row.api && value === ANTHROPIC_API) || row.entries.some((entry) => entry.id === value));
    if (!allowed || this.selection[lab] === value) return;
    this.selection = { ...this.selection, [lab]: value };
    const values = this.nonDefault();
    if (values.length === 0) removeStored(STORAGE_KEYS.rows);
    else writeStored(STORAGE_KEYS.rows, values.join(','));
  }

  /** The registry entry `lab`'s row shows, or null in the API mode. */
  entryFor(lab: Lab): TokenizerEntry | null {
    const value = this.selection[lab];
    return SHOWN.find((entry) => entry.id === value) ?? null;
  }

  /** The tokenizers the rows show, in row order (the notices union and the rows' hub entries). */
  visibleTokenizers(): TokenizerId[] {
    return LAB_ROWS.flatMap((row) => this.entryFor(row.lab)?.id ?? []);
  }

  /** The choices that differ from the defaults, in row order (`r=` and `tsbs:rows`). */
  nonDefault(): string[] {
    return LAB_ROWS.flatMap((row) => (this.selection[row.lab] === row.primary.id ? [] : [this.selection[row.lab]]));
  }
}

/**
 * What a row draws: `current` (its result answers the analysed text), `stale` (the last result, kept muted while a loaded
 * tokenizer encodes the new text: one render per keystroke, as the board does), `loading` (its tokenizer loads; the
 * caption says how far), `waiting` (no result yet, nothing loading), `onDemand` (an on-demand tier waits for "Tokenize
 * now", AD-27), `error` (the caption shows it with its action, in an on-demand tier too) or `api` (the Anthropic API-key
 * mode).
 */
export type RowState = 'current' | 'stale' | 'loading' | 'waiting' | 'onDemand' | 'error' | 'api';

export interface RowStateInput {
  readonly api: boolean;
  readonly result: TokenizationResult | null;
  /** The analysed text. */
  readonly text: string;
  /** The row's tokenizer is resident in its Worker. */
  readonly loaded: boolean;
  readonly loading: boolean;
  readonly failed: boolean;
  /** The text is in an on-demand tier. */
  readonly onDemand: boolean;
}

/** The state of a row (see `RowState`); its chips come from `result` in the `current` and `stale` states only. */
export function rowState(input: RowStateInput): RowState {
  if (input.api) return 'api';
  if (input.result?.input.text === input.text) return 'current';
  if (input.failed) return 'error';
  if (input.onDemand) return 'onDemand';
  if (input.result !== null && input.loaded) return 'stale';
  return input.loading ? 'loading' : 'waiting';
}

/**
 * The rows' part of an on-demand run (AD-27): `request` for each of `ids` on `text`, one after another, so no two rows'
 * whole-text results arrive at once, while `current()` holds (the text has not moved on). Every hub request settles — a
 * result, an error (a failed load included) or `none` — so a row that fails never holds up the rows after it.
 */
export async function runRows(
  ids: readonly TokenizerId[],
  text: string,
  request: (id: TokenizerId, text: string) => Promise<HubAnswer>,
  current: () => boolean,
): Promise<void> {
  for (const id of ids) {
    if (!current()) return;
    await request(id, text);
  }
}
