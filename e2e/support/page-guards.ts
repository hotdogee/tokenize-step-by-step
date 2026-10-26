/**
 * Page instrumentation shared by the suites: CSP violations (console messages and `securitypolicyviolation` events, so a
 * blocked inline style is caught in every engine), uncaught page errors (Playwright's `pageerror`: an uncaught exception
 * or, in WebKit, an unhandled promise rejection such as a skipped View Transition's `AbortError`) and the `<html>`
 * attributes as they were at `DOMContentLoaded` — the proof that the classic boot script ran before first paint (AD-15,
 * AD-29).
 *
 * Page errors raised while a main-frame navigation is in flight — from the moment `page.goto`/`reload`/`goBack`/
 * `goForward` is called or the navigation request starts, until the new document commits (`framenavigated`) — belong to
 * the document being replaced and are kept apart (`teardownErrors`): WebKit cancels the old document's module Worker
 * and dynamic imports when a navigation starts and reports them as uncaught ("Cannot load …/assets/entry-*.js due to
 * access control checks", "Importing a module script failed"; 6 parallel WebKit contexts walking the nine tokenizers
 * by `page.goto` raised them about once per 80 navigations, always between the navigation request and the commit).
 */
import type { Page, Request } from '@playwright/test';

/** `<html lang>` and `data-theme` at `DOMContentLoaded`. */
export interface BootSnapshot {
  readonly lang: string | null;
  readonly theme: string | null;
}

/** Accessors for what the instrumentation recorded. */
export interface PageGuards {
  /** Every CSP violation seen so far (console text or `<directive> <blocked URI>`). */
  cspViolations(): Promise<string[]>;
  /** Every uncaught page error seen so far (`name: message`), except those of a document being navigated away from. */
  pageErrors(): string[];
  /** Errors a document raised while a navigation was replacing it (not failures; kept for diagnostics). */
  teardownErrors(): string[];
  bootSnapshot(): Promise<BootSnapshot | null>;
}

const CSP_CONSOLE = /Content[- ]Security[- ]Policy/i;
const NAVIGATIONS = ['goto', 'reload', 'goBack', 'goForward'] as const;

/** Installs the instrumentation; call before `page.goto`. */
export async function watchPage(page: Page): Promise<PageGuards> {
  const consoleViolations: string[] = [];
  page.on('console', (message) => {
    if (CSP_CONSOLE.test(message.text())) consoleViolations.push(message.text());
  });
  const pageErrors: string[] = [];
  const teardownErrors: string[] = [];
  let navigating = false;
  page.on('pageerror', (error) => {
    (navigating ? teardownErrors : pageErrors).push(`${error.name}: ${error.message}`);
  });
  const isMainNavigation = (request: Request): boolean =>
    request.isNavigationRequest() && request.frame() === page.mainFrame();
  page.on('request', (request) => {
    if (isMainNavigation(request)) navigating = true;
  });
  page.on('requestfailed', (request) => {
    if (isMainNavigation(request)) navigating = false;
  });
  page.on('framenavigated', (frame) => {
    if (frame === page.mainFrame()) navigating = false;
  });
  // The navigation helpers raise the flag before the protocol call, ahead of the request event.
  for (const name of NAVIGATIONS) {
    const navigate = page[name].bind(page) as (...args: unknown[]) => Promise<unknown>;
    Object.assign(page, {
      [name]: async (...args: unknown[]) => {
        navigating = true;
        try {
          return await navigate(...args);
        } finally {
          navigating = false;
        }
      },
    });
  }
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
    pageErrors() {
      return [...pageErrors];
    },
    teardownErrors() {
      return [...teardownErrors];
    },
    bootSnapshot() {
      return page.evaluate(() => (window as unknown as Record<string, BootSnapshot | undefined>)['__tsbsBoot'] ?? null);
    },
  };
}
