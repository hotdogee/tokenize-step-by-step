import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { EXPECTED_CSP, EXPECTED_PAGE_HEADERS } from '../support/expected.ts';

const HEADERS = readFileSync(new URL('../../apps/web/public/_headers', import.meta.url), 'utf8').split(/\r?\n/);

describe('expected headers (06 §6) match apps/web/public/_headers', () => {
  it('the /* block sets exactly the expected headers, CSP verbatim', () => {
    const start = HEADERS.indexOf('/*');
    const end = HEADERS.findIndex((line, index) => index > start && /^\S/.test(line));
    const block = HEADERS.slice(start + 1, end).map((line) => line.trim());
    const parsed = Object.fromEntries(
      block.map((line) => {
        const colon = line.indexOf(':');
        return [line.slice(0, colon).toLowerCase(), line.slice(colon + 1).trim()];
      }),
    );
    expect(parsed).toEqual(EXPECTED_PAGE_HEADERS);
    expect(parsed['content-security-policy']).toBe(EXPECTED_CSP);
  });

  it('the CSP has no unsafe-inline and only the two BYOK hosts (AD-15, OD-5)', () => {
    expect(EXPECTED_CSP).not.toContain('unsafe');
    expect(EXPECTED_CSP).toContain("connect-src 'self' https://api.anthropic.com https://api.x.ai;");
  });
});
