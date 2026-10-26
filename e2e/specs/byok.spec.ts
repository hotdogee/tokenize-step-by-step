/**
 * WP10 BYOK live-check panels (05 §13, 06 §1 "BYOK with page.route mocks"), against mocked providers on both hosts:
 * Anthropic success with the request headers asserted exactly per byok.json (Bearer default, x-api-key option,
 * anthropic-version, the browser-access header, the workspace id), 401 / 400 workspace / 429 / CORS failure → their
 * `role="alert"` sentences (the last one the zero-data-retention text); xAI matching, divergent (hatched boundaries on the
 * live tier) and misaligned answers ("could not align …", unaligned strip, no hatching); the key never in
 * localStorage/sessionStorage/IndexedDB/cookies/URL/console, gone after "Forget key" and after collapsing the drawer;
 * the picker's "Claude 3+ → live check" row opening the Anthropic panel. The page runs with `?mock=1`, so the paired
 * tokenizers show their golden-fixture results for the default example 台灣台南.
 */
import { expect, test, type Page } from '@playwright/test';
import { watchPage } from '../support/page-guards.ts';
import {
  ANTHROPIC_URL,
  expectNoIndexedDb,
  mockProvider,
  openDrawer,
  openPage,
  pageHeaders,
  persistedEverywhere,
  recordConsole,
  XAI_URL,
  type MockReply,
} from './byok-helpers.ts';

const ANTHROPIC_KEY = 'sk-ant-e2e-0123456789abcdef';
const XAI_KEY = 'xai-e2e-0123456789abcdef';
const TEXT = '台灣台南';

/** Grok-2 on 台灣台南 (fixtures/xai-grok2.json): [0,3) 15721 · [3,5) 7489 · [5,6) 291 · [6,9) 15721 · [9,12) 12048. */
const GROK2_TOKENS = [
  { token_id: 15721, string_token: '台', token_bytes: [0xe5, 0x8f, 0xb0] },
  { token_id: 7489, string_token: '�', token_bytes: [0xe7, 0x81] },
  { token_id: 291, string_token: '�', token_bytes: [0xa3] },
  { token_id: 15721, string_token: '台', token_bytes: [0xe5, 0x8f, 0xb0] },
  { token_id: 12048, string_token: '南', token_bytes: [0xe5, 0x8d, 0x97] },
];

const anthropicPanel = (page: Page) => page.locator('[data-panel="anthropic-count"]');
const xaiPanel = (page: Page) => page.locator('[data-panel="xai-tokenize"]');

async function countTokens(
  page: Page,
  setup?: (panel: ReturnType<typeof anthropicPanel>) => Promise<void>,
): Promise<void> {
  const panel = anthropicPanel(page);
  await panel.getByTestId('anthropic-key').fill(ANTHROPIC_KEY);
  await setup?.(panel);
  await panel.getByTestId('anthropic-run').click();
}

async function tokenize(page: Page): Promise<void> {
  const panel = xaiPanel(page);
  await panel.getByTestId('xai-key').fill(XAI_KEY);
  await panel.getByTestId('xai-run').click();
}

test.describe('Anthropic count_tokens panel', () => {
  test('success: exact byok.json headers (Bearer default + workspace id), the body, and the legacy-vocabulary count', async ({
    page,
  }) => {
    const guards = await watchPage(page);
    const consoleLines = recordConsole(page);
    const captured = await mockProvider(page, ANTHROPIC_URL, () => ({ status: 200, body: { input_tokens: 30 } }));
    await openPage(page, 'Claude 1/2');
    await expect(page.getByTestId('counts')).toContainText('5 tokens'); // legacy vocabulary on 台灣台南
    await openDrawer(page);
    await countTokens(page, async (panel) => {
      await panel.getByTestId('anthropic-model').selectOption('claude-sonnet-4-6'); // 7 frame tokens
      await panel.getByTestId('anthropic-workspace').fill('wrkspc_e2e');
    });
    await expect(page.getByTestId('anthropic-result')).toHaveText(
      'API total 30 (includes ≈ 7 frame tokens → ≈ 23 content tokens) vs legacy-vocabulary count 5; boundaries are not available',
    );
    expect(captured).toHaveLength(1);
    const [request] = captured;
    if (request === undefined) throw new Error('no request');
    expect(pageHeaders(request)).toEqual({
      'content-type': 'application/json',
      authorization: `Bearer ${ANTHROPIC_KEY}`,
      'anthropic-version': '2026-10-21',
      'anthropic-dangerous-direct-browser-access': 'true',
      'anthropic-workspace-id': 'wrkspc_e2e',
    });
    expect(request.headers['cookie']).toBeUndefined(); // credentials: 'omit'
    expect(request.headers['referer']).toBeUndefined(); // referrerPolicy: 'no-referrer'
    expect(request.body).toEqual({ model: 'claude-sonnet-4-6', messages: [{ role: 'user', content: TEXT }] });

    expect(await persistedEverywhere(page)).not.toContain(ANTHROPIC_KEY);
    await expectNoIndexedDb(page);
    expect(page.url()).not.toContain(ANTHROPIC_KEY);
    expect(consoleLines.join('\n')).not.toContain(ANTHROPIC_KEY);
    expect(await guards.cspViolations()).toEqual([]);
    expect(guards.pageErrors()).toEqual([]);
  });

  test('x-api-key option: the key goes in x-api-key, never in Authorization; no workspace header when empty', async ({
    page,
  }) => {
    const captured = await mockProvider(page, ANTHROPIC_URL, () => ({ status: 200, body: { input_tokens: 12 } }));
    await openPage(page);
    await openDrawer(page);
    await countTokens(page, async (panel) => {
      await panel.getByTestId('auth-x-api-key').check();
    });
    await expect(page.getByTestId('anthropic-result')).toContainText(
      'API total 12 (includes ≈ 8 frame tokens → ≈ 4 content tokens); boundaries are not available',
    );
    const [request] = captured;
    if (request === undefined) throw new Error('no request');
    expect(pageHeaders(request)).toEqual({
      'content-type': 'application/json',
      'x-api-key': ANTHROPIC_KEY,
      'anthropic-version': '2026-10-21',
      'anthropic-dangerous-direct-browser-access': 'true',
    });
    expect(request.body).toEqual({ model: 'claude-opus-5-5', messages: [{ role: 'user', content: TEXT }] });
    // Not on the legacy tokenizer: the panel offers to select it, and then shows the legacy count.
    await page.getByTestId('anthropic-compare').click();
    await expect(page.getByTestId('anthropic-result')).toContainText('vs legacy-vocabulary count 5', {
      timeout: 15_000,
    });
  });

  const failures: ReadonlyArray<readonly [string, MockReply, RegExp]> = [
    [
      '401 → the key',
      { status: 401, body: { type: 'error', error: { type: 'authentication_error', message: 'invalid x-api-key' } } },
      /rejected this API key \(HTTP 401\)/,
    ],
    [
      '400 → the workspace id',
      {
        status: 400,
        body: {
          type: 'error',
          error: {
            type: 'invalid_request_error',
            message: 'anthropic-workspace-id header is required for this API key',
          },
        },
      },
      /needs a workspace id for this key \(HTTP 400\)/,
    ],
    [
      '429 → the rate limit',
      {
        status: 429,
        body: { type: 'error', error: { type: 'rate_limit_error', message: 'Number of requests exceeded' } },
      },
      /Rate limit reached \(HTTP 429\)/,
    ],
    [
      'CORS failure → the zero-data-retention sentence',
      'cors-refused',
      /Zero-data-retention organisations cannot call this endpoint from a browser/,
    ],
  ];

  for (const [name, reply, sentence] of failures) {
    test(`${name} (role="alert")`, async ({ page }) => {
      const consoleLines = recordConsole(page);
      await mockProvider(page, ANTHROPIC_URL, () => reply);
      await openPage(page);
      await openDrawer(page);
      await countTokens(page);
      const alert = anthropicPanel(page).getByRole('alert');
      await expect(alert).toBeVisible();
      await expect(alert).toContainText(sentence);
      await expect(page.getByTestId('anthropic-result')).toHaveText('');
      await expect(anthropicPanel(page).getByTestId('anthropic-run')).toBeEnabled();
      expect(consoleLines.join('\n')).not.toContain(ANTHROPIC_KEY);
      expect(await persistedEverywhere(page)).not.toContain(ANTHROPIC_KEY);
    });
  }

  test('one request per click: the button is disabled while the request is pending', async ({ page }) => {
    let release: () => void = () => undefined;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    let posts = 0;
    await page.route(ANTHROPIC_URL, async (route) => {
      if (route.request().method() === 'OPTIONS') {
        await route.fulfill({
          status: 204,
          headers: {
            'access-control-allow-origin': '*',
            'access-control-allow-methods': 'POST',
            'access-control-allow-headers': route.request().headers()['access-control-request-headers'] ?? '',
          },
        });
        return;
      }
      posts++;
      await gate;
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        headers: { 'access-control-allow-origin': '*' },
        body: JSON.stringify({ input_tokens: 9 }),
      });
    });
    await openPage(page);
    await openDrawer(page);
    await countTokens(page);
    const run = anthropicPanel(page).getByTestId('anthropic-run');
    await expect(run).toBeDisabled();
    release();
    await expect(page.getByTestId('anthropic-result')).toContainText('API total 9');
    await expect(run).toBeEnabled();
    expect(posts).toBe(1);
  });
});

test.describe('xAI tokenize-text panel', () => {
  test('a matching answer: "matches Grok-2 ✓", the live tier under the Grok-2 tier, exact headers', async ({
    page,
  }) => {
    const guards = await watchPage(page);
    const captured = await mockProvider(page, XAI_URL, () => ({ status: 200, body: { token_ids: GROK2_TOKENS } }));
    await openPage(page, 'Grok-2');
    await openDrawer(page);
    await tokenize(page);
    await expect(page.getByTestId('xai-alignment')).toHaveText('matches Grok-2 ✓ on this text');
    const [request] = captured;
    if (request === undefined) throw new Error('no request');
    expect(pageHeaders(request)).toEqual({ 'content-type': 'application/json', authorization: `Bearer ${XAI_KEY}` });
    expect(request.headers['cookie']).toBeUndefined();
    expect(request.body).toEqual({ text: TEXT, model: 'grok-4.7' });

    const tier = page.getByTestId('extra-tier');
    await expect(tier.first()).toBeAttached();
    await expect(tier.first()).toHaveAttribute('aria-hidden', 'true');
    const ids = await page
      .locator('.lv-cell[data-first]')
      .evaluateAll((cells) => cells.map((cell) => (cell as HTMLElement).dataset['liveId']));
    expect(ids).toEqual(['15721', '7489', '291', '15721', '12048']);
    await expect(page.locator('[data-boundary]')).toHaveCount(0);
    await expect(page.getByTestId('live-token-list').locator('li')).toHaveCount(5);
    expect(await guards.cspViolations()).toEqual([]);
    expect(guards.pageErrors()).toEqual([]);
  });

  test('a crafted divergent answer: the differing boundaries (5 and 9) are hatched and counted', async ({ page }) => {
    // 灣 as one token and 台南 as one token: boundaries 3 6 against Grok-2's 3 5 6 9.
    const divergent = [
      { token_id: 15721, string_token: '台', token_bytes: [0xe5, 0x8f, 0xb0] },
      { token_id: 90001, string_token: '灣', token_bytes: [0xe7, 0x81, 0xa3] },
      { token_id: 90002, string_token: '台南', token_bytes: [0xe5, 0x8f, 0xb0, 0xe5, 0x8d, 0x97] },
    ];
    await mockProvider(page, XAI_URL, () => ({ status: 200, body: { token_ids: divergent } }));
    await openPage(page, 'Grok-2');
    await openDrawer(page);
    await tokenize(page);
    await expect(page.getByTestId('xai-alignment')).toContainText('2 of 4 boundaries differ from Grok-2');
    const boundaries = await page
      .locator('[data-boundary]')
      .evaluateAll((cuts) => cuts.map((cut) => Number((cut as HTMLElement).dataset['boundary'])));
    expect(boundaries.sort((a, b) => a - b)).toEqual([5, 9]);
    // The list marks the two tokens that touch a differing boundary.
    await expect(page.getByTestId('live-token-list').locator('li[data-differs]')).toHaveCount(2);
    // Each hatched cut sits on its byte's column edge in the byte tier above.
    for (const boundary of [5, 9]) {
      const cut = await page.locator(`[data-boundary="${String(boundary)}"]`).boundingBox();
      const byte = await page.locator(`[data-tier="hex"][data-index="${String(boundary)}"]`).boundingBox();
      expect(Math.abs((cut?.x ?? 0) - (byte?.x ?? 99))).toBeLessThan(1.5);
    }
  });

  test('misaligned token_bytes: "could not align … (5 of 12 bytes matched)", an unaligned strip, no hatching', async ({
    page,
  }) => {
    const misaligned = [
      { token_id: 15721, string_token: '台', token_bytes: [0xe5, 0x8f, 0xb0] },
      { token_id: 7, string_token: '?', token_bytes: [0xe7, 0x81, 0xa4] },
      { token_id: 12048, string_token: '台南', token_bytes: [0xe5, 0x8f, 0xb0, 0xe5, 0x8d, 0x97] },
    ];
    await mockProvider(page, XAI_URL, () => ({ status: 200, body: { token_ids: misaligned } }));
    await openPage(page, 'Grok-2');
    await openDrawer(page);
    await tokenize(page);
    await expect(page.getByTestId('xai-alignment')).toHaveText(
      'could not align the API tokens to your text (5 of 12 bytes matched)',
    );
    const strip = page.getByTestId('unaligned-strip');
    await expect(strip.locator('li')).toHaveCount(3);
    await expect(strip.locator('li').first()).toContainText('15721');
    await expect(strip.locator('li').first()).toContainText('E5 8F B0');
    await expect(strip.locator('li[data-differs]')).toHaveCount(0);
    await expect(page.getByTestId('extra-tier')).toHaveCount(0);
    await expect(page.locator('[data-boundary], .lv-cell')).toHaveCount(0);
  });

  test('401 → the key (role="alert"); a network failure → the network/CORS sentence', async ({ page }) => {
    let mode: 'auth' | 'network' = 'auth';
    await page.route(XAI_URL, async (route) => {
      if (mode === 'network') {
        await route.abort('failed');
        return;
      }
      if (route.request().method() === 'OPTIONS') {
        await route.fulfill({
          status: 204,
          headers: {
            'access-control-allow-origin': '*',
            'access-control-allow-methods': 'POST',
            'access-control-allow-headers': route.request().headers()['access-control-request-headers'] ?? '',
          },
        });
        return;
      }
      await route.fulfill({
        status: 401,
        contentType: 'application/json',
        headers: { 'access-control-allow-origin': '*' },
        body: JSON.stringify({ code: 'unauthenticated', error: 'unauthenticated:no-credentials' }),
      });
    });
    await openPage(page, 'Grok-2');
    await openDrawer(page);
    await tokenize(page);
    await expect(xaiPanel(page).getByRole('alert')).toContainText('rejected this API key (HTTP 401)');
    mode = 'network';
    await xaiPanel(page).getByTestId('xai-run').click();
    await expect(xaiPanel(page).getByRole('alert')).toContainText('Could not reach api.x.ai from this page');
  });
});

test.describe('key lifecycle', () => {
  test('the key is forgotten on "Forget key" and when the drawer collapses, and never persisted', async ({ page }) => {
    const consoleLines = recordConsole(page);
    await mockProvider(page, XAI_URL, () => ({ status: 200, body: { token_ids: GROK2_TOKENS } }));
    await openPage(page, 'Grok-2');
    await openDrawer(page);
    await tokenize(page);
    await expect(page.getByTestId('xai-alignment')).toBeVisible();
    expect(await persistedEverywhere(page)).not.toContain(XAI_KEY);

    // Forget key: the field is empty, and the run button needs a new key.
    await xaiPanel(page).getByTestId('xai-forget').click();
    await expect(xaiPanel(page).getByTestId('xai-key')).toHaveValue('');
    await expect(xaiPanel(page).getByTestId('xai-run')).toBeDisabled();

    // Collapse: keys and answers are dropped (the live tier leaves the board); reopening shows empty fields.
    await xaiPanel(page).getByTestId('xai-key').fill(XAI_KEY);
    await anthropicPanel(page).getByTestId('anthropic-key').fill(ANTHROPIC_KEY);
    await page.getByTestId('live-check-toggle').click();
    await expect(page.getByTestId('live-check-toggle')).toHaveAttribute('aria-expanded', 'false');
    await expect(page.getByTestId('extra-tier')).toHaveCount(0);
    await openDrawer(page);
    await expect(xaiPanel(page).getByTestId('xai-key')).toHaveValue('');
    await expect(anthropicPanel(page).getByTestId('anthropic-key')).toHaveValue('');
    await expect(page.getByTestId('xai-result')).toHaveText('');

    const everywhere = await persistedEverywhere(page);
    expect(everywhere).not.toContain(XAI_KEY);
    expect(everywhere).not.toContain(ANTHROPIC_KEY);
    await expectNoIndexedDb(page);
    expect(consoleLines.join('\n')).not.toContain(XAI_KEY);
    expect(consoleLines.join('\n')).not.toContain(ANTHROPIC_KEY);
    // The DOM holds no copy either (a password field's value is a property, never an attribute).
    expect(await page.content()).not.toContain(XAI_KEY);
  });
});

test.describe('drawer', () => {
  test('is closed by default, warns before use, and the picker\'s "Claude 3+ → live check" row opens the Anthropic panel', async ({
    page,
  }) => {
    await openPage(page);
    const toggle = page.getByTestId('live-check-toggle');
    await expect(toggle).toHaveAttribute('aria-expanded', 'false');
    await expect(toggle).toHaveText('Live check with your own API key');
    await expect(page.getByTestId('byok-warning')).toHaveCount(0);

    await page.getByTestId('picker-button').click();
    const dialog = page.getByRole('dialog');
    await dialog.getByRole('button', { name: 'Claude 3+ → live check' }).click();
    await expect(dialog).toBeHidden();
    await expect(toggle).toHaveAttribute('aria-expanded', 'true');
    await expect(page.getByTestId('byok-warning')).toContainText(
      'Your key stays in this tab’s memory, is sent only to the provider over HTTPS and is forgotten when you reload.',
    );
    await expect(page.locator('#byok-anthropic-heading')).toBeFocused();
    const key = anthropicPanel(page).getByTestId('anthropic-key');
    await expect(key).toHaveAttribute('type', 'password');
    await expect(key).toHaveAttribute('autocomplete', 'off');
  });
});
