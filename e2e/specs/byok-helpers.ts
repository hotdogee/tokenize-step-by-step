/**
 * Shared steps of the WP10 BYOK suites (byok*.spec.ts): provider mocks through `page.route` on both hosts (CORS preflight
 * answered, every POST captured with its headers and body), the page under `?mock=1` (precomputed examples, so the
 * paired tokenizers' results are the golden fixtures'), opening the drawer, and the "the key is nowhere" sweep over web
 * storage, IndexedDB, cookies, the URL and the console.
 */
import { expect, type Page, type Request } from '@playwright/test';
import { pickTokenizer } from './shell-helpers.ts';

export const ANTHROPIC_URL = 'https://api.anthropic.com/v1/messages/count_tokens';
export const XAI_URL = 'https://api.x.ai/v1/tokenize-text';

/** What one mocked POST received. */
export interface Captured {
  readonly headers: Readonly<Record<string, string>>;
  readonly body: unknown;
}

/** A mocked answer: status + JSON body. */
export interface MockAnswer {
  readonly status: number;
  readonly body: unknown;
}

/**
 * `'cors-refused'` simulates a provider answering without CORS headers (a zero-data-retention organisation). A response
 * fulfilled through `page.route` bypasses the CORS check in all three Playwright engines (measured on chromium, firefox
 * and webkit), so the refusal is simulated as what page script observes of it: the fetch rejects with no status, which
 * is indistinguishable from a network failure by design of CORS.
 */
export type MockReply = MockAnswer | 'cors-refused';

/** Headers the browser adds on its own (filtered out before asserting the page's headers exactly). */
const BROWSER_HEADERS =
  /^(sec-|user-agent$|accept|origin$|referer$|content-length$|host$|connection$|priority$|cache-control$|pragma$)/;

/** The headers the page set, by lower-case name. */
export function pageHeaders(captured: Captured): Record<string, string> {
  return Object.fromEntries(Object.entries(captured.headers).filter(([name]) => !BROWSER_HEADERS.test(name)));
}

/** Mocks `url`: answers the CORS preflight and replies to each POST with `reply(request)`; returns the captured POSTs. */
export async function mockProvider(
  page: Page,
  url: string,
  reply: (request: Request) => MockReply,
): Promise<Captured[]> {
  const captured: Captured[] = [];
  await page.route(url, async (route) => {
    const request = route.request();
    if (request.method() === 'OPTIONS') {
      await route.fulfill({
        status: 204,
        headers: {
          'access-control-allow-origin': '*',
          'access-control-allow-methods': 'POST',
          'access-control-allow-headers': request.headers()['access-control-request-headers'] ?? '',
          'access-control-max-age': '0',
        },
      });
      return;
    }
    captured.push({ headers: await request.allHeaders(), body: request.postDataJSON() as unknown });
    const answer = reply(request);
    if (answer === 'cors-refused') {
      await route.abort('failed');
      return;
    }
    await route.fulfill({
      status: answer.status,
      contentType: 'application/json',
      headers: { 'access-control-allow-origin': '*' },
      body: JSON.stringify(answer.body),
    });
  });
  return captured;
}

/** Console text seen so far (every message, every level). */
export function recordConsole(page: Page): string[] {
  const lines: string[] = [];
  page.on('console', (message) => lines.push(message.text()));
  page.on('pageerror', (error) => lines.push(String(error)));
  return lines;
}

/** Opens `/` in English with the precomputed-examples client and, optionally, selects a tokenizer. */
export async function openPage(page: Page, tokenizer?: string): Promise<void> {
  await page.goto('/?lang=en&mock=1');
  await expect(page.locator('[data-source="live"]')).toBeVisible();
  if (tokenizer !== undefined) {
    await pickTokenizer(page, tokenizer);
    await expect(page.getByTestId('picker-button')).toContainText(tokenizer);
  }
  await expect(page.locator('[role="grid"][data-testid="board-grid"]')).not.toHaveAttribute('data-pending', '');
}

/** Opens the live-check drawer and waits for its lazy body. */
export async function openDrawer(page: Page): Promise<void> {
  const toggle = page.getByTestId('live-check-toggle');
  await toggle.click();
  await expect(toggle).toHaveAttribute('aria-expanded', 'true');
  await expect(page.getByTestId('byok-warning')).toBeVisible();
}

/** Everything the page could have persisted or leaked, as one string to search for the key. */
export async function persistedEverywhere(page: Page): Promise<string> {
  const inPage = await page.evaluate(async () => {
    const parts: string[] = [location.href, document.cookie];
    for (const store of [localStorage, sessionStorage])
      for (let i = 0; i < store.length; i++) {
        const name = store.key(i) ?? '';
        parts.push(name, store.getItem(name) ?? '');
      }
    const databases = 'databases' in indexedDB ? await indexedDB.databases() : [];
    parts.push(JSON.stringify(databases));
    return parts.join('\n');
  });
  const cookies = await page.context().cookies();
  return `${inPage}\n${JSON.stringify(cookies)}`;
}

/** Asserts that the page has no IndexedDB database at all (BYOK never opens one). */
export async function expectNoIndexedDb(page: Page): Promise<void> {
  const names = await page.evaluate(async () =>
    'databases' in indexedDB ? (await indexedDB.databases()).map((db) => db.name ?? '') : [],
  );
  expect(names).toEqual([]);
}
