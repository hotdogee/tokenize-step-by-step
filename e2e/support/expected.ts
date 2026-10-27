/**
 * Expected values the suites assert, copied verbatim from the design (06 §6). The design is the source of truth:
 * `e2e/test/expected.test.ts` fails if `apps/web/public/_headers` drifts from these strings.
 */

/** The Content-Security-Policy of 06 §6 (AD-15), exactly. */
export const EXPECTED_CSP =
  "default-src 'none'; script-src 'self'; style-src 'self'; img-src 'self' data:; font-src 'self'; connect-src 'self' https://api.anthropic.com https://api.x.ai; worker-src 'self'; manifest-src 'self'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'";

/** Headers the `/*` block of `_headers` puts on every response (lower-case names). */
export const EXPECTED_PAGE_HEADERS: Readonly<Record<string, string>> = {
  'x-content-type-options': 'nosniff',
  'referrer-policy': 'strict-origin-when-cross-origin',
  'permissions-policy': 'camera=(), microphone=(), geolocation=()',
  'cross-origin-opener-policy': 'same-origin',
  'x-frame-options': 'DENY',
  'content-security-policy': EXPECTED_CSP,
};

/** The two HTML entries every suite visits, with a title pattern robust to WP06's localized titles. */
export const PAGES = [
  { path: '/', title: /What is a token\?/ },
  { path: '/about/', title: /About/ },
] as const;

/** UI locales (OD-2) and theme values `boot.js` may set before first paint (AD-29). */
export const LANG_PATTERN = /^(en|ja|zh-TW)$/;
export const THEME_PATTERN = /^(auto|light|dark)$/;
