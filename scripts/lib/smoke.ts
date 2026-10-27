/**
 * Post-deploy smoke checks (06 §7 items 6–8; research §6.5 item 7) against a deployed URL — the PR preview or production.
 * The expected values come from what was deployed: the `/*` block of `dist/_headers` and the files in `dist/`.
 *
 * Every check is a plain HTTP request (no browser), so it also runs against `wrangler dev`, which applies `_headers`,
 * `html_handling` and `not_found_handling` like the edge does.
 */
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, posix, relative, sep } from 'node:path';
import { blockHeaders, parseHeadersFile } from './headers-file.ts';

/** Outcome of one check. `skipped` checks never fail the run. */
export interface SmokeResult {
  readonly name: string;
  readonly ok: boolean;
  readonly skipped: boolean;
  readonly detail: string;
}

/** What the smoke run requests and expects; build it with `targetFromDist`. */
export interface SmokeTarget {
  readonly baseUrl: string;
  /** Headers of the `_headers` `/*` block (lower-case names), expected verbatim on every HTML response. */
  readonly pageHeaders: ReadonlyMap<string, string>;
  /** The largest `/tok/*` file (research §6.5: the one most likely to trip edge compression) and its size. */
  readonly tok: { readonly path: string; readonly bytes: number } | null;
  /** The largest `/assets/*.js` (tiny files may legitimately be served uncompressed). */
  readonly asset: string | null;
  readonly examples: string | null;
  readonly licence: string | null;
  /**
   * `dist/404.html`, which `/nope` must return byte for byte (`not_found_handling: 404-page`); null when the body is not
   * compared: a Workers Preview (`wrangler preview`) answers unknown paths with a platform "Not found" instead of the
   * configured 404 page (observed on PR #1, 2026-10-27), so the preview job checks the status and content type only.
   */
  readonly notFoundBody: string | null;
}

/** The subset of `fetch` the checks use (injectable for tests). */
export type Fetcher = (
  url: string,
  init: { readonly method: 'GET'; readonly redirect: 'manual'; readonly headers: Record<string, string> },
) => Promise<Response>;

/** Encodings a compressible asset may arrive in from the edge (06 §7 item 7). */
export const EDGE_ENCODINGS: ReadonlySet<string> = new Set(['zstd', 'br', 'gzip']);
const ACCEPT_ENCODING = 'zstd, br, gzip';

function filesUnder(dist: string, dir: string): string[] {
  const walk = (current: string): string[] => {
    let entries;
    try {
      entries = readdirSync(current, { withFileTypes: true });
    } catch {
      return [];
    }
    return entries.flatMap((entry) => {
      const full = join(current, entry.name);
      return entry.isDirectory() ? walk(full) : [relative(dist, full).split(sep).join(posix.sep)];
    });
  };
  return walk(join(dist, dir)).sort();
}

/** The largest of `files` (relative to `dist`), as a root-relative URL path, or null. */
function largest(dist: string, files: readonly string[]): { path: string; bytes: number } | null {
  let best: { path: string; bytes: number } | null = null;
  for (const file of files) {
    const bytes = statSync(join(dist, file)).size;
    if (best === null || bytes > best.bytes) best = { path: `/${file}`, bytes };
  }
  return best;
}

/** Builds the smoke target from the deployed `dist` directory; `preview` skips the 404 body comparison (`notFoundBody`). */
export function targetFromDist(
  baseUrl: string,
  dist: string,
  options: { readonly preview?: boolean } = {},
): SmokeTarget {
  const blocks = parseHeadersFile(readFileSync(join(dist, '_headers'), 'utf8'));
  const root = blocks.find((block) => block.pattern === '/*');
  if (root === undefined) throw new Error(`${join(dist, '_headers')} has no "/*" block`);
  let notFoundBody: string | null = null;
  if (options.preview !== true)
    try {
      notFoundBody = readFileSync(join(dist, '404.html'), 'utf8');
    } catch {
      notFoundBody = null;
    }
  return {
    baseUrl,
    pageHeaders: blockHeaders(root),
    tok: largest(dist, filesUnder(dist, 'tok')),
    asset:
      largest(
        dist,
        filesUnder(dist, 'assets').filter((file) => file.endsWith('.js')),
      )?.path ?? null,
    examples: filesUnder(dist, 'examples').map((file) => `/${file}`)[0] ?? null,
    licence: filesUnder(dist, 'licenses').map((file) => `/${file}`)[0] ?? null,
    notFoundBody,
  };
}

/** Collects failures for one response; `ok` iff none. */
class Expectations {
  readonly failures: string[] = [];
  equal(label: string, actual: string | null, expected: string): void {
    if (actual !== expected)
      this.failures.push(`${label}: expected "${expected}", got ${actual === null ? 'none' : `"${actual}"`}`);
  }
  that(condition: boolean, message: string): void {
    if (!condition) this.failures.push(message);
  }
  result(name: string, passDetail: string): SmokeResult {
    return {
      name,
      ok: this.failures.length === 0,
      skipped: false,
      detail: this.failures.length === 0 ? passDetail : this.failures.join('; '),
    };
  }
}

/** Runs every check in order; never throws for an HTTP-level problem (a network error becomes a failed check). */
export async function runSmoke(target: SmokeTarget, fetcher: Fetcher): Promise<SmokeResult[]> {
  const url = (path: string): string => new URL(path, target.baseUrl).href;
  /** GET without following redirects; the body is read only when asked for, otherwise cancelled (headers stay readable). */
  const get = async (
    path: string,
    headers: Record<string, string> = {},
    readBody = false,
  ): Promise<{ res: Response; text: string | null }> => {
    const res = await fetcher(url(path), { method: 'GET', redirect: 'manual', headers });
    if (readBody) return { res, text: await res.text() };
    await res.body?.cancel().catch(() => undefined);
    return { res, text: null };
  };
  const results: SmokeResult[] = [];
  const check = async (name: string, run: () => Promise<SmokeResult>): Promise<void> => {
    try {
      results.push(await run());
    } catch (error: unknown) {
      results.push({ name, ok: false, skipped: false, detail: error instanceof Error ? error.message : String(error) });
    }
  };
  const skip = (name: string, detail: string): void => {
    results.push({ name, ok: true, skipped: true, detail });
  };

  for (const path of ['/', '/about/']) {
    await check(`${path} security headers`, async () => {
      const { res } = await get(path);
      const e = new Expectations();
      e.equal('status', String(res.status), '200');
      e.that(
        (res.headers.get('content-type') ?? '').startsWith('text/html'),
        `content-type is ${res.headers.get('content-type') ?? 'missing'}`,
      );
      for (const [name, value] of target.pageHeaders) e.equal(name, res.headers.get(name), value);
      return e.result(`${path} security headers`, `${String(target.pageHeaders.size)} headers exactly as _headers`);
    });
  }

  await check('/index.html redirects to /', async () => {
    const { res } = await get('/index.html');
    const e = new Expectations();
    e.equal('status', String(res.status), '307');
    const location = res.headers.get('location');
    e.that(
      location !== null && new URL(location, url('/index.html')).href === url('/'),
      `location is ${location ?? 'missing'}`,
    );
    return e.result('/index.html redirects to /', '307 → /');
  });

  await check('/nope is the 404 page', async () => {
    const { res, text } = await get('/nope', {}, target.notFoundBody !== null);
    const e = new Expectations();
    e.equal('status', String(res.status), '404');
    e.that(
      (res.headers.get('content-type') ?? '').startsWith('text/html'),
      `content-type is ${res.headers.get('content-type') ?? 'missing'}`,
    );
    if (target.notFoundBody !== null) e.that(text === target.notFoundBody, 'body differs from dist/404.html');
    return e.result(
      '/nope is the 404 page',
      target.notFoundBody === null ? '404 (body not compared)' : '404 with 404.html',
    );
  });

  for (const path of ['/.env', '/.assetsignore']) {
    await check(`${path} is not served`, async () => {
      const { res } = await get(path);
      const e = new Expectations();
      e.equal('status', String(res.status), '404');
      return e.result(`${path} is not served`, '404');
    });
  }

  const tok = target.tok;
  if (tok === null) skip('/tok/*.bin headers', 'no /tok asset in dist yet (WP03)');
  else
    await check('/tok/*.bin headers', async () => {
      const { res } = await get(tok.path, { 'accept-encoding': ACCEPT_ENCODING });
      const e = new Expectations();
      e.equal('status', String(res.status), '200');
      const encoding = res.headers.get('content-encoding');
      e.that(encoding === null, `content-encoding is "${encoding ?? ''}" (the .bin is already gzip; AD-10)`);
      e.equal('content-length', res.headers.get('content-length'), String(tok.bytes));
      e.equal('content-type', res.headers.get('content-type'), 'application/octet-stream');
      e.equal('x-content-type-options', res.headers.get('x-content-type-options'), 'nosniff');
      e.equal('cross-origin-resource-policy', res.headers.get('cross-origin-resource-policy'), 'same-origin');
      e.equal('cache-control', res.headers.get('cache-control'), 'public, max-age=31536000, immutable');
      return e.result('/tok/*.bin headers', `${tok.path}: ${String(tok.bytes)} B, octet-stream, no Content-Encoding`);
    });

  for (const [label, path] of [
    ['/assets/*.js', target.asset],
    ['/examples/*.json', target.examples],
  ] as const) {
    const name = `${label} compressed, immutable, revalidates`;
    if (path === null) {
      skip(name, `no ${label} in dist yet`);
      continue;
    }
    await check(name, async () => {
      const { res } = await get(path, { 'accept-encoding': ACCEPT_ENCODING });
      const e = new Expectations();
      e.equal('status', String(res.status), '200');
      const encoding = res.headers.get('content-encoding');
      e.that(
        encoding !== null && EDGE_ENCODINGS.has(encoding),
        `content-encoding is ${encoding ?? 'missing'} (want zstd, br or gzip)`,
      );
      e.equal('cache-control', res.headers.get('cache-control'), 'public, max-age=31536000, immutable');
      const etag = res.headers.get('etag');
      e.that(etag !== null, 'no ETag');
      if (etag !== null) {
        const again = await get(path, { 'accept-encoding': ACCEPT_ENCODING, 'if-none-match': etag });
        e.equal('If-None-Match status', String(again.res.status), '304');
      }
      return e.result(name, `${path}: ${encoding ?? ''}, ETag, 304 on If-None-Match`);
    });
  }

  const licence = target.licence;
  if (licence === null) skip('/licenses/* cache', 'no /licenses file in dist yet (WP03/WP06)');
  else
    await check('/licenses/* cache', async () => {
      const { res } = await get(licence);
      const e = new Expectations();
      e.equal('status', String(res.status), '200');
      e.equal('cache-control', res.headers.get('cache-control'), 'public, max-age=86400');
      return e.result('/licenses/* cache', `${licence}: max-age=86400`);
    });
  return results;
}
