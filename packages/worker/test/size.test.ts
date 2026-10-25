/**
 * The Worker host chunk stays within its budget (06 §3: "Worker core (loader + protocol + host)" ≤ 12 KB brotli):
 * `src/entry.ts` bundled with esbuild, the engine chunks external (they are lazy `import()`s), minified, brotli-11.
 * The integrator's `size-limit` run on the real Vite build (`assets/entry-*.js`) is authoritative; this catches a
 * regression early, e.g. an engine module pulled into the host chunk by a static import.
 */
import { existsSync } from 'node:fs';
import { brotliCompressSync, constants } from 'node:zlib';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';
import { describe, expect, it } from 'vitest';

const ENTRY = fileURLToPath(new URL('../src/entry.ts', import.meta.url));
const GENERATED = fileURLToPath(new URL('../src/generated/engine-config.json', import.meta.url));
const BUDGET = 12 * 1024;

describe.skipIf(!existsSync(GENERATED))('Worker host chunk size', () => {
  it('bundles entry.ts without engine code within 12 KiB brotli', async () => {
    const external: string[] = [];
    const result = await build({
      entryPoints: [ENTRY],
      bundle: true,
      minify: true,
      format: 'esm',
      target: ['es2022', 'safari16.4', 'chrome109', 'firefox115'],
      write: false,
      metafile: true,
      logLevel: 'silent',
      plugins: [
        {
          name: 'lazy-engines-external',
          setup(b) {
            b.onResolve({ filter: /\/engines\// }, (args) => {
              external.push(args.path);
              return { path: args.path, external: true };
            });
          },
        },
      ],
    });
    const code = result.outputFiles[0]?.contents ?? new Uint8Array(0);
    const brotli = brotliCompressSync(code, { params: { [constants.BROTLI_PARAM_QUALITY]: 11 } }).length;
    if (process.env['TSBS_PERF'] === '1')
      console.info(`entry chunk: ${String(code.length)} B min, ${String(brotli)} B brotli`);
    expect(external.sort()).toEqual(['./engines/bytelevel.ts', './engines/spm.ts']);
    const inputs = Object.keys(result.metafile.inputs);
    expect(inputs.some((path) => /core\/src\/(engines|agenda|unicode)\//.test(path))).toBe(false);
    expect(brotli).toBeLessThanOrEqual(BUDGET);
  });
});
