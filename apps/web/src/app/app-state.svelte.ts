/**
 * Application state (05 §1.1, Svelte 5 runes) and the shell-level controller around a `TokenizerClientLike`.
 * (The design calls this file `app.svelte.ts`; on case-insensitive file systems TypeScript resolves `./App.svelte` to
 * `App.svelte.ts` first, which collides with that name, hence `app-state.svelte.ts`.)
 *
 * The field set is the design's `AppState`; `theme` and `locale` live in their own stores (theme.svelte.ts,
 * locale.svelte.ts) and are mirrored here as getters. WP13 owns integration (long-input tiers, URL state, crossfades); this
 * controller implements what the shell needs: tokenizer switching with strict one-resident `unload` → `load` and phased
 * progress, debounced encodes with stale-result dropping, example chips, option toggles, persisted view settings,
 * stage/step moves for the global shortcuts, and the polite status / assertive alert messages.
 */
import type {
  AssetSummary,
  EncodeOptions,
  ErrorCode,
  LoadedInfo,
  Progress,
  TextLangChoice,
  TokenizationResult,
  TokenizerClientLike,
  TokenizerId,
} from '@tsbs/core';
import type { ExampleChip, TokenizerEntry } from '@tsbs/registry';
import type { CellSize } from '@tsbs/ui-tokens';
import { DEFAULT_OPTIONS } from '@tsbs/core/model/result';
import { i18n } from '../i18n/locale.svelte.ts';
import type { Locale } from '../i18n/types.ts';
import { preferences } from '../shell/preferences.svelte.ts';
import { theme, type ThemeChoice } from '../theme/theme.svelte.ts';
import { DEFAULT_EXAMPLE } from './constants.ts';
import { isNoPrecomputedResult } from './no-precomputed.ts';
import { DEFAULT_TOKENIZER, tokenizerEntry } from './registry.ts';
import { readStored, STORAGE_KEYS, writeStored } from './storage.ts';

export type Stage = 1 | 2 | 3 | 4 | 5 | 6;
export type ByteView = 'hex' | 'dec' | 'both';
export type Tier = 'char' | 'byte' | 'chunk' | 'token';
export type LongInputMode = 'live' | 'virtualized' | 'on-demand' | 'capped';

/** A user-facing error (05 §12): an `ErrorCode` plus what the alert needs to offer an action. */
export interface UiError {
  readonly code: ErrorCode;
  readonly message: string;
  readonly retryable: boolean;
  readonly tokenizer: TokenizerId;
  /** For `oom`: the tokenizer the back action reloads (AD-19). */
  readonly previous: TokenizerId | null;
}

/** Encode debounce (05 §6: 40 ms collapses the IME compositionend/input pair into one request). */
export const ENCODE_DEBOUNCE_MS = 40;

const BYTE_VIEWS: readonly ByteView[] = ['hex', 'dec', 'both'];

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

/** Resolves after fonts are ready and two animation frames (06 §3 load trigger: the vocabulary never competes with LCP). */
function afterFirstPaint(): Promise<void> {
  if (typeof document === 'undefined' || typeof requestAnimationFrame === 'undefined') return Promise.resolve();
  const frame = (): Promise<void> =>
    new Promise((resolve) => {
      requestAnimationFrame(() => {
        resolve();
      });
    });
  return document.fonts.ready.then(frame).then(frame);
}

function isCancelled(error: unknown): boolean {
  return error instanceof Error && (error.name === 'CancelledError' || error.message === 'cancelled');
}

function toUiError(error: unknown, tokenizer: TokenizerId, previous: TokenizerId | null): UiError {
  const record = (typeof error === 'object' && error !== null ? error : {}) as Partial<
    Record<'code' | 'message' | 'retryable', unknown>
  >;
  const codes: readonly ErrorCode[] = ['fetch', 'integrity', 'format', 'decompress', 'quota', 'not-loaded', 'oom'];
  const code = codes.includes(record.code as ErrorCode) ? (record.code as ErrorCode) : 'internal';
  return {
    code,
    message: typeof record.message === 'string' ? record.message : String(error),
    retryable: record.retryable === true || code === 'integrity',
    tokenizer,
    previous,
  };
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
  resultStale = $state(false);
  loading: Progress | null = $state.raw(null);
  error: UiError | null = $state.raw(null);
  longInput: LongInputMode = $state('live');

  // ---- Shell-only UI state ----
  /** Text of the polite status region (05 §3.5). */
  status = $state('');
  /** Name of the tokenizer whose engine answers (null until the first `loaded`). */
  resident: TokenizerId | null = $state(null);
  /** True while an IME composition is active in the textarea (05 §6). */
  composing = $state(false);
  /** Wire sizes for the picker (the Worker's `ready.assets`, AD-11); null until the client reports them. */
  assets: AssetSummary | null = $state.raw(null);

  readonly #client: TokenizerClientLike;
  #encodeSeq = 0;
  #loadSeq = 0;
  #debounce: ReturnType<typeof setTimeout> | undefined;

  constructor(client: TokenizerClientLike, precomputed: TokenizationResult | null = null) {
    this.#client = client;
    this.result = precomputed;
    this.options = optionsFor(tokenizerEntry(this.tokenizer));
    if (typeof document !== 'undefined') document.documentElement.dataset['cellSize'] = this.cellSize;
    client.onResident((id) => {
      this.resident = id;
    });
    client.assets.then(
      (assets) => {
        this.assets = assets;
      },
      () => {
        this.assets = null;
      },
    );
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

  /** The result when it belongs to the current text and tokenizer, else null (stops 4–6 wait for the engine). */
  get currentResult(): TokenizationResult | null {
    const result = this.result;
    if (result?.input.text !== this.text || result.tokenizer !== this.tokenizer) return null;
    return result;
  }

  /** Loads the default tokenizer after first paint (06 §3), then encodes the current text live. */
  async start(): Promise<void> {
    await afterFirstPaint();
    await this.#load(this.tokenizer, null);
  }

  /** Switches tokenizer: strict one-resident `unload` → `load` (AD-19); the last result stays until the new one answers. */
  async selectTokenizer(id: TokenizerId): Promise<void> {
    if (id === this.tokenizer && (this.resident === id || this.loading?.tokenizer === id)) return;
    const previous = this.resident ?? this.tokenizer;
    this.tokenizer = id;
    this.options = optionsFor(tokenizerEntry(id), this.options);
    this.error = null;
    await this.#client.unload();
    await this.#load(id, previous);
  }

  async #load(id: TokenizerId, previous: TokenizerId | null): Promise<void> {
    const seq = ++this.#loadSeq;
    const name = tokenizerEntry(id).displayName[i18n.current];
    this.loading = { tokenizer: id, phase: 'cache', loaded: 0, total: null };
    this.announce(i18n.t('status.loading', { name }));
    try {
      const loaded = await this.#client.load(id, (progress) => {
        if (seq === this.#loadSeq) this.loading = progress;
      });
      if (seq !== this.#loadSeq) return;
      this.loading = null;
      this.#rememberLoaded(loaded);
      this.announce(i18n.t('status.ready', { name: tokenizerEntry(id).displayName[i18n.current] }));
      this.encodeNow();
    } catch (error) {
      if (seq !== this.#loadSeq || isCancelled(error)) return;
      this.loading = null;
      this.error = toUiError(error, id, previous);
    }
  }

  #rememberLoaded(loaded: LoadedInfo): void {
    writeStored(
      STORAGE_KEYS.lastLoaded,
      JSON.stringify({
        tokenizer: loaded.info.id,
        ms: Math.round(loaded.ms),
        fromCache: loaded.fromCache,
        layer: loaded.layer,
        contentEncoding: loaded.contentEncoding,
      }),
      'session',
    );
  }

  /** Updates the text; encodes after the debounce unless an IME composition is active (05 §6). */
  setText(text: string): void {
    this.text = text;
    if (this.composing) return;
    this.scheduleEncode();
  }

  /** Debounced encode (40 ms). */
  scheduleEncode(): void {
    clearTimeout(this.#debounce);
    this.#debounce = setTimeout(() => {
      this.encodeNow();
    }, ENCODE_DEBOUNCE_MS);
  }

  /** Encodes the current text now; results of superseded requests are dropped (latest wins, AD-21). */
  encodeNow(): void {
    clearTimeout(this.#debounce);
    if (this.resident !== this.tokenizer) return; // queued by the client during a load; re-issued on `loaded`
    const seq = ++this.#encodeSeq;
    const text = this.text;
    this.#client.encode(text, this.options).then(
      (result) => {
        if (seq !== this.#encodeSeq) return;
        this.result = result;
        this.resultSource = 'live';
        this.resultStale = false;
      },
      (error: unknown) => {
        if (seq !== this.#encodeSeq || isCancelled(error)) return;
        if (isNoPrecomputedResult(error)) return; // no engine yet (WP05/WP07): tokens stay "waiting for the tokenizer"
        this.error = toUiError(error, this.tokenizer, null);
      },
    );
  }

  /** Applies an example chip: verbatim text and its text-language choice; encodes immediately. */
  chooseExample(chip: ExampleChip): void {
    this.text = chip.text;
    this.textLang = chip.lang;
    this.encodeNow();
  }

  /** Sets one encode option (only the toggles the tokenizer declares are shown). */
  setOption<K extends 'specialTokens' | 'addBos' | 'normalize'>(key: K, value: EncodeOptions[K]): void {
    this.options = { ...this.options, [key]: value };
    this.encodeNow();
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

  /** `,` / `.` (Shift ×10): past the end → stop 6, before the start → stop 4 (05 §8). */
  moveStep(delta: number): void {
    const count = this.stepCount;
    if (this.stage === 6) {
      if (delta < 0) {
        this.stage = 5;
        this.step = Math.max(0, count + delta + 1);
      }
      return;
    }
    if (this.stage < 5) {
      if (delta > 0) {
        this.stage = 5;
        this.step = Math.min(count, delta - 1);
      }
      return;
    }
    const next = this.step + delta;
    if (next > count) this.setStage(6);
    else if (next < 0) this.setStage(4);
    else this.step = next;
  }

  /** Puts `message` in the polite status region (re-announces identical text). */
  announce(message: string): void {
    this.status = this.status === message ? `${message}\u00a0` : message;
  }

  /** The error's action: reload the page (`fetch`), retry (`integrity`), back to the previous tokenizer (`oom`). */
  async recover(): Promise<void> {
    const error = this.error;
    if (error === null) return;
    this.error = null;
    if (error.code === 'fetch') {
      location.reload();
      return;
    }
    if (error.code === 'oom' && error.previous !== null) {
      await this.selectTokenizer(error.previous);
      return;
    }
    await this.#load(error.tokenizer, error.previous);
  }

  dismissError(): void {
    this.error = null;
  }
}
