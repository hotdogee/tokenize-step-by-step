import { readFileSync } from 'node:fs';
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createHeadersMiddleware, DEV_OMITTED_HEADERS, headersFor, parseHeaders, patternToRegExp } from './headers.ts';

const rules = parseHeaders(readFileSync(new URL('../public/_headers', import.meta.url), 'utf8'));
const value = (path: string, name: string, omit?: ReadonlySet<string>): string | undefined =>
  headersFor(rules, path, omit).set.get(name.toLowerCase())?.[1];

describe('public/_headers (06 §6)', () => {
  it('has 5 path blocks, 12 header lines and one removal', () => {
    expect(rules.map((rule) => rule.pattern)).toEqual(['/*', '/assets/*', '/examples/*', '/tok/*', '/licenses/*']);
    const ops = rules.flatMap((rule) => rule.ops);
    expect(ops.filter((op) => op.op === 'set')).toHaveLength(12);
    expect(ops.filter((op) => op.op === 'remove')).toEqual([{ op: 'remove', name: 'Content-Type' }]);
  });

  it('sends the strict CSP on pages, with no unsafe-inline', () => {
    const csp = value('/', 'Content-Security-Policy');
    expect(csp).toMatch(/^default-src 'none'; script-src 'self'; style-src 'self';/);
    expect(csp).not.toContain('unsafe-inline');
    expect(value('/about/', 'X-Frame-Options')).toBe('DENY');
  });

  it('serves /tok/* as exactly application/octet-stream, immutable, same-origin', () => {
    const decision = headersFor(rules, '/tok/openai-o200k_base/3f9a1c0b7e2d.bin');
    expect(decision.remove).toContain('content-type');
    expect(decision.set.get('content-type')?.[1]).toBe('application/octet-stream');
    expect(decision.set.get('cache-control')?.[1]).toBe('public, max-age=31536000, immutable');
    expect(decision.set.get('cross-origin-resource-policy')?.[1]).toBe('same-origin');
  });

  it('omits only the CSP in dev (PA-2b)', () => {
    expect(value('/', 'Content-Security-Policy', DEV_OMITTED_HEADERS)).toBeUndefined();
    expect(value('/', 'X-Content-Type-Options', DEV_OMITTED_HEADERS)).toBe('nosniff');
  });
});

describe('patternToRegExp', () => {
  it('treats * as a splat and :name as one segment', () => {
    expect(patternToRegExp('/tok/*').test('/tok/a/b.bin')).toBe(true);
    expect(patternToRegExp('/tok/*').test('/token')).toBe(false);
    expect(patternToRegExp('/u/:id/x').test('/u/42/x')).toBe(true);
    expect(patternToRegExp('/u/:id/x').test('/u/4/2/x')).toBe(false);
  });
});

describe('createHeadersMiddleware', () => {
  let preview: Server;
  let dev: Server;
  const serve = (omit: ReadonlySet<string>): Server => {
    const middleware = createHeadersMiddleware(() => rules, omit);
    return createServer((req, res) => {
      middleware(req, res, () => {
        // Like Vite's static server: a Content-Type passed straight to writeHead.
        res.writeHead(200, { 'Content-Type': 'text/html' });
        res.end('ok');
      });
    }).listen(0);
  };
  const url = (server: Server, path: string): string =>
    `http://127.0.0.1:${String((server.address() as AddressInfo).port)}${path}`;

  beforeAll(() => {
    preview = serve(new Set());
    dev = serve(DEV_OMITTED_HEADERS);
  });
  afterAll(() => {
    preview.close();
    dev.close();
  });

  it('applies the CSP in preview and overrides downstream Content-Type for /tok/*', async () => {
    const page = await fetch(url(preview, '/'));
    expect(page.headers.get('content-security-policy')).toContain("default-src 'none'");
    expect(page.headers.get('content-type')).toBe('text/html');
    const bin = await fetch(url(preview, '/tok/x/abc.bin'));
    expect(bin.headers.get('content-type')).toBe('application/octet-stream');
  });

  it('omits the CSP in dev but keeps the other headers', async () => {
    const page = await fetch(url(dev, '/'));
    expect(page.headers.get('content-security-policy')).toBeNull();
    expect(page.headers.get('x-frame-options')).toBe('DENY');
  });
});
