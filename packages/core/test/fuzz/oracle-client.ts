/**
 * Node client of the Python batch oracle `tools/oracle/fuzz_oracle.py --serve` (PA-9): one long-lived process (the
 * tokenizers load once), JSON lines on stdin/stdout. Requests are written as ASCII JSON (every non-ASCII UTF-16 unit
 * escaped), so neither side depends on the pipe's code page (Windows). The uv project defaults to `tools/oracle` of
 * this checkout; `TSBS_ORACLE_PROJECT` points at another one (a git worktree reusing the main checkout's venv).
 */
import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import { join } from 'node:path';
import process from 'node:process';
import { createInterface } from 'node:readline';
import type { TokenizerId } from '../../src/index.ts';
import { REPO_ROOT } from '../helpers/repo.ts';

/** One oracle answer (the fixture policy): ids, `[start, end)` byte spans and the Python cross-check's ids. */
export type OracleResult =
  | {
      readonly ids: readonly number[];
      readonly spans: ReadonlyArray<readonly [number, number]>;
      /** Ids of the fixture lane's Python cross-check for this tokenizer, or null where it has none / could not run. */
      readonly cross: readonly number[] | null;
      /** Why the cross-check differs (gemma4: the Gemma 3 USER_DEFINED literal) or could not run. */
      readonly crossNote: string | null;
    }
  | { readonly error: string };

/** What produced the answers for one tokenizer. */
export interface OracleInfo {
  readonly library: string;
  readonly crossLibrary: string | null;
}

/** The answers to one request. */
export interface OracleResponse {
  readonly results: Readonly<Partial<Record<TokenizerId, readonly OracleResult[]>>>;
  readonly oracles: Readonly<Partial<Record<TokenizerId, OracleInfo>>>;
}

/** Anything that answers oracle requests (the Python process, or a fake in tests). */
export interface OracleLike {
  request(texts: Readonly<Partial<Record<TokenizerId, readonly string[]>>>): Promise<OracleResponse>;
  close(): Promise<void>;
}

/** `JSON.stringify` with every code unit ≥ U+007F written as `\uXXXX` (pure ASCII on the wire). */
export function asciiJson(value: unknown): string {
  return JSON.stringify(value).replace(
    /[\u007f-\uffff]/g,
    (ch) => `\\u${ch.charCodeAt(0).toString(16).padStart(4, '0')}`,
  );
}

interface Pending {
  resolve(response: OracleResponse): void;
  reject(error: Error): void;
}

/** The uv project of the Python oracle lane. */
export function oracleProject(): string {
  const override = process.env['TSBS_ORACLE_PROJECT'];
  return override !== undefined && override !== '' ? override : join(REPO_ROOT, 'tools', 'oracle');
}

/** Starts `uv run --project <project> python tools/oracle/fuzz_oracle.py --serve` and waits for its ready line. */
export async function startPythonOracle(): Promise<OracleLike> {
  const script = join(REPO_ROOT, 'tools', 'oracle', 'fuzz_oracle.py');
  const child: ChildProcessWithoutNullStreams = spawn(
    'uv',
    ['run', '--quiet', '--project', oracleProject(), 'python', script, '--serve'],
    { stdio: ['pipe', 'pipe', 'pipe'], env: { ...process.env, PYTHONIOENCODING: 'utf-8' } },
  );
  const stderr: string[] = [];
  child.stderr.setEncoding('utf8');
  child.stderr.on('data', (chunk: string) => {
    stderr.push(chunk);
    if (stderr.length > 200) stderr.shift();
  });
  const pending = new Map<number, Pending>();
  let nextId = 1;
  let ready: (() => void) | null = null;
  let failed: Error | null = null;
  const fail = (error: Error): void => {
    failed ??= error;
    for (const p of pending.values()) p.reject(error);
    pending.clear();
  };
  const readyPromise = new Promise<void>((resolve, reject) => {
    ready = resolve;
    child.once('error', (error) => {
      reject(new Error(`could not start uv (is it on PATH?): ${error.message}`));
    });
    child.once('exit', (code) => {
      const error = new Error(`fuzz_oracle.py exited with ${String(code)}:\n${stderr.join('').slice(-4000)}`);
      reject(error);
      fail(error);
    });
  });
  const lines = createInterface({ input: child.stdout });
  lines.on('line', (line) => {
    if (line.trim() === '') return;
    const message = JSON.parse(line) as { ready?: boolean; id?: number; error?: string } & Partial<OracleResponse>;
    if (message.ready === true) {
      ready?.();
      return;
    }
    const entry = message.id === undefined ? undefined : pending.get(message.id);
    if (entry === undefined || message.id === undefined) return;
    pending.delete(message.id);
    if (message.error !== undefined) entry.reject(new Error(`fuzz_oracle.py: ${message.error}`));
    else entry.resolve({ results: message.results ?? {}, oracles: message.oracles ?? {} });
  });
  await readyPromise;
  return {
    request(texts) {
      if (failed !== null) return Promise.reject(failed);
      const id = nextId++;
      return new Promise<OracleResponse>((resolve, reject) => {
        pending.set(id, { resolve, reject });
        child.stdin.write(`${asciiJson({ id, texts })}\n`);
      });
    },
    close() {
      return new Promise<void>((resolve) => {
        if (child.exitCode !== null) {
          resolve();
          return;
        }
        child.removeAllListeners('exit');
        child.once('exit', () => {
          resolve();
        });
        child.stdin.end();
      });
    },
  };
}
