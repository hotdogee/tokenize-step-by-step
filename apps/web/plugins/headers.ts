/**
 * `headersMiddleware()` — replays `public/_headers` (Cloudflare `_headers` syntax) in `vite preview` and `vite dev`, so
 * local runs see the production headers (AD-15, 02 §5). It is a convenience: `_headers` is a Cloudflare feature and the
 * authoritative checks run on `wrangler dev` and the deployed preview (06 §4).
 *
 * PA-2b: `vite preview` (the production bundle) gets every header, CSP included; `vite dev` gets every header EXCEPT
 * `Content-Security-Policy`, because Vite's HMR client and Svelte inject `<style>` elements that `style-src 'self'` blocks.
 */
import { readFileSync } from 'node:fs';
import type { ServerResponse } from 'node:http';
import { resolve } from 'node:path';
import type { Connect, Plugin } from 'vite';

/** One header operation of a `_headers` block. */
export type HeaderOp =
  | { readonly op: 'remove'; readonly name: string }
  | { readonly op: 'set'; readonly name: string; readonly value: string };

/** One path block of `_headers`: header removals (`! Name`) and additions (`Name: value`), in file order. */
export interface HeaderRule {
  readonly pattern: string;
  readonly matcher: RegExp;
  readonly ops: readonly HeaderOp[];
}

/** Headers to apply to one response: final values keyed by lower-case name, plus names to strip from downstream. */
export interface HeaderDecision {
  readonly set: ReadonlyMap<string, readonly [name: string, value: string]>;
  readonly remove: ReadonlySet<string>;
}

/** Headers `vite dev` must not send (PA-2b). Lower-case. */
export const DEV_OMITTED_HEADERS: ReadonlySet<string> = new Set(['content-security-policy']);

/** Cloudflare path pattern → anchored RegExp: `*` is a splat (any characters), `:name` one path segment. */
export function patternToRegExp(pattern: string): RegExp {
  let source = '';
  for (const token of pattern.split(/(\*|:[A-Za-z]\w*)/)) {
    if (token === '*') source += '.*';
    else if (token.startsWith(':')) source += '[^/]+';
    else source += token.replace(/[.+?^${}()|[\]\\]/g, '\\$&');
  }
  return new RegExp(`^${source}$`);
}

/** Parses `_headers` text. Throws on a header line outside a path block or a line that is neither `Name: value` nor `! Name`. */
export function parseHeaders(text: string): HeaderRule[] {
  const rules: Array<{ pattern: string; matcher: RegExp; ops: HeaderOp[] }> = [];
  text.split(/\r?\n/).forEach((line, index) => {
    if (line.trim() === '' || line.trimStart().startsWith('#')) return;
    if (!/^\s/.test(line)) {
      const pattern = line.trim();
      rules.push({ pattern, matcher: patternToRegExp(pattern), ops: [] });
      return;
    }
    const rule = rules.at(-1);
    if (rule === undefined) throw new Error(`_headers line ${String(index + 1)}: header outside a path block`);
    const body = line.trim();
    const removal = /^!\s*([\w-]+)$/.exec(body);
    const addition = /^([\w-]+)\s*:\s*(.*)$/.exec(body);
    if (removal?.[1] !== undefined) rule.ops.push({ op: 'remove', name: removal[1] });
    else if (addition?.[1] !== undefined && addition[2] !== undefined)
      rule.ops.push({ op: 'set', name: addition[1], value: addition[2] });
    else throw new Error(`_headers line ${String(index + 1)}: cannot parse "${body}"`);
  });
  return rules;
}

/**
 * The headers `_headers` gives `pathname`. Every matching block applies in file order; a header set by two blocks is
 * joined with ", " (Cloudflare semantics); `! Name` drops earlier values and the platform's own. Names in `omit` are skipped.
 */
export function headersFor(
  rules: readonly HeaderRule[],
  pathname: string,
  omit: ReadonlySet<string> = new Set(),
): HeaderDecision {
  const set = new Map<string, readonly [string, string]>();
  const remove = new Set<string>();
  for (const rule of rules) {
    if (!rule.matcher.test(pathname)) continue;
    for (const op of rule.ops) {
      const key = op.name.toLowerCase();
      if (omit.has(key)) continue;
      if (op.op === 'remove') {
        set.delete(key);
        remove.add(key);
      } else {
        const previous = set.get(key);
        set.set(key, [op.name, previous === undefined ? op.value : `${previous[1]}, ${op.value}`]);
      }
    }
  }
  return { set, remove };
}

/**
 * Applies a decision when the response head is written, so it wins over headers that downstream middleware (Vite's
 * static server) sets with `setHeader` or passes to `writeHead`. Raw-array `writeHead` headers are left untouched.
 */
function applyOnWriteHead(res: ServerResponse, decision: HeaderDecision): void {
  const original = res.writeHead.bind(res) as (...args: unknown[]) => ServerResponse;
  const patched = (...args: unknown[]): ServerResponse => {
    const last = args.at(-1);
    if (args.length > 1 && typeof last === 'object' && last !== null && !Array.isArray(last)) {
      const inline = last as Record<string, unknown>;
      for (const key of Object.keys(inline)) {
        const lower = key.toLowerCase();
        if (decision.remove.has(lower) || decision.set.has(lower)) Reflect.deleteProperty(inline, key);
      }
    }
    for (const name of decision.remove) res.removeHeader(name);
    for (const [name, value] of decision.set.values()) res.setHeader(name, value);
    return original(...args);
  };
  res.writeHead = patched;
}

/** Connect middleware applying `rules()` (re-read lazily) minus `omit` to every response. */
export function createHeadersMiddleware(
  rules: () => readonly HeaderRule[],
  omit: ReadonlySet<string>,
): Connect.NextHandleFunction {
  return (req, res, next) => {
    const pathname = new URL(req.url ?? '/', 'http://localhost').pathname;
    applyOnWriteHead(res, headersFor(rules(), pathname, omit));
    next();
  };
}

/**
 * The Vite plugin (02 §5). Reads `<publicDir>/_headers` (so `vite build` also fails fast on a malformed file); dev re-reads
 * it when it changes. `enforce: 'pre'` registers the middleware before every other plugin's, so it covers all responses.
 */
export function headersMiddleware(): Plugin {
  let file = '';
  let rules: HeaderRule[] = [];
  const load = (): void => {
    rules = parseHeaders(readFileSync(file, 'utf8'));
  };
  return {
    name: 'tsbs:headers',
    enforce: 'pre',
    configResolved(config) {
      file = resolve(config.publicDir, '_headers');
      load();
    },
    configureServer(server) {
      server.watcher.add(file);
      server.watcher.on('change', (changed) => {
        if (resolve(changed) === file) load();
      });
      server.middlewares.use(createHeadersMiddleware(() => rules, DEV_OMITTED_HEADERS));
    },
    configurePreviewServer(server) {
      server.middlewares.use(createHeadersMiddleware(() => rules, new Set()));
    },
  };
}
