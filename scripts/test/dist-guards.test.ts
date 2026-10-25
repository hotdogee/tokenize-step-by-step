import { createHash, randomBytes } from 'node:crypto';
import {
  closeSync,
  ftruncateSync,
  mkdirSync,
  mkdtempSync,
  openSync,
  readdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { GUARD_LIMITS, runGuard } from '@tsbs/vocab-tools';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  checkWorkerEntries,
  DIST_LIMITS,
  dotfiles,
  isAssetIgnored,
  parseAssetsIgnore,
  runGuards,
  VOCAB_MANIFEST_FILE,
} from '../lib/dist-guards.ts';

const HEADERS = readFileSync(new URL('../../apps/web/public/_headers', import.meta.url), 'utf8');
const ASSETSIGNORE = readFileSync(new URL('../../apps/web/public/.assetsignore', import.meta.url), 'utf8');
const MiB = 1024 * 1024;
const BOOT = 'assets/boot-0123abcd.js';
/** The Worker as Vite emits it: a chunk constructs `entry-*.js`, which imports `entry-core-*.js` like the engines do. */
const WORKER_FILES = {
  'assets/lazy-entry-AbCd1234.js': 'function r(e){return new Worker("/assets/entry-Ef56Gh78.js",{type:"module"})}',
  'assets/entry-Ef56Gh78.js': 'import{s as t}from"./entry-core-Ij90Kl12.js";t(self);',
  'assets/entry-core-Ij90Kl12.js': 'export function s(e){}',
  'assets/bytelevel-Mn34Op56.js': 'import{s}from"./entry-core-Ij90Kl12.js";export{s};',
} as const;

/** A page whose <head> starts with the classic boot script (AD-15). */
const page = (title: string): string =>
  `<!doctype html>\n<html lang="en">\n  <head>\n    <script src="/${BOOT}"></script>\n    <meta charset="utf-8" />\n    <title>${title}</title>\n    <script type="module" crossorigin src="/assets/main-AbCd1234.js"></script>\n  </head>\n  <body><div id="app"></div></body>\n</html>\n`;

let root = '';
let dist = '';
let vocab = '';

function write(base: string, file: string, content: string | Uint8Array): void {
  mkdirSync(dirname(join(base, file)), { recursive: true });
  writeFileSync(join(base, file), content);
}

/** Creates a sparse file of `bytes` bytes (fast, no 21 MiB write). */
function sparse(base: string, file: string, bytes: number): void {
  mkdirSync(dirname(join(base, file)), { recursive: true });
  const fd = openSync(join(base, file), 'w');
  ftruncateSync(fd, bytes);
  closeSync(fd);
}

/** Writes one `.bin` into `<base>/tok/<id>/` and returns its manifest entry. */
function asset(
  base: string,
  id: string,
  content: Uint8Array,
): { path: string; bytesCompressed: number; sha256: string } {
  const sha256 = createHash('sha256').update(content).digest('hex');
  const path = `/tok/${id}/${sha256.slice(0, 12)}.bin`;
  write(base, path.slice(1), content);
  return { path, bytesCompressed: content.length, sha256 };
}

function manifest(assets: Record<string, unknown>): string {
  return JSON.stringify({ schema: 1, builtOn: '2026-10-25', generator: '@tsbs/vocab-tools@0.0.0', assets });
}

const site = () => runGuards({ mode: 'site', dist, manifest: join(vocab, VOCAB_MANIFEST_FILE) });

/** `pnpm check:dist`: this script's site mode and `tsbs-vocab guard`, on the same directory. */
async function checkDist(): Promise<{ errors: string[]; warnings: string[] }> {
  const ours = site();
  const guard = await runGuard({ dist, manifest: join(vocab, VOCAB_MANIFEST_FILE) });
  return { errors: [...ours.errors, ...guard.errors], warnings: [...ours.warnings, ...guard.warnings] };
}

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'tsbs-dist-'));
  dist = join(root, 'dist');
  vocab = join(root, 'vocab');
  write(dist, 'index.html', page('Tokenize step by step'));
  write(dist, 'about/index.html', page('About'));
  write(dist, '404.html', page('Not found'));
  write(dist, BOOT, '(()=>{})();');
  write(dist, 'assets/main-AbCd1234.js', 'export {};');
  write(dist, 'assets/main-AbCd1234.js.map', '{}');
  for (const [file, text] of Object.entries(WORKER_FILES)) write(dist, file, text);
  write(dist, '_headers', HEADERS);
  write(dist, '.assetsignore', ASSETSIGNORE);
  const entry = asset(vocab, 'openai-cl100k_base', randomBytes(4096));
  write(vocab, VOCAB_MANIFEST_FILE, manifest({ 'openai-cl100k_base': entry }));
  write(dist, entry.path.slice(1), readFileSync(join(vocab, entry.path.slice(1))));
});

afterEach(() => {
  rmSync(root, { recursive: true, force: true });
});

describe('site guards (check:dist)', () => {
  it('accept a well-formed dist', async () => {
    const report = site();
    expect(report.errors).toEqual([]);
    // .assetsignore and the source map are not uploaded.
    expect(report.fileCount).toBe(11);
    expect((await checkDist()).errors).toEqual([]);
  });

  it('fail when .assetsignore is missing or incomplete', () => {
    write(dist, '.assetsignore', '.vite/\n');
    expect(site().errors).toEqual([
      '.assetsignore does not list *.map (06 §5)',
      '.assetsignore does not list .DS_Store (06 §5)',
      '.assetsignore does not list Thumbs.db (06 §5)',
    ]);
    rmSync(join(dist, '.assetsignore'));
    expect(site().errors).toContain('.assetsignore is missing from dist');
  });

  it('check each listed .bin for size, sha256 and path form', () => {
    const [file] = readdirSync(join(dist, 'tok/openai-cl100k_base'));
    write(dist, `tok/openai-cl100k_base/${String(file)}`, randomBytes(4096));
    expect(site().errors).toEqual([
      expect.stringMatching(/^\/tok\/openai-cl100k_base\/.*\.bin does not match its manifest sha256$/),
    ]);
    write(dist, `tok/openai-cl100k_base/${String(file)}`, randomBytes(10));
    expect(site().errors).toEqual([
      expect.stringMatching(/\.bin is 10 B but the manifest says 4096 B$/),
      expect.stringMatching(/\.bin does not match its manifest sha256$/),
    ]);

    const entry = asset(vocab, 'xai-grok2', randomBytes(64));
    write(dist, entry.path.slice(1), readFileSync(join(vocab, entry.path.slice(1))));
    write(vocab, VOCAB_MANIFEST_FILE, manifest({ 'xai-grok2': { ...entry, sha256: 'f'.repeat(64) } }));
    expect(site().errors).toEqual([
      `manifest path ${entry.path} for xai-grok2 is not /tok/xai-grok2/<sha256[0:12]>.bin`,
      `${entry.path} does not match its manifest sha256`,
    ]);
  });

  it('fail without the manifest', () => {
    rmSync(join(vocab, VOCAB_MANIFEST_FILE));
    expect(site().errors).toEqual([expect.stringMatching(/^missing .*vocab-manifest\.generated\.json/)]);
  });

  it('enforce the _headers syntax and line length', () => {
    write(dist, '_headers', `/*\n  X-Long: ${'a'.repeat(2000)}\n`);
    expect(site().errors).toEqual(['_headers line 2 is 2008 characters (limit 2000)']);
    write(dist, '_headers', '  X-Orphan: 1\n');
    expect(site().errors).toEqual(['_headers line 1: header outside a path block']);
  });

  it('require the classic boot script first in <head> and no inline script or style', () => {
    write(dist, 'about/index.html', page('About').replace(`<script src="/${BOOT}"></script>`, '<meta name="x" />'));
    write(dist, '404.html', page('Not found').replace('<body>', '<body style="color:red"><script>1</script>'));
    expect(site().errors).toEqual([
      "404.html: inline <script> (blocked by script-src 'self')",
      "404.html: inline style (blocked by style-src 'self')",
      'about/index.html: the first element of <head> is not the classic boot script',
    ]);
  });

  it('require the About and 404 pages', () => {
    rmSync(join(dist, '404.html'));
    rmSync(join(dist, 'about'), { recursive: true });
    expect(site().errors).toEqual(['about/index.html is missing from dist', '404.html is missing from dist']);
  });

  it('fail when a chunk imports the Worker entry chunk (WebKit evaluates it twice)', () => {
    write(dist, 'assets/bytelevel-Mn34Op56.js', 'import{f as z}from"./entry-Ef56Gh78.js";export{z};');
    write(dist, 'assets/spm-Qr78St90.js', 'const m=import("./entry-Ef56Gh78.js");');
    expect(site().errors).toEqual([
      'assets/bytelevel-Mn34Op56.js imports the Worker entry assets/entry-Ef56Gh78.js (WebKit would evaluate the Worker script twice)',
      'assets/spm-Qr78St90.js imports the Worker entry assets/entry-Ef56Gh78.js (WebKit would evaluate the Worker script twice)',
    ]);
  });
});

describe('check:dist = site guards + tsbs-vocab guard: every violation is reported once', () => {
  it('shares the thresholds of vocab mode with tsbs-vocab guard', () => {
    expect(DIST_LIMITS.fileHardBytes).toBe(GUARD_LIMITS.fileHardBytes);
    expect(DIST_LIMITS.fileWarnBytes).toBe(GUARD_LIMITS.fileWarnBytes);
    expect(DIST_LIMITS.tokWarnBytes).toBe(GUARD_LIMITS.tokWarnTotalBytes);
    expect(Math.floor(GUARD_LIMITS.tokAssetBytes)).toBe(DIST_LIMITS.assetGzipBytes);
  });

  it.each([
    [
      'a 21 MiB file',
      () => {
        sparse(dist, 'assets/huge.bin', 21 * MiB);
      },
      /huge\.bin is 21\.0 MiB/,
    ],
    [
      'a dotfile',
      () => {
        write(dist, '.env', 'SECRET=1');
      },
      /dotfile \.env would be served/,
    ],
    [
      'an unlisted /tok file',
      () => {
        write(dist, 'tok/stray/000000000000.bin', 'x');
      },
      /stray\/000000000000\.bin/,
    ],
    [
      'more than 100 _headers rules',
      () => {
        write(dist, '_headers', Array.from({ length: 101 }, (_, i) => `/p${String(i)}/*\n  X-Test: 1\n`).join(''));
      },
      /101 rules/,
    ],
    [
      'an index.html above 14 KB brotli',
      () => {
        write(dist, 'index.html', page(randomBytes(30 * 1024).toString('base64')));
      },
      /index\.html is \d+ B brotli/,
    ],
    [
      'an examples file above 16 KB gzip',
      () => {
        write(
          dist,
          'examples/openai-o200k_base.0123abcd.json',
          JSON.stringify({ x: randomBytes(24 * 1024).toString('hex') }),
        );
      },
      /examples\/openai-o200k_base\.0123abcd\.json is \d+ B gzip/,
    ],
    [
      'more than 2,000 files',
      () => {
        for (let i = 0; i < 1990; i += 1) write(dist, `assets/f${String(i)}.txt`, '');
      },
      /files \(budget 2000\)/,
    ],
    [
      'a missing index.html',
      () => {
        rmSync(join(dist, 'index.html'));
      },
      /index\.html is missing/,
    ],
  ] as const)('%s', async (_name, breakIt, message) => {
    breakIt();
    const { errors } = await checkDist();
    expect(errors).toEqual([expect.stringMatching(message)]);
  });

  it('a manifest path without its file', async () => {
    rmSync(join(dist, 'tok/openai-cl100k_base'), { recursive: true });
    const { errors } = await checkDist();
    expect(errors).toEqual([
      expect.stringMatching(/manifest lists \/tok\/openai-cl100k_base\/.*\.bin but dist has no such file/),
    ]);
  });

  it('warns once above 8 MiB', async () => {
    sparse(dist, 'assets/big.bin', 9 * MiB);
    const { errors, warnings } = await checkDist();
    expect(errors).toEqual([]);
    expect(warnings).toEqual([expect.stringMatching(/^assets\/big\.bin is 9\.0 MiB/)]);
  });
});

describe('vocab guards (vocab:guard)', () => {
  it('check only tok/ and the manifest of the converter output', () => {
    write(vocab, 'licences.generated.json', '{}');
    expect(runGuards({ mode: 'vocab', dist: vocab })).toMatchObject({ errors: [], fileCount: 1 });
    sparse(vocab, 'tok/openai-o200k_base/aaaaaaaaaaaa.bin', 21 * MiB);
    write(vocab, 'tok/.DS_Store', '');
    expect(runGuards({ mode: 'vocab', dist: vocab }).errors).toEqual([
      expect.stringMatching(/^tok\/openai-o200k_base\/aaaaaaaaaaaa\.bin is 21\.0 MiB/),
      'dotfile tok/.DS_Store would be served',
      '/tok/.DS_Store is not listed in the vocab manifest',
      expect.stringMatching(/aaaaaaaaaaaa\.bin is not listed/),
    ]);
  });

  it('cross-check the manifest both ways and the per-asset ceiling', () => {
    const big = asset(vocab, 'google-gemma4', randomBytes(DIST_LIMITS.assetGzipBytes + 1));
    const missing = {
      path: '/tok/xai-grok2/aaaaaaaaaaaa.bin',
      bytesCompressed: 1,
      sha256: `aaaaaaaaaaaa${'0'.repeat(52)}`,
    };
    write(vocab, VOCAB_MANIFEST_FILE, manifest({ 'google-gemma4': big, 'xai-grok2': missing }));
    expect(runGuards({ mode: 'vocab', dist: vocab }).errors).toEqual([
      expect.stringMatching(/google-gemma4\/.*\.bin is 1740\.8 KB gzip \(limit 1740\.8 KB/),
      'manifest lists /tok/xai-grok2/aaaaaaaaaaaa.bin but there is no such file',
      expect.stringMatching(/^\/tok\/openai-cl100k_base\/.*\.bin is not listed in the vocab manifest$/),
    ]);
  });

  it('warn above 8 MiB and above a 12 MiB /tok total', () => {
    for (const name of ['a', 'b']) sparse(vocab, `tok/x/${name.repeat(12)}.bin`, 6.5 * MiB);
    expect(runGuards({ mode: 'vocab', dist: vocab }).warnings).toEqual(['/tok totals 13.0 MiB (warn above 12 MiB)']);
  });

  it('report a missing output directory', () => {
    expect(runGuards({ mode: 'vocab', dist: join(root, 'nope') }).errors).toEqual([
      expect.stringMatching(/does not exist — run pnpm vocab:build first$/),
    ]);
  });
});

describe('helpers', () => {
  it('match .assetsignore patterns the way 06 §5 uses them', () => {
    const patterns = parseAssetsIgnore('# comment\n*.map\n.vite/\n.DS_Store\n\nThumbs.db\n');
    expect(patterns).toEqual(['*.map', '.vite/', '.DS_Store', 'Thumbs.db']);
    expect(isAssetIgnored('assets/a.js.map', patterns)).toBe(true);
    expect(isAssetIgnored('.vite/manifest.json', patterns)).toBe(true);
    expect(isAssetIgnored('a/.DS_Store', patterns)).toBe(true);
    expect(isAssetIgnored('.assetsignore', patterns)).toBe(true);
    expect(isAssetIgnored('assets/a.js', patterns)).toBe(false);
    expect(isAssetIgnored('vite/x', patterns)).toBe(false);
  });

  it('find dotfiles by path segment', () => {
    expect(dotfiles(['.assetsignore', 'a/.b', '.c/d', 'e.f', 'g/.assetsignore'])).toEqual([
      'a/.b',
      '.c/d',
      'g/.assetsignore',
    ]);
  });

  it('find Worker entries and their importers; a site without a Worker is an error', () => {
    const errors: string[] = [];
    checkWorkerEntries(new Map(Object.entries(WORKER_FILES)), errors);
    expect(errors).toEqual([]);
    checkWorkerEntries(new Map([['assets/main-AbCd1234.js', 'export {};']]), errors);
    expect(errors).toEqual([expect.stringMatching(/^no chunk constructs the Worker/)]);
    errors.length = 0;
    checkWorkerEntries(new Map([['assets/a.js', 'new Worker("/assets/entry-x.js")']]), errors);
    expect(errors).toEqual(['the Worker entry assets/entry-x.js is not in dist']);
  });
});
