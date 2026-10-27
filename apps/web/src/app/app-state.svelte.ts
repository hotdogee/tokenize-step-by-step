/**
 * Application state (05 §1.1, Svelte 5 runes) and the controller that drives the board, the rail, the inspector and the
 * drawer from one place (WP13 integration), over the result hub (`result-hub.svelte.ts`, PA-19: one Worker per tokenizer).
 * (The design calls this file `app.svelte.ts`; on case-insensitive file systems TypeScript resolves `./App.svelte` to
 * `App.svelte.ts` first, which collides with that name, hence `app-state.svelte.ts`.)
 *
 * The field set is the design's `AppState`; `theme` and `locale` live in their own stores and are mirrored as getters.
 *
 * - **Results.** `result` is the latest accepted result; `resultSource` says whether it came from the precomputed
 *   examples (AD-16; also while a tokenizer loads, for every example chip) or from the engine. Every result is an answer
 *   of the hub's entry for the board's tokenizer and options (`hub.request`; the table's row of the same tokenizer shares
 *   it when the options agree). Requests carry one sequence number (`seq`, AD-21): an answer older than the latest
 *   request is dropped, a superseded encode settles as `cancelled` and is never an error, an encode issued while the
 *   tokenizer loads is re-issued on `loaded` (pending encode across a load), and keystrokes are coalesced by the 40 ms
 *   debounce (05 §6; PA-12 measures after it). Each tokenizer keeps its own Worker, so a switch loads the new one
 *   alongside (no `unload` at the page level) and a switch back to a loaded one answers at once.
 * - **The board's result** (`board`): the current result when there is one; else the last result kept on screen ("stale":
 *   a keystroke on a loaded tokenizer renders once, when its result arrives — PA-11 — and a tokenizer switch keeps the
 *   last result until the new engine answers); else, only while no tokenizer is loaded for the text, an IME
 *   composition is open or an on-demand tier waits, the text-only board (stops 1–3 live from `analyzeText`, 05 §12).
 *   Long inputs (AD-27, `long-input.ts`) show a 2,000-byte window of the whole-text result around the caret.
 * - **Crossfade.** When the engine's first answer replaces a precomputed result, or a new tokenizer's answer replaces
 *   another's, the change runs inside the page's switch crossfade (`setResultTransition`, a View Transition) — skipped
 *   above 8 MB, where the previous result is released before the new one is accepted (AD-27). Released means
 *   unreachable: no field keeps the whole-text result (`#slice` goes with it, and the counts line keeps only the last
 *   on-demand run's counts, `OnDemandRun`), so it is collectable before the next one arrives.
 * - **Focus** and **pin** are byte offsets into the analysed text (AD-17), absolute even while the board shows a window
 *   (the board converts at its boundary with `BoardState.offset`); they survive re-tokenization, tokenizer switches and
 *   window moves and are clamped to a shorter text. The board restores DOM focus from them.
 * - **URL state** (`url-state.ts`) is read once by `bootstrap.ts`; a deep link's merge step is re-applied when the live
 *   result arrives (the precomputed one may have no timeline).
 */
import type {
  AssetSummary,
  EncodeOptions,
  LoadedInfo,
  Progress,
  TextLangChoice,
  TokenizationResult,
  TokenizerId,
} from '@tsbs/core';
import type { ExampleChip, TokenizerEntry } from '@tsbs/registry';
import type { CellSize } from '@tsbs/ui-tokens';
import { DEFAULT_OPTIONS } from '@tsbs/core/model/result';
import { textOnlyResult } from '../board/text-only.ts';
import { viewOf } from '../board/view-cache.ts';
import { i18n } from '../i18n/locale.svelte.ts';
import { resolveTextLang } from '../i18n/text-lang.ts';
import type { Locale } from '../i18n/types.ts';
import { preferences } from '../shell/preferences.svelte.ts';
import { theme, type ThemeChoice } from '../theme/theme.svelte.ts';
import { DEFAULT_EXAMPLE } from './constants.ts';
import { isCancelledError, toUiError, type ErrorPhase, type UiError } from './errors.ts';
import { afterFirstPaint } from './load-trigger.ts';
import {
  ANALYSED_MAX,
  analysedText,
  countCodePoints,
  estimatedResultBytes,
  isOnDemand,
  longInputMode,
  RELEASE_ABOVE_BYTES,
  resultBytes,
  traceFor,
  utf8ByteLength,
  WINDOW_BYTES,
  type LongInputMode,
} from './long-input.ts';
import { isNoPrecomputedResult } from './no-precomputed.ts';
import { DEFAULT_TOKENIZER, EXAMPLES, tokenizerEntry } from './registry.ts';
import type { HubAnswer, ResultHub, TokenOptions } from './result-hub.svelte.ts';
import { readStored, STORAGE_KEYS, writeStored } from './storage.ts';
import { textStats } from './text-stats.ts';
import type { UrlState } from './url-state.ts';
import type { ViewResolvers, VocabLookup } from './vocab-lookup.ts';
import type { ViewResolverSource } from '../board/view-cache.ts';
import type * as WindowSliceModule from './window-slice.ts';
import type { ByteWindow } from './window-slice.ts';

export type { UiError } from './errors.ts';
export type { LongInputMode } from './long-input.ts';

export type Stage = 1 | 2 | 3 | 4 | 5 | 6;
export type ByteView = 'hex' | 'dec' | 'both';
export type Tier = 'char' | 'byte' | 'chunk' | 'token';

/** Encode debounce (05 §6: 40 ms collapses the IME compositionend/input pair into one request). */
export const ENCODE_DEBOUNCE_MS = 40;

/**
 * What the board renders: `final` — the result of the current text and tokenizer (or its window); `stale` — the last
 * result, kept until the current one arrives; `text` — the text-only result (no tokens yet).
 */
export interface BoardState {
  readonly result: TokenizationResult;
  readonly kind: 'final' | 'stale' | 'text';
  /** The byte window of a long input's whole-text result (null: the board shows all of it). */
  readonly window: ByteWindow | null;
  /**
   * The analysed-text byte offset of `result`'s byte 0: a long input's window start (also of its text-only window), else
   * 0. The board adds it to the anchors it writes, so `focus` and `pinned` stay absolute (AD-17).
   */
  readonly offset: number;
}

/** The token counts the counts line shows (05 §1). */
export interface TokenCounts {
  readonly tokens: number;
  readonly partialTokens: number;
}

/**
 * What the counts line keeps of the last on-demand run (AD-27): its counts and what they answer — never the result
 * itself, so a released result is unreachable.
 */
interface OnDemandRun extends TokenCounts, TokenOptions {
  readonly tokenizer: TokenizerId;
  /** The analysed text the run tokenized (the counts are stale once the text differs). */
  readonly text: string;
}

/** Runs a result swap inside the page's crossfade (motion/view-transition.ts); resolves once the DOM shows it. */
export type ResultTransition = (update: () => void) => Promise<void>;

const BYTE_VIEWS: readonly ByteView[] = ['hex', 'dec', 'both'];

/** Catalog key of each stop's name (stop 4 says "symbols" instead for SentencePiece, see `announceStage`). */
const STAGE_NAME = {
  1: 'stage.1',
  2: 'stage.2',
  3: 'stage.3',
  4: 'stage.4.chunks',
  5: 'stage.5',
  6: 'stage.6',
} as const;

function readByteView(): ByteView {
  const stored = readStored(STORAGE_KEYS.byteView);
  return BYTE_VIEWS.includes(stored as ByteView) ? (stored as ByteView) : 'hex';
}

function readCellSize(): CellSize {
  const stored = readStored(STORAGE_KEYS.cellSize);
  return stored === 'S' || stored === 'L' ? stored : 'M';
}

function readFlag(key: string, fallback: boolean): boolean {
  const stored = readStored(key);
  return stored === null ? fallback : stored === 'true';
}

/** The encode options a tokenizer starts with: defaults, its registry `defaults`, and only the toggles it declares. */
export function optionsFor(entry: TokenizerEntry, current: EncodeOptions = DEFAULT_OPTIONS): EncodeOptions {
  const merged: EncodeOptions = { ...DEFAULT_OPTIONS, ...entry.defaults, trace: current.trace };
  return {
    ...merged,
    specialTokens: entry.toggles.includes('specialTokens') ? current.specialTokens : merged.specialTokens,
    addBos: entry.toggles.includes('addBos') ? current.addBos : false,
    normalize: entry.toggles.includes('normalize') ? current.normalize : 'none',
  };
}

/** True when `own` and `options` agree on every option that changes tokens. */
function sameTokenOptions(own: TokenOptions, options: TokenOptions): boolean {
  return (
    own.specialTokens === options.specialTokens && own.addBos === options.addBos && own.normalize === options.normalize
  );
}

/** What the counts line keeps of an on-demand run's result (`OnDemandRun`). */
function onDemandRun(result: TokenizationResult): OnDemandRun {
  const { specialTokens, addBos, normalize } = result.options;
  return {
    tokens: result.stats.tokens,
    partialTokens: result.stats.partialTokens,
    tokenizer: result.tokenizer,
    specialTokens,
    addBos,
    normalize,
    text: result.input.text,
  };
}

/** The text-only result of a long text: a window of about `WINDOW_BYTES` bytes around the caret (code-point safe). */
function textWindowRange(text: string, caret: number): readonly [start: number, end: number] {
  // UTF-8 is at most 3 bytes per UTF-16 unit, so this many units cover the window; whole code points only.
  const units = Math.ceil(WINDOW_BYTES / 3);
  const centre = Math.round(Math.min(Math.max(0, caret), text.length) / units) * units;
  let start = Math.max(0, Math.min(centre - units, text.length - 2 * units));
  let end = Math.min(text.length, start + 2 * units);
  const low = (i: number): boolean => i > 0 && i < text.length && (text.charCodeAt(i) & 0xfc00) === 0xdc00;
  if (low(start)) start--;
  if (low(end)) end++;
  return [start, end];
}

export class AppState {
  // ---- 05 §1.1 ----
  text: string = $state(DEFAULT_EXAMPLE);
  textLang: TextLangChoice = $state('zh-Hant');
  tokenizer: TokenizerId = $state(DEFAULT_TOKENIZER);
  options: EncodeOptions = $state.raw(DEFAULT_OPTIONS);
  stage: Stage = $state(6);
  step = $state(0);
  playing = $state(false);
  speed: 0.5 | 1 | 2 = $state(1);
  byteView: ByteView = $state(readByteView());
  graphemes: boolean = $state(readFlag(STORAGE_KEYS.graphemes, true));
  cellSize: CellSize = $state(readCellSize());
  focus: { tier: Tier; byte: number } | null = $state(null);
  pinned: { byte: number; tier: Tier } | null = $state(null);
  inspectorFocus: 'grid' | 'panel' = $state('grid');
  result: TokenizationResult | null = $state.raw(null);
  resultSource: 'precomputed' | 'live' = $state('precomputed');
  loading: Progress | null = $state.raw(null);
  error: UiError | null = $state.raw(null);
  longInput: LongInputMode = $state('live');

  // ---- Shell-only UI state ----
  /** Text of the polite status region (05 §3.5). */
  status = $state('');
  /** True while an IME composition is active in the textarea (05 §6). */
  composing = $state(false);
  /** The textarea caret (UTF-16 offset): the centre of a long input's board window. */
  caret = $state(0);
  /** An on-demand run is in flight (the banner's button shows "tokenizing"). */
  running = $state(false);

  /** Bumps when lookup answers arrive (views built after it carry them). */
  lookupVersion = $state(0);
  /** What App.svelte registers with the view cache (`setViewResolvers`). */
  readonly viewResolvers: ViewResolverSource;

  /** What the board renders (see `BoardState`). */
  readonly board: BoardState = $derived.by(() => this.#boardState());

  /** The results of every tokenizer on the page and their Workers (PA-19); the shell's table reads its rows here. */
  readonly hub: ResultHub;
  /** The hub entry the board holds (its tokenizer and token options), so the hub keeps its result (AD-27). */
  #held: { readonly id: TokenizerId; readonly options: TokenOptions } | null = null;
  #seq = 0;
  #loadSeq = 0;
  #shownSeq = 0;
  #debounce: ReturnType<typeof setTimeout> | undefined;
  #transition: ResultTransition | null = null;
  /** A deep link's merge step, applied when the first live result for the text arrives. */
  #urlStep: number | null = null;
  /**
   * An on-demand run asked for before the tokenizer was loaded: it runs on `loaded`, also after a failed load is retried;
   * it is dropped when the text leaves the on-demand tiers (the short text is encoded live instead).
   */
  #pendingRun = false;
  #started = false;
  /** The last on-demand run's counts (the counts line's source in on-demand tiers, AD-27; not the result). */
  #onDemand: OnDemandRun | null = $state.raw(null);
  /** Code points of `text` (kept with it; `setText` updates both). */
  #codePoints = countCodePoints(DEFAULT_EXAMPLE);
  /**
   * The views' vocabulary resolvers over the board tokenizer's Worker (`vocab-lookup.ts`), imported once that tokenizer is
   * resident: the Worker answers for it alone, so until then every view gets none (not startup code).
   */
  #vocab: VocabLookup | null = null;
  #vocabImport: Promise<void> | null = null;
  /** The window slicer (`window-slice.ts`), imported when a text first reaches an on-demand tier (not startup code). */
  #slicer: typeof WindowSliceModule | null = $state.raw(null);
  #slicerImport: Promise<void> | null = null;
  /** The last window slice (kept while the caret stays inside the same window). */
  #slice: { of: TokenizationResult; start: number; end: number; slice: TokenizationResult } | null = null;
  /** The last text-only window of a long text (`offset`: the UTF-8 bytes before `start`). */
  #textWindow: { text: string; start: number; end: number; offset: number; slice: TokenizationResult } | null = null;
  /** The capped text's analysed prefix, kept for the text it was cut from (emptied once the text is not capped, AD-27). */
  #analysed = { text: '', value: '' };

  /** `hub` holds the page's results (seeded with the inlined default rows, bootstrap.ts); `url` is the page URL's state. */
  constructor(hub: ResultHub, url: UrlState = {}) {
    this.hub = hub;
    const lookupVersion = (): number => this.lookupVersion;
    this.viewResolvers = {
      get version() {
        return lookupVersion();
      },
      resolversFor: (result) => this.#resolversFor(result),
    };
    this.#applyUrl(url);
    this.options = optionsFor(tokenizerEntry(this.tokenizer));
    this.#hold();
    // The seeded entries (the inlined default rows) answer only the default text.
    const seeded = hub.entry(this.tokenizer, this.options);
    if (seeded.result?.input.text === this.text) {
      this.result = seeded.result;
      this.resultSource = seeded.source ?? 'precomputed';
    } else this.#lookupPrecomputed();
    if (typeof document !== 'undefined') document.documentElement.dataset['cellSize'] = this.cellSize;
  }

  /** The resolvers of a view of `result` (see `#vocab`). */
  #resolversFor(result: TokenizationResult): ViewResolvers {
    if (this.#vocab !== null) return this.#vocab.resolversFor(result);
    if (this.#vocabImport === null && this.resident === result.tokenizer)
      this.#vocabImport = import('./vocab-lookup.ts').then(
        ({ VocabLookup }) => {
          const hub = this.hub;
          const board = (): TokenizerId => this.tokenizer;
          this.#vocab = new VocabLookup(
            {
              get resident() {
                return hub.loaded(board()) ? board() : null;
              },
              lookup: (q) => hub.lookup(board(), q),
            },
            () => {
              this.lookupVersion++;
            },
          );
          this.lookupVersion++;
        },
        () => {
          this.#vocabImport = null;
        },
      );
    return {};
  }

  /** The board's tokenizer while it is resident in its Worker, else null. */
  get resident(): TokenizerId | null {
    return this.hub.loaded(this.tokenizer) ? this.tokenizer : null;
  }

  /** Wire sizes for the picker (the Worker's `ready.assets`, AD-11); null until a client reports them. */
  get assets(): AssetSummary | null {
    return this.hub.assets;
  }

  /**
   * Holds the hub entry of the board's tokenizer and token options and lets go of the previous one (AD-27: the hub keeps
   * only results someone shows; the board keeps its own reference to the result on screen). Called before every request,
   * so a direct write to `tokenizer` or `options` is followed too.
   */
  #hold(): void {
    const held = this.#held;
    if (held?.id === this.tokenizer && sameTokenOptions(held.options, this.options)) return;
    const { specialTokens, addBos, normalize } = this.options;
    this.#held = { id: this.tokenizer, options: { specialTokens, addBos, normalize } };
    this.hub.retain(this.#held.id, this.#held.options);
    if (held !== null) this.hub.release(held.id, held.options);
  }

  /**
   * Asks the hub for the board's result of `text` (its precomputed answer while the tokenizer loads, else the engine's)
   * and shows the answer when it is still the latest request's.
   */
  #request(text: string, trace: EncodeOptions['trace'], phase: ErrorPhase, onDemand = false): Promise<void> {
    this.#hold();
    const seq = ++this.#seq;
    return this.hub.request(this.tokenizer, text, this.options, { trace }).then((answer: HubAnswer) => {
      if (seq !== this.#seq) return;
      if (answer.kind === 'result') this.#accept(answer.result, answer.source, seq, onDemand);
      else if (answer.kind === 'error') this.#encodeFailed(answer.error, seq, phase);
    });
  }

  /** Imports the window slicer once (on-demand tiers only; a failed import leaves the text-only window). */
  #loadSlicer(): void {
    this.#slicerImport ??= import('./window-slice.ts').then(
      (module) => {
        this.#slicer = module;
      },
      () => {
        this.#slicerImport = null;
      },
    );
  }

  /** Resolves once the window slicer is loaded (tests; the board re-renders on its own). */
  slicerReady(): Promise<void> {
    this.#loadSlicer();
    return this.#slicerImport ?? Promise.resolve();
  }

  /** Applies what a deep link asks for (invalid values were dropped by `parseUrlState`). */
  #applyUrl(url: UrlState): void {
    if (url.tokenizer !== undefined) this.tokenizer = url.tokenizer;
    if (url.text !== undefined) {
      this.text = url.text;
      this.#codePoints = countCodePoints(url.text);
      this.longInput = longInputMode(this.#codePoints);
      if (isOnDemand(this.longInput)) this.#loadSlicer();
      const chip = EXAMPLES.find((candidate) => candidate.text === url.text);
      this.textLang = chip?.lang ?? 'auto';
    }
    if (url.textLang !== undefined) this.textLang = url.textLang;
    if (url.byteView !== undefined) this.byteView = url.byteView; // this visit only; the stored preference stays
    if (url.stage !== undefined) {
      this.stage = url.stage;
      if (url.stage === 5) {
        this.step = url.step ?? 0;
        this.#urlStep = this.step;
      }
    }
  }

  get theme(): ThemeChoice {
    return theme.choice;
  }

  get locale(): Locale {
    return i18n.current;
  }

  /** The registry entry of the selected tokenizer. */
  get entry(): TokenizerEntry {
    return tokenizerEntry(this.tokenizer);
  }

  /** The part of the text that is analysed (the first 200,000 code points, AD-27). */
  get analysed(): string {
    if (this.longInput !== 'capped') return this.text;
    const text = this.text;
    if (this.#analysed.text !== text) this.#analysed = { text, value: analysedText(text) };
    return this.#analysed.value;
  }

  /** True when `result` answers the current analysed text, tokenizer and token options. */
  #isCurrent(result: TokenizationResult | null): boolean {
    return (
      result !== null &&
      result.tokenizer === this.tokenizer &&
      result.input.text === this.analysed &&
      sameTokenOptions(result.options, this.options)
    );
  }

  #boardState(): BoardState {
    const result = this.result;
    const entry = this.entry;
    if (isOnDemand(this.longInput)) {
      const text = this.analysed;
      const slicer = this.#slicer;
      if (result !== null && slicer !== null && !this.composing && this.#isCurrent(result)) {
        // The caret is an offset into the typed text; an NFKC result maps it through its source map.
        const window = slicer.windowAround(result, slicer.byteAtCaret(result, Math.min(this.caret, text.length)));
        // A caret move inside the same window keeps the same slice object, so the board does not re-render.
        const cached = this.#slice;
        if (cached?.of !== result || cached.start !== window.start || cached.end !== window.end)
          this.#slice = { of: result, start: window.start, end: window.end, slice: slicer.sliceResult(result, window) };
        return { result: this.#slice?.slice ?? result, kind: 'final', window, offset: window.start };
      }
      const [start, end] = textWindowRange(text, this.caret);
      const cached = this.#textWindow;
      if (
        cached?.text !== text ||
        cached.start !== start ||
        cached.end !== end ||
        cached.slice.tokenizer !== this.tokenizer
      )
        this.#textWindow = {
          text,
          start,
          end,
          offset: utf8ByteLength(text.slice(0, start)),
          slice: textOnlyResult(text.slice(start, end), this.tokenizer, entry.family),
        };
      return {
        result: this.#textWindow?.slice ?? textOnlyResult('', this.tokenizer, entry.family),
        kind: 'text',
        window: null,
        offset: this.#textWindow?.offset ?? 0,
      };
    }
    if (this.composing)
      return { result: textOnlyResult(this.text, this.tokenizer, entry.family), kind: 'text', window: null, offset: 0 };
    if (result !== null && this.#isCurrent(result)) return { result, kind: 'final', window: null, offset: 0 };
    // Keep the last result while its successor is on the way: same text on another tokenizer (a switch, AD-19), or a
    // newer text on the loaded tokenizer (render once per keystroke, PA-11).
    if (result !== null && (result.input.text === this.text || this.resident === this.tokenizer))
      return { result, kind: 'stale', window: null, offset: 0 };
    return { result: textOnlyResult(this.text, this.tokenizer, entry.family), kind: 'text', window: null, offset: 0 };
  }

  /** The board's result when it is the current one, else null (stops 4–6 wait for the engine). */
  get currentResult(): TokenizationResult | null {
    const board = this.board;
    return board.kind === 'final' ? board.result : null;
  }

  /**
   * The counts line's tokens · partial: the current result's; in an on-demand tier the last on-demand run's on this
   * tokenizer and token options, even when the text has changed since (shown with the "stale" badge, AD-27) and while
   * the next run is in flight; while an IME composition is open, the last result's on this tokenizer and token options
   * (the provisional text is not encoded, 05 §6; also shown "stale"); while the loaded tokenizer encodes a newer text,
   * the last result's on this tokenizer and token options, as the board keeps it (PA-11; `countsSuperseded`).
   */
  get tokenCounts(): TokenCounts | null {
    if (isOnDemand(this.longInput)) {
      const run = this.#onDemand;
      return run !== null && run.tokenizer === this.tokenizer && sameTokenOptions(run, this.options) ? run : null;
    }
    const result = this.result;
    if (result?.tokenizer !== this.tokenizer || !sameTokenOptions(result.options, this.options)) return null;
    return this.composing || this.resident === this.tokenizer || result.input.text === this.analysed
      ? result.stats
      : null;
  }

  /**
   * The counts line's tokens are the last result's for the debounce plus the encode of a newer text on the loaded
   * tokenizer: shown muted, without the "stale" badge (`resultStale` stays false), so a keystroke swaps nothing.
   */
  get countsSuperseded(): boolean {
    return !isOnDemand(this.longInput) && !this.composing && this.tokenCounts !== null && !this.#isCurrent(this.result);
  }

  /**
   * The counts line's tokens answer another text than the current one (its "stale" badge; `tokenCounts` already holds
   * the tokenizer and token options): the last on-demand run's text in an on-demand tier — edited since, or while the run
   * was in flight (AD-27) — or the last result's during an IME composition. Derived, so no switch or toggle can clear it
   * while the text still differs.
   */
  get resultStale(): boolean {
    if (isOnDemand(this.longInput)) {
      const run = this.#onDemand;
      return run !== null && run.text !== this.analysed;
    }
    return this.composing && this.result !== null && this.result.input.text !== this.analysed;
  }

  /**
   * An on-demand tier whose tokens wait for the banner's button (no run on this tokenizer and token options yet, none in
   * flight): the counts line says so instead of "waiting for the tokenizer".
   */
  get awaitingRun(): boolean {
    return isOnDemand(this.longInput) && !this.running && this.tokenCounts === null;
  }

  /** The merge-step cap of the run on screen when its timeline was truncated (the rail's "limited to …" line). */
  get replayLimit(): number | null {
    const result = this.result;
    const trace = result?.options.trace;
    return result?.timeline?.truncated === true && typeof trace === 'object' ? trace.maxSteps : null;
  }

  /** Installs the crossfade a result swap runs in (App.svelte: the board's View Transition). */
  setResultTransition(transition: ResultTransition | null): void {
    this.#transition = transition;
  }

  /**
   * Loads the board's tokenizer after first paint (06 §3), then encodes the current text live; from then on the hub may
   * load the tokenizers its other views need (PA-19 load policy).
   */
  async start(): Promise<void> {
    await afterFirstPaint();
    this.hub.start();
    if (this.#started) return;
    this.#started = true;
    if (this.resident === this.tokenizer || this.loading?.tokenizer === this.tokenizer) return;
    await this.#load(this.tokenizer, null);
  }

  /**
   * Switches the board to `id`: the hub entry the board reads changes, and `id` loads in its own Worker unless it is
   * resident there already (PA-19; AD-19 holds per Worker, so the previous tokenizer stays loaded and nothing is
   * unloaded here). The last result stays on the board until the new one answers.
   */
  async selectTokenizer(id: TokenizerId): Promise<void> {
    if (id === this.tokenizer && (this.resident === id || this.loading?.tokenizer === id)) return;
    const previous = this.tokenizer;
    this.tokenizer = id;
    this.options = optionsFor(tokenizerEntry(id), this.options);
    this.error = null;
    this.#started = true;
    this.#hold();
    if (this.resident === id) {
      // Resident in its Worker already: no load (a load of another tokenizer still on its way is dropped).
      this.#loadSeq++;
      this.loading = null;
      this.#ready();
      return;
    }
    this.#lookupPrecomputed();
    await this.#load(id, previous);
  }

  async #load(id: TokenizerId, previous: TokenizerId | null): Promise<void> {
    const seq = ++this.#loadSeq;
    const name = tokenizerEntry(id).displayName[i18n.current];
    this.loading = { tokenizer: id, phase: 'cache', loaded: 0, total: null };
    this.announce(i18n.t('status.loading', { name }));
    try {
      const loaded = await this.hub.load(id, (progress) => {
        if (seq === this.#loadSeq) this.loading = progress;
      });
      if (seq !== this.#loadSeq) return;
      this.loading = null;
      this.#rememberLoaded(loaded);
      this.announce(i18n.t('status.ready', { name: tokenizerEntry(id).displayName[i18n.current] }));
      this.#ready();
    } catch (error) {
      if (seq !== this.#loadSeq || isCancelledError(error)) return;
      this.loading = null;
      this.running = false; // a pending run stays asked for: Retry loads again and runs it
      this.error = toUiError(error, id, previous);
    }
  }

  /** The board's tokenizer is resident: run the on-demand run asked for meanwhile, else encode the text live. */
  #ready(): void {
    if (this.#pendingRun && isOnDemand(this.longInput)) void this.runOnDemand();
    else {
      this.#pendingRun = false;
      this.running = false;
      this.encodeNow();
    }
  }

  #rememberLoaded(loaded: LoadedInfo): void {
    writeStored(
      STORAGE_KEYS.lastLoaded,
      JSON.stringify({
        tokenizer: loaded.info.id,
        ms: Math.round(loaded.ms),
        fromCache: loaded.fromCache,
        bytesTransferred: loaded.bytesTransferred,
        layer: loaded.layer,
        contentEncoding: loaded.contentEncoding,
      }),
      'session',
    );
    void this.hub.features(loaded.info.id)?.then(
      (features) => {
        writeStored(STORAGE_KEYS.workerFeatures, JSON.stringify(features), 'session');
        if (!features.cacheApi) this.#cacheNotice(loaded.info.id);
      },
      () => undefined,
    );
  }

  /**
   * 05 §12 "quota is informational": without the Cache API (Safari private mode, blocked storage) the Worker keeps the
   * vocabulary in memory only, and the FROZEN protocol has no warning message, so its `ready.features.cacheApi` is the
   * signal. The informational `quota` toast says so once per session, unless another alert is up (then the next load
   * tries again). A short storage quota with a working cache stays silent (docs/dev.md).
   */
  #cacheNotice(id: TokenizerId): void {
    if (this.error !== null || readStored(STORAGE_KEYS.cacheNotice, 'session') !== null) return;
    writeStored(STORAGE_KEYS.cacheNotice, '1', 'session');
    this.error = { code: 'quota', message: '', retryable: false, tokenizer: id, previous: null };
  }

  /**
   * Updates the text and its long-input tier; tokenizes after the debounce unless an IME composition is active (05 §6)
   * or the tier is on demand (AD-27). `immediate` (a paste) skips the debounce.
   */
  setText(text: string, immediate = false): void {
    const was = this.longInput;
    this.text = text;
    this.#codePoints = countCodePoints(text);
    this.longInput = longInputMode(this.#codePoints);
    // AD-27: nothing is held across results; a capped text's prefix goes with the tier.
    if (this.longInput !== 'capped') this.#analysed = { text: '', value: '' };
    if (isOnDemand(this.longInput)) {
      this.#loadSlicer();
      this.#announceTier(was);
      return;
    }
    // Back below the on-demand tiers: the whole-text run is never shown again (a window only exists there), so it is
    // released now instead of being kept on the board as the "stale" result of a short text. A run asked for while the
    // tokenizer loads, or still in flight (its answer is dropped by the new seq), no longer applies: the short text is
    // encoded live.
    if (isOnDemand(was)) {
      this.#release();
      this.#onDemand = null;
      this.#textWindow = null;
      this.#pendingRun = false;
      this.running = false;
      this.#seq++;
    }
    if (this.composing) return;
    if (immediate) this.encodeNow();
    else this.scheduleEncode();
  }

  /**
   * Says an on-demand tier change in the always-mounted status region (05 §6): the banner is lazy-mounted with its text,
   * and screen readers often skip a live region inserted with its content already present.
   */
  #announceTier(was: LongInputMode): void {
    const parts: string[] = [];
    if (!isOnDemand(was)) parts.push(i18n.t('longInput.banner'));
    if (this.longInput === 'capped' && was !== 'capped') parts.push(i18n.t('longInput.capped', { n: ANALYSED_MAX }));
    if (parts.length > 0) this.announce(parts.join(' '));
  }

  /** The textarea caret moved (UTF-16 offset). */
  setCaret(utf16: number): void {
    if (utf16 !== this.caret) this.caret = utf16;
  }

  /** Debounced encode (40 ms). */
  scheduleEncode(): void {
    clearTimeout(this.#debounce);
    this.#debounce = setTimeout(() => {
      this.encodeNow();
    }, ENCODE_DEBOUNCE_MS);
  }

  /**
   * Tokenizes the current text now (live tiers): through the engine when it is resident; while it loads, from the
   * precomputed examples (the encode itself is re-issued on `loaded`). Answers to superseded requests are dropped.
   */
  encodeNow(): void {
    clearTimeout(this.#debounce);
    if (isOnDemand(this.longInput) || this.composing) return;
    if (this.resident !== this.tokenizer) {
      this.#lookupPrecomputed();
      return;
    }
    void this.#request(this.text, traceFor(this.#codePoints), 'encode');
  }

  /** The on-demand run (AD-27): the WHOLE analysed text, with the trace policy of its length. */
  async runOnDemand(): Promise<void> {
    if (!isOnDemand(this.longInput)) return;
    if (this.resident !== this.tokenizer) {
      this.#pendingRun = true;
      this.running = true;
      if (!this.#started) await this.start();
      // Nothing loading (a failed load was dismissed): load again, the run follows on `loaded`.
      else if (this.loading?.tokenizer !== this.tokenizer) await this.#load(this.tokenizer, null);
      return;
    }
    this.#pendingRun = false;
    const text = this.analysed;
    const trace = traceFor(countCodePoints(text));
    this.running = true;
    // AD-27: never hold two big results at once — release the previous one before the new one exists.
    if (estimatedResultBytes(utf8ByteLength(text), trace) > RELEASE_ABOVE_BYTES) this.#release();
    const run = this.#request(text, trace, 'run', true);
    const seq = this.#seq;
    await run;
    if (seq === this.#seq) this.running = false;
  }

  #encodeFailed(error: unknown, seq: number, phase: ErrorPhase): void {
    if (seq !== this.#seq || isCancelledError(error)) return;
    // ?mock=1 has no result for free text: tokens wait, and the board shows the text alone instead of the last result.
    if (isNoPrecomputedResult(error)) {
      this.#release();
      return;
    }
    this.error = toUiError(error, this.tokenizer, null, phase);
  }

  /**
   * While the engine loads: the precomputed result of the text, if it is an example chip (AD-16). The hub keeps the
   * request, so the encode follows on `loaded` (and free text asks the hub for the load once the page has painted).
   */
  #lookupPrecomputed(): void {
    if (isOnDemand(this.longInput) || this.#isCurrent(this.result)) return;
    void this.#request(this.text, traceFor(this.#codePoints), 'encode');
  }

  /**
   * Drops every reference to the whole-text result — `result`, its window slice (`#slice.of`) and the hub entry's copy
   * — so it is collectable before a result above 8 MB arrives (AD-27). The last run's counts (`#onDemand`) hold no result
   * and stay.
   */
  #release(): void {
    this.result = null;
    this.#slice = null;
    const held = this.#held;
    if (held !== null) this.hub.forget(held.id, held.options);
  }

  /**
   * Puts `result` on screen (see the module comment for the crossfade and the 8 MB rule). `onDemand`: the result of an
   * on-demand run, whose counts the counts line keeps; any other result drops the last run's counts.
   */
  #accept(result: TokenizationResult, source: 'precomputed' | 'live', seq: number, onDemand = false): void {
    const update = (): void => {
      if (seq < this.#shownSeq) return; // a newer result was shown while this one waited for its transition
      this.#shownSeq = seq;
      this.#slice = null; // the previous result's window
      this.#onDemand = onDemand ? onDemandRun(result) : null;
      this.result = result;
      this.resultSource = source;
      this.running = false;
      this.#clampAnchors(result.utf8.length);
      if (this.#urlStep !== null && source === 'live' && this.#isCurrent(result)) {
        if (this.stage === 5) this.step = Math.min(this.#urlStep, result.timeline?.stepCount ?? 0);
        this.#urlStep = null;
      }
    };
    if (resultBytes(result) > RELEASE_ABOVE_BYTES) {
      // Release the previous result first (the hub replaced its own copy already); no crossfade above 8 MB.
      this.result = null;
      this.#slice = null;
      update();
      return;
    }
    const previous = this.result;
    const swap =
      previous !== null &&
      (previous.tokenizer !== result.tokenizer || (this.resultSource === 'precomputed' && source === 'live'));
    if (swap && this.#transition !== null) void this.#transition(update);
    else update();
  }

  /** Keeps the focus and pin anchors inside a shorter text (byte offsets, AD-17). */
  #clampAnchors(bytes: number): void {
    const last = Math.max(0, bytes - 1);
    if (this.focus !== null && this.focus.byte > last) this.focus = { tier: this.focus.tier, byte: last };
    if (this.pinned !== null && this.pinned.byte > last) this.pinned = { byte: last, tier: this.pinned.tier };
  }

  /** Applies an example chip: verbatim text and its text-language choice; tokenizes immediately. */
  chooseExample(chip: Pick<ExampleChip, 'text' | 'lang'>): void {
    this.textLang = chip.lang;
    this.setText(chip.text, true);
  }

  /** Sets one encode option (only the toggles the tokenizer declares are shown). */
  setOption<K extends 'specialTokens' | 'addBos' | 'normalize'>(key: K, value: EncodeOptions[K]): void {
    this.options = { ...this.options, [key]: value };
    // An on-demand tier waits for the button: `tokenCounts` shows the last run only on its own options.
    if (!isOnDemand(this.longInput)) this.encodeNow();
  }

  setByteView(view: ByteView): void {
    this.byteView = view;
    writeStored(STORAGE_KEYS.byteView, view);
  }

  /** `h`: hex → dec → both (both only when the viewport is ≥ 1024 px). */
  cycleByteView(wide: boolean): void {
    const order: readonly ByteView[] = wide ? BYTE_VIEWS : ['hex', 'dec'];
    const next = order[(order.indexOf(this.byteView) + 1) % order.length] ?? 'hex';
    this.setByteView(next);
  }

  setGraphemes(on: boolean): void {
    this.graphemes = on;
    writeStored(STORAGE_KEYS.graphemes, String(on));
  }

  /** WCAG 2.1.4 setting (shared with About › Keyboard through the preferences store). */
  get singleKeyShortcuts(): boolean {
    return preferences.singleKeyShortcuts;
  }

  setSingleKeyShortcuts(on: boolean): void {
    preferences.setSingleKeyShortcuts(on);
  }

  setCellSize(size: CellSize): void {
    this.cellSize = size;
    writeStored(STORAGE_KEYS.cellSize, size);
    if (typeof document !== 'undefined') document.documentElement.dataset['cellSize'] = size;
  }

  /** Steps in the current result's merge timeline (0 when there is none). */
  get stepCount(): number {
    return this.currentResult?.timeline?.stepCount ?? 0;
  }

  /** `[` / `]` and `1`–`6`. */
  setStage(stage: Stage): void {
    this.stage = stage;
    if (stage === 6) this.step = this.stepCount;
    else if (stage < 5) this.step = 0;
  }

  moveStage(delta: -1 | 1): void {
    this.setStage(Math.min(6, Math.max(1, this.stage + delta)) as Stage);
  }

  /**
   * `,` / `.` (Shift ×10): past the end → stop 6, before the start → stop 4 (05 §8). One line of positions, so ±1 and
   * ±10 behave the same at both ends: stops 1–4 are position −1, stop 5 at step k is k (0…count), stop 6 is count + 1.
   * A backward move from stops 1–3 stays put (it would otherwise jump forward to stop 4).
   */
  moveStep(delta: number): void {
    const count = this.stepCount;
    const position = this.stage === 6 ? count + 1 : this.stage < 5 ? -1 : this.step;
    const next = position + delta;
    if (next > count) {
      this.setStage(6);
    } else if (next >= 0) {
      this.stage = 5;
      this.step = next;
    } else if (this.stage >= 4) {
      this.setStage(4);
    }
  }

  /** Says the stop and its count in the status region, "UTF-8 bytes: 12 bytes" (05 §8): for the keys and rail radios. */
  announceStage(): void {
    const stage = this.stage;
    const spm = this.entry.family === 'spm-bpe';
    const name = stage === 4 && spm ? i18n.t('stage.4.symbols') : i18n.t(STAGE_NAME[stage]);
    const result = this.currentResult;
    let detail: string;
    if (stage <= 2) detail = i18n.t('counts.codePoints', { n: textStats(this.analysed, 0).codePoints });
    else if (stage === 3) detail = i18n.t('counts.bytes', { n: textStats(this.analysed, 0).bytes });
    else if (result === null) detail = i18n.t('counts.tokensPending');
    else if (stage === 4 && spm) detail = i18n.t('counts.symbols', { n: this.#symbolCount(result) });
    else if (stage === 4) detail = i18n.t('counts.chunks', { n: result.stats.chunks });
    else if (stage === 5) detail = i18n.t('counts.steps', { n: result.timeline?.stepCount ?? result.stats.mergeSteps });
    else detail = i18n.t('counts.tokens', { n: result.stats.tokens });
    this.announce(i18n.t('status.stage', { name, detail }));
  }

  /** SentencePiece's stop 4: the symbols the board shows before any merge (the parts at step 0 of the shared view). */
  #symbolCount(result: TokenizationResult): number {
    const view = viewOf(result, resolveTextLang(this.textLang, this.text, i18n.current));
    return view.partsAt(0).partStart.length - 1;
  }

  /** Puts `message` in the polite status region (re-announces identical text). */
  announce(message: string): void {
    this.status = this.status === message ? `${message}\u00a0` : message;
  }

  /**
   * The error's action (errors.ts): reload the page (`fetch`, `format`), back to the previous tokenizer (its Worker)
   * (an `oom` of a load; one of a tokenization offers no action), else tokenize again — the on-demand run in an on-demand
   * tier — after reloading the tokenizer when it is not resident.
   */
  async recover(): Promise<void> {
    const error = this.error;
    if (error === null) return;
    this.error = null;
    if ((error.code === 'fetch' && !error.retryable) || error.code === 'format') {
      location.reload();
      return;
    }
    if (error.code === 'oom') {
      if ((error.phase ?? 'load') === 'load') await this.selectTokenizer(error.previous ?? DEFAULT_TOKENIZER);
      return;
    }
    if (this.resident === error.tokenizer) {
      if (isOnDemand(this.longInput)) await this.runOnDemand();
      else this.encodeNow();
      return;
    }
    if (error.phase === 'run' && isOnDemand(this.longInput)) this.#pendingRun = true; // runs again on `loaded`
    await this.#load(error.tokenizer, error.previous);
  }

  dismissError(): void {
    this.error = null;
  }
}
