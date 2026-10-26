/**
 * Shared setup for the WP06 shell suites (shell-*.spec.ts): locale via `?lang`, theme via the persisted choice that
 * boot.js reads before first paint, and a wait for the shell to be interactive (the default tokenizer's live result).
 */
import { expect, type Page } from '@playwright/test';

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

/**
 * Opens `/` in `locale` and waits until the default tokenizer has answered (counts badge "live"). The wait is a setup
 * step, not an assertion: the load budget itself is the perf spec's (06 §3), so it allows for a loaded CI runner.
 */
export async function openShell(page: Page, locale: Locale): Promise<void> {
  await page.goto(`/?lang=${locale}`);
  await expect(page.locator('html')).toHaveAttribute('lang', locale);
  await expect(page.locator('[data-source="live"]')).toBeVisible({ timeout: LIVE_READY_TIMEOUT_MS });
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
    const source = document.querySelector('[data-source]')?.getAttribute('data-source') ?? '';
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
 * (not for the vocabulary: callers check loads, errors and held downloads themselves). Returns the tokenizer id.
 */
export async function pickTokenizer(page: Page, name: string): Promise<string> {
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
