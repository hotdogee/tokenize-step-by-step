/**
 * WP10 × the real CSP (05 §13, 06 §6): `public/_headers` — replayed verbatim by `headersMiddleware()` on `vite preview`
 * (PA-2b) — admits `connect-src 'self' https://api.anthropic.com https://api.x.ai` and nothing else. A request to any
 * other host is blocked before it leaves the page (a `connect-src` violation, fetch rejects); the two provider hosts
 * pass the policy (here they are mocked with `page.route`, which only sees requests the CSP let through).
 */
import { expect, test } from '@playwright/test';
import { watchPage } from '../support/page-guards.ts';
import { ANTHROPIC_URL, mockProvider, openPage, XAI_URL } from './byok-helpers.ts';

test('the CSP blocks a request to any host other than the two providers', async ({ page }) => {
  const guards = await watchPage(page);
  const reached: string[] = [];
  await page.route('https://example.com/**', async (route) => {
    reached.push(route.request().url());
    await route.fulfill({ status: 200, body: 'ok', headers: { 'access-control-allow-origin': '*' } });
  });
  await mockProvider(page, ANTHROPIC_URL, () => ({ status: 200, body: { input_tokens: 1 } }));
  await mockProvider(page, XAI_URL, () => ({ status: 200, body: { token_ids: [] } }));
  await openPage(page);

  const outcome = await page.evaluate(async () => {
    const attempt = async (url: string, init?: RequestInit): Promise<string> => {
      try {
        const response = await fetch(url, { credentials: 'omit', ...init });
        return `status ${String(response.status)}`;
      } catch {
        return 'blocked';
      }
    };
    const json = { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}' };
    return {
      other: await attempt('https://example.com/collect', json),
      lookalike: await attempt('https://api.anthropic.com.example.com/v1/messages/count_tokens', json),
      anthropic: await attempt('https://api.anthropic.com/v1/messages/count_tokens', json),
      xai: await attempt('https://api.x.ai/v1/tokenize-text', json),
    };
  });
  expect(outcome).toEqual({ other: 'blocked', lookalike: 'blocked', anthropic: 'status 200', xai: 'status 200' });
  expect(reached).toEqual([]);
  const violations = await guards.cspViolations();
  expect(violations.some((line) => line.includes('connect-src') && line.includes('example.com'))).toBe(true);
  expect(
    violations.some((line) => /api\.x\.ai|api\.anthropic\.com\/v1/.test(line) && !line.includes('example.com')),
  ).toBe(false);
});
