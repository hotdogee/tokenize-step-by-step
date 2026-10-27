import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import type { AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { gzipSync } from 'node:zlib';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { blockHeaders, parseHeadersFile } from '../lib/headers-file.ts';
import { runSmoke, targetFromDist, type SmokeResult } from '../lib/smoke.ts';

const HEADERS = readFileSync(new URL('../../apps/web/public/_headers', import.meta.url), 'utf8');
const PAGE_HEADERS = blockHeaders(parseHeadersFile(HEADERS)[0]!);
const NOT_FOUND = '<!doctype html><title>Not found</title>';
const TOK = '/tok/openai-o200k_base/0123456789ab.bin';
const TOK_BYTES = Buffer.alloc(3000, 7);

let dist = '';

function write(file: string, content: string | Uint8Array): void {
  mkdirSync(dirname(join(dist, file)), { recursive: true });
  writeFileSync(join(dist, file), content);
}

/** Flaws a misconfigured deployment can have; the good server has none. */
interface Flaws {
  readonly duplicateTokType?: boolean;
  readonly tokCompressed?: boolean;
  readonly wrongCsp?: boolean;
  readonly servesDotfiles?: boolean;
  readonly noRedirect?: boolean;
  readonly uncompressedAssets?: boolean;
  readonly noRevalidation?: boolean;
  /** Not a flaw of the deployment: a Workers Preview answers unknown paths with a platform "Not found", not 404.html. */
  readonly platformNotFound?: boolean;
}

/** A tiny stand-in for the Workers asset server, configured like `_headers` + `wrangler.jsonc`. */
function handler(flaws: Flaws) {
  return (req: IncomingMessage, res: ServerResponse): void => {
    const path = new URL(req.url ?? '/', 'http://x').pathname;
    const page = (status: number, body: string): void => {
      for (const [name, value] of PAGE_HEADERS)
        res.setHeader(
          name,
          flaws.wrongCsp === true && name === 'content-security-policy'
            ? `${value}; script-src 'unsafe-inline'`
            : value,
        );
      res.writeHead(status, { 'content-type': 'text/html; charset=utf-8' }).end(body);
    };
    if (path === '/' || path === '/about/') {
      page(200, '<!doctype html>');
      return;
    }
    if (path === '/index.html' && flaws.noRedirect !== true) {
      res.writeHead(307, { location: '/' }).end();
      return;
    }
    if (path === TOK) {
      res.setHeader(
        'content-type',
        flaws.duplicateTokType === true
          ? ['application/octet-stream', 'application/octet-stream']
          : 'application/octet-stream',
      );
      res.setHeader('cache-control', 'public, max-age=31536000, immutable');
      res.setHeader('x-content-type-options', 'nosniff');
      res.setHeader('cross-origin-resource-policy', 'same-origin');
      if (flaws.tokCompressed === true) {
        res.writeHead(200, { 'content-encoding': 'br' }).end(TOK_BYTES);
        return;
      }
      res.writeHead(200, { 'content-length': String(TOK_BYTES.length) }).end(TOK_BYTES);
      return;
    }
    if (path.startsWith('/assets/') || path.startsWith('/examples/')) {
      const etag = `"${path}"`;
      res.setHeader('cache-control', 'public, max-age=31536000, immutable');
      res.setHeader('etag', etag);
      if (req.headers['if-none-match'] === etag && flaws.noRevalidation !== true) {
        res.writeHead(304).end();
        return;
      }
      if (flaws.uncompressedAssets === true) {
        res.writeHead(200).end('x');
        return;
      }
      res.writeHead(200, { 'content-encoding': 'gzip' }).end(gzipSync('x'));
      return;
    }
    if (path.startsWith('/licenses/')) {
      res.writeHead(200, { 'cache-control': 'public, max-age=86400' }).end('MIT');
      return;
    }
    if (path.startsWith('/.') && flaws.servesDotfiles === true) {
      res.writeHead(200).end('SECRET=1');
      return;
    }
    page(404, flaws.platformNotFound === true ? 'Not found' : NOT_FOUND);
  };
}

async function serve(flaws: Flaws): Promise<{ server: Server; url: string }> {
  const server = createServer(handler(flaws));
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  return { server, url: `http://127.0.0.1:${String((server.address() as AddressInfo).port)}` };
}

async function smoke(flaws: Flaws, options: { readonly preview?: boolean } = {}): Promise<SmokeResult[]> {
  const { server, url } = await serve(flaws);
  try {
    return await runSmoke(targetFromDist(url, dist, options), (target, init) => fetch(target, init));
  } finally {
    server.close();
  }
}

const failed = (results: readonly SmokeResult[]): string[] => results.filter((r) => !r.ok).map((r) => r.name);

beforeAll(() => {
  dist = mkdtempSync(join(tmpdir(), 'tsbs-smoke-'));
  write('_headers', HEADERS);
  write('404.html', NOT_FOUND);
  write('assets/boot-0123abcd.js', 'x');
  write('assets/main-AbCd1234.js', 'export {};'.repeat(10));
  write(TOK.slice(1), TOK_BYTES);
  write('examples/openai-o200k_base.0123abcd.json', '{}');
  write('licenses/openai-o200k_base/LICENSE', 'MIT');
});

afterAll(() => {
  rmSync(dist, { recursive: true, force: true });
});

describe('deploy smoke', () => {
  it('derives the target from dist', () => {
    const target = targetFromDist('https://example.workers.dev', dist);
    expect(target.tok).toEqual({ path: TOK, bytes: 3000 });
    expect(target.asset).toBe('/assets/main-AbCd1234.js');
    expect(target.pageHeaders.get('content-security-policy')).toMatch(/^default-src 'none'; script-src 'self'/);
    expect(target.pageHeaders.size).toBe(6);
  });

  it('passes against a correctly configured deployment', async () => {
    const results = await smoke({});
    expect(failed(results)).toEqual([]);
    expect(results.map((r) => r.name)).toEqual([
      '/ security headers',
      '/about/ security headers',
      '/index.html redirects to /',
      '/nope is the 404 page',
      '/.env is not served',
      '/.assetsignore is not served',
      '/tok/*.bin headers',
      '/assets/*.js compressed, immutable, revalidates',
      '/examples/*.json compressed, immutable, revalidates',
      '/licenses/* cache',
    ]);
  });

  it('compares the 404 body on production only: a Workers Preview serves a platform "Not found"', async () => {
    const production = await smoke({ platformNotFound: true });
    expect(failed(production)).toEqual(['/nope is the 404 page']);
    expect(production.find((r) => r.name === '/nope is the 404 page')?.detail).toContain(
      'body differs from dist/404.html',
    );
    const preview = await smoke({ platformNotFound: true }, { preview: true });
    expect(failed(preview)).toEqual([]);
    expect(preview.find((r) => r.name === '/nope is the 404 page')?.detail).toBe('404 (body not compared)');
  });

  it('fails on a duplicated or compressed /tok Content-Type', async () => {
    const duplicate = await smoke({ duplicateTokType: true });
    expect(failed(duplicate)).toEqual(['/tok/*.bin headers']);
    expect(duplicate.find((r) => r.name === '/tok/*.bin headers')?.detail).toContain(
      'content-type: expected "application/octet-stream", got "application/octet-stream, application/octet-stream"',
    );
    const compressed = await smoke({ tokCompressed: true });
    expect(compressed.find((r) => r.name === '/tok/*.bin headers')?.detail).toMatch(
      /content-encoding is "br".*content-length: expected "3000", got none/,
    );
  });

  it('fails on a CSP drift, served dotfiles, a missing redirect and edge caching problems', async () => {
    expect(failed(await smoke({ wrongCsp: true }))).toEqual(['/ security headers', '/about/ security headers']);
    expect(failed(await smoke({ servesDotfiles: true }))).toEqual([
      '/.env is not served',
      '/.assetsignore is not served',
    ]);
    expect(failed(await smoke({ noRedirect: true }))).toEqual(['/index.html redirects to /']);
    expect(failed(await smoke({ uncompressedAssets: true, noRevalidation: true }))).toEqual([
      '/assets/*.js compressed, immutable, revalidates',
      '/examples/*.json compressed, immutable, revalidates',
    ]);
  });

  it('reports a network error as a failed check instead of throwing', async () => {
    const results = await runSmoke(targetFromDist('http://127.0.0.1:9', dist), () =>
      Promise.reject(new Error('ECONNREFUSED')),
    );
    expect(results.every((r) => !r.ok && r.detail === 'ECONNREFUSED')).toBe(true);
  });
});
