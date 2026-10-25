/**
 * Small Node helpers shared by the web app's `vocabAssets()`, `licences()` and `examples()` Vite plugins (they live in
 * apps/web/plugins and stay thin; the logic is here so it is unit-tested with the converter).
 */
import { Buffer } from 'node:buffer';
import { cp, mkdir, readFile, stat, writeFile } from 'node:fs/promises';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { dirname, join, normalize, sep } from 'node:path';

/** Writes `file` only when its content would change, so dev watchers are not retriggered. Returns true if written. */
export async function writeIfChanged(file: string, content: string | Uint8Array): Promise<boolean> {
  const next = typeof content === 'string' ? Buffer.from(content, 'utf8') : Buffer.from(content);
  const current = await readFile(file).catch(() => null);
  if (current?.equals(next) === true) return false;
  await mkdir(dirname(file), { recursive: true });
  await writeFile(file, next);
  return true;
}

/** True iff `path` is an existing directory. */
export async function isDirectory(path: string): Promise<boolean> {
  return stat(path).then(
    (s) => s.isDirectory(),
    () => false,
  );
}

/** True iff `path` is an existing file. */
export async function isFile(path: string): Promise<boolean> {
  return stat(path).then(
    (s) => s.isFile(),
    () => false,
  );
}

/** Copies a directory tree (no-op when `from` does not exist). */
export async function copyTree(from: string, to: string): Promise<boolean> {
  if (!(await isDirectory(from))) return false;
  await cp(from, to, { recursive: true });
  return true;
}

/**
 * Maps a root-relative URL path under `prefix` (e.g. `/tok/`) to a file inside `root`, refusing `..` escapes and
 * dotfiles. Returns null when the URL is not under the prefix or not a safe path.
 */
export function resolveUnder(root: string, prefix: string, urlPath: string): string | null {
  let path: string;
  try {
    path = decodeURIComponent(urlPath.split('?')[0] ?? '');
  } catch {
    return null; // malformed percent-encoding
  }
  if (!path.startsWith(prefix)) return null;
  const rest = path.slice(prefix.length);
  if (
    rest === '' ||
    rest.split('/').some((part) => part === '' || part === '..' || part.startsWith('.') || part.includes('\\'))
  )
    return null;
  const full = normalize(join(root, ...rest.split('/')));
  return full.startsWith(normalize(root) + sep) ? full : null;
}

/** Sends `body` with an exact Content-Type and Content-Length (dev servers only). */
export function sendBytes(res: ServerResponse, body: Uint8Array, contentType: string): void {
  res.statusCode = 200;
  res.setHeader('Content-Type', contentType);
  res.setHeader('Content-Length', String(body.length));
  res.setHeader('Cache-Control', 'no-cache');
  res.end(Buffer.from(body.buffer, body.byteOffset, body.byteLength));
}

/** A connect-style middleware signature (what Vite's `server.middlewares.use` takes). */
export type Middleware = (req: IncomingMessage, res: ServerResponse, next: (error?: unknown) => void) => void;
