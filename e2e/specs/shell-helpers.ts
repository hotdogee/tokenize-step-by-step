/**
 * Shared setup for the WP06 shell suites (shell-*.spec.ts): locale via `?lang`, theme via the persisted choice that
 * boot.js reads before first paint, and a wait for the shell to be interactive (the stub client's live result).
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

/** Opens `/` in `locale` and waits until the default tokenizer has answered (counts badge "live"). */
export async function openShell(page: Page, locale: Locale): Promise<void> {
  await page.goto(`/?lang=${locale}`);
  await expect(page.locator('html')).toHaveAttribute('lang', locale);
  await expect(page.locator('[data-source="live"]')).toBeVisible();
}

/** Opens `/about/` in `locale`. */
export async function openAbout(page: Page, locale: Locale): Promise<void> {
  await page.goto(`/about/?lang=${locale}`);
  await expect(page.locator('html')).toHaveAttribute('lang', locale);
  await expect(page.getByTestId('licences')).toBeVisible();
}

/** Selects a tokenizer through the picker dialog by (part of) its display name. */
export async function pickTokenizer(page: Page, name: string): Promise<void> {
  await page.getByTestId('picker-button').click();
  const dialog = page.getByRole('dialog');
  await expect(dialog).toBeVisible();
  await dialog.getByRole('option', { name: new RegExp(name.replace(/[()]/g, '\\$&')) }).click();
  await expect(dialog).toBeHidden();
}
