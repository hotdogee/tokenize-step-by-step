/**
 * `bootScript()` — the pre-paint bootstrap (AD-15, AD-29; 02 §5). Compiles `src/app/boot.ts` with esbuild into a minified
 * IIFE and injects it as the FIRST element of `<head>` of every HTML entry as a classic `<script src>` — no `type="module"`,
 * no `defer` — so `<html lang>` and `data-theme` are set before first paint without any inline script (strict CSP).
 *
 * Build: emitted as `assets/boot-<hash>.js` (hash of the compiled code, so output is deterministic). Dev: served from
 * memory at `/@tsbs/boot.js`. boot.ts is deliberately NOT a Rollup input: that would make it a deferred ES module.
 */
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { transformWithEsbuild, type Plugin, type ResolvedConfig } from 'vite';

/** URL the dev server serves the compiled boot script at. */
export const DEV_BOOT_URL = '/@tsbs/boot.js';

/** Compiles the boot entry to a minified IIFE targeting the browser floor (PD-5). */
export async function compileBoot(entry: string): Promise<string> {
  const source = await readFile(entry, 'utf8');
  const result = await transformWithEsbuild(source, entry, {
    loader: 'ts',
    format: 'iife',
    minify: true,
    target: 'safari16.4',
    legalComments: 'none',
    charset: 'utf8',
  });
  return result.code;
}

/** `<assetsDir>/boot-<8 hex of sha256(code)>.js`. */
export function bootFileName(code: string, assetsDir: string): string {
  return `${assetsDir}/boot-${createHash('sha256').update(code).digest('hex').slice(0, 8)}.js`;
}

export interface BootScriptOptions {
  /** Boot entry, relative to the Vite root. */
  readonly entry?: string;
}

export function bootScript(options: BootScriptOptions = {}): Plugin {
  let config: ResolvedConfig | undefined;
  let entry = '';
  let fileName = '';
  return {
    name: 'tsbs:boot-script',
    configResolved(resolved) {
      config = resolved;
      entry = resolve(resolved.root, options.entry ?? 'src/app/boot.ts');
    },
    async buildStart() {
      if (config?.command !== 'build') return;
      const code = await compileBoot(entry);
      fileName = bootFileName(code, config.build.assetsDir);
      this.addWatchFile(entry);
      this.emitFile({ type: 'asset', fileName, source: code });
    },
    configureServer(server) {
      server.middlewares.use(DEV_BOOT_URL, (_req, res, next) => {
        compileBoot(entry).then((code) => {
          res.setHeader('Content-Type', 'text/javascript; charset=utf-8');
          res.end(code);
        }, next);
      });
    },
    transformIndexHtml: {
      order: 'post',
      handler() {
        const src = config?.command === 'build' ? `${config.base}${fileName}` : DEV_BOOT_URL;
        return [{ tag: 'script', attrs: { src }, injectTo: 'head-prepend' }];
      },
    },
  };
}
