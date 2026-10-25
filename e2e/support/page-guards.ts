/**
 * Page instrumentation shared by the suites: CSP violations (console messages and `securitypolicyviolation` events, so a
 * blocked inline style is caught in every engine) and the `<html>` attributes as they were at `DOMContentLoaded` — the proof
 * that the classic boot script ran before first paint (AD-15, AD-29).
 */
import type { Page } from '@playwright/test';

/** `<html lang>` and `data-theme` at `DOMContentLoaded`. */
export interface BootSnapshot {
  readonly lang: string | null;
  readonly theme: string | null;
}

/** Accessors for what the instrumentation recorded. */
export interface PageGuards {
  /** Every CSP violation seen so far (console text or `<directive> <blocked URI>`). */
  cspViolations(): Promise<string[]>;
  bootSnapshot(): Promise<BootSnapshot | null>;
}

const CSP_CONSOLE = /Content[- ]Security[- ]Policy/i;

/** Installs the instrumentation; call before `page.goto`. */
export async function watchPage(page: Page): Promise<PageGuards> {
  const consoleViolations: string[] = [];
  page.on('console', (message) => {
    if (CSP_CONSOLE.test(message.text())) consoleViolations.push(message.text());
  });
  await page.addInitScript(() => {
    const store = window as unknown as Record<string, unknown>;
    const events: string[] = [];
    store['__tsbsCsp'] = events;
    document.addEventListener('securitypolicyviolation', (event) => {
      events.push(`${event.violatedDirective} ${event.blockedURI}`);
    });
    document.addEventListener(
      'DOMContentLoaded',
      () => {
        const html = document.documentElement;
        store['__tsbsBoot'] = { lang: html.getAttribute('lang'), theme: html.getAttribute('data-theme') };
      },
      { once: true },
    );
  });
  return {
    async cspViolations() {
      const events = await page.evaluate(
        () => (window as unknown as Record<string, string[] | undefined>)['__tsbsCsp'] ?? [],
      );
      return [...consoleViolations, ...events];
    },
    bootSnapshot() {
      return page.evaluate(() => (window as unknown as Record<string, BootSnapshot | undefined>)['__tsbsBoot'] ?? null);
    },
  };
}
