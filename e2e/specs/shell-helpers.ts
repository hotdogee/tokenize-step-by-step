/**
 * Shared setup for the WP06 shell suites (shell-*.spec.ts): locale via `?lang`, theme via the persisted choice that
 * boot.js reads before first paint, a wait for the shell to be interactive (the comparison table's OpenAI row answered
 * live, PA-19) and the Advanced disclosure that holds the board (PA-19: closed by default).
 */
import { expect, type Locator, type Page } from '@playwright/test';

export const LOCALES = ['en', 'zh-TW', 'ja'] as const;
export const THEMES = ['light', 'dark'] as const;
export type Locale = (typeof LOCALES)[number];
export type Theme = (typeof THEMES)[number];

/** Persists a theme choice before any page script runs (boot.js applies it pre-paint) and matches the OS scheme. */
export async function useTheme(page: Page, theme: Theme): Promise<void> {
  await page.addInitScript((choice: string) => {
    try {
      localStorage.setItem('tsbs:theme', choice);
    } catch {
      // storage blocked: boot.js falls back to auto, emulateMedia below still applies
    }
  }, theme);
  await page.emulateMedia({ colorScheme: theme });
}

/** How long `openShell` waits for the live result: every fresh context downloads, verifies and builds o200k (1 MB gzip). */
export const LIVE_READY_TIMEOUT_MS = 15_000;

/** The comparison table's source badge of `lab`'s row (`precomputed` · `live` · `pending`, visually hidden; PA-19). */
export const rowSource = (page: Page, lab = 'openai'): Locator =>
  page.locator(`[data-testid="compare"] [data-row="${lab}"] [data-source]`);

/**
 * Waits until every row of the table shows the live result of the text on screen, so no row loads, encodes or dims any
 * more. The first free-text edit loads the other rows' vocabularies, and each then re-encodes: until that has ended, a
 * measurement of something else can catch a row's work — its dim is a delayed CSS transition, which
 * `document.getAnimations()` counts from the moment the row goes stale, and its results are main-thread tasks.
 */
export async function rowsSettled(page: Page): Promise<void> {
  const rows = page.locator('[data-testid="compare"] .cmp-rowgroup');
  await expect(rows.locator('[data-source="live"]')).toHaveCount(await rows.count(), {
    timeout: LIVE_READY_TIMEOUT_MS,
  });
}

/** The counts line's source badge (the board's tokenizer; inside the Advanced disclosure since PA-19). */
export const boardSource = (page: Page): Locator => page.locator('#advanced [data-source]');

/**
 * Opens `/` in `locale` and waits until the default tokenizer has answered: the table's OpenAI row is "live" (PA-19; the
 * counts line moved into the closed Advanced disclosure). With `advanced`, also opens the disclosure and waits for the
 * board and its live result (the board suites). The wait is a setup step, not an assertion: the load budget itself is
 * the perf spec's (06 §3), so it allows for a loaded CI runner.
 */
export async function openShell(page: Page, locale: Locale, options: { advanced?: boolean } = {}): Promise<void> {
  await page.goto(`/?lang=${locale}`);
  await expect(page.locator('html')).toHaveAttribute('lang', locale);
  await expect(rowSource(page)).toHaveAttribute('data-source', 'live', { timeout: LIVE_READY_TIMEOUT_MS });
  if (options.advanced === true) {
    await openAdvanced(page);
    await expect(boardSource(page)).toHaveAttribute('data-source', 'live', { timeout: LIVE_READY_TIMEOUT_MS });
  }
}

/**
 * Opens the Advanced disclosure (its summary), unless it is open, and waits for the board, which arrives as a lazy chunk
 * the first time (PA-19).
 */
export async function openAdvanced(page: Page): Promise<void> {
  const advanced = page.locator('details#advanced');
  if ((await advanced.getAttribute('open')) === null) await page.getByTestId('advanced-summary').click();
  await expect(advanced).toHaveAttribute('open', '');
  await expect(page.getByTestId('board-grid')).toBeVisible();
}

/** Opens `/about/` in `locale`. */
export async function openAbout(page: Page, locale: Locale): Promise<void> {
  await page.goto(`/about/?lang=${locale}`);
  await expect(page.locator('html')).toHaveAttribute('lang', locale);
  await expect(page.getByTestId('licences')).toBeVisible();
}

/**
 * The board as one snapshot: the displayed result's tokenizer, its source, whether it is pending, and the board's
 * `view-transition-name` (set while a switch or result crossfade runs, removed once it has finished; motion/
 * view-transition.ts). While a View Transition runs, clicks hit its pseudo-elements, not the page.
 */
function boardState(page: Page): Promise<string> {
  return page.evaluate(() => {
    const grid = document.querySelector('[data-testid="board-grid"]');
    const source = document.querySelector('#advanced [data-source]')?.getAttribute('data-source') ?? '';
    const crossfading = document.getElementById('board')?.style.getPropertyValue('view-transition-name') ?? '';
    const pending = String(grid?.hasAttribute('data-pending') ?? true);
    return [grid?.getAttribute('data-tokenizer') ?? '', source, pending, crossfading].join('|');
  });
}

/** Waits until no crossfade runs on the board (one already started has finished). */
export async function crossfadeDone(page: Page): Promise<void> {
  await expect.poll(async () => (await boardState(page)).split('|')[3], { timeout: 5_000 }).toBe('');
}

/**
 * Selects a tokenizer through the picker dialog by (part of) its display name and waits for the switch crossfade to end
 * (not for the vocabulary: callers check loads, errors and held downloads themselves). Returns the tokenizer id. The
 * picker button lives in the Advanced disclosure (PA-19), which this opens first.
 */
export async function pickTokenizer(page: Page, name: string): Promise<string> {
  await openAdvanced(page);
  await page.getByTestId('picker-button').click();
  const dialog = page.getByRole('dialog');
  await expect(dialog).toBeVisible();
  const option = dialog.getByRole('option', { name: new RegExp(name.replace(/[()]/g, '\\$&')) });
  const id = (await option.getAttribute('data-id')) ?? '';
  await option.click();
  await expect(dialog).toBeHidden();
  await crossfadeDone(page);
  return id;
}

/**
 * `pickTokenizer`, then waits for the new tokenizer's live result on a settled board (no crossfade left), so the next
 * click on a chip or on the picker lands on the page, not on a View Transition (the switch, then the precomputed → live
 * swap).
 */
export async function switchTokenizer(page: Page, name: string): Promise<void> {
  const id = await pickTokenizer(page, name);
  await expect.poll(() => boardState(page), { timeout: LIVE_READY_TIMEOUT_MS }).toBe(`${id}|live|false|`);
}
