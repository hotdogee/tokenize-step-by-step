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
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
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
  it('accept a well-formed dist', () => {
    const report = site();
    expect(report.errors).toEqual([]);
    // .assetsignore and the source map are not uploaded.
    expect(report.fileCount).toBe(7);
  });

  it('fail on a file of 21 MiB (hard limit 20 MiB) and warn above 8 MiB', () => {
    sparse(dist, 'assets/huge.bin', 21 * MiB);
    sparse(dist, 'assets/big.bin', 9 * MiB);
    const report = site();
    expect(report.errors).toEqual([expect.stringMatching(/^assets\/huge\.bin is 21\.0 MiB \(hard limit 20\.0 MiB/)]);
    expect(report.warnings).toEqual([expect.stringMatching(/^assets\/big\.bin is 9\.0 MiB/)]);
  });

  it('fail on dotfiles anywhere except the root .assetsignore', () => {
    write(dist, '.env', 'SECRET=1');
    write(dist, 'assets/.hidden/x.js', '');
    expect(site().errors).toEqual(['dotfile .env would be served', 'dotfile assets/.hidden/x.js would be served']);
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

  it('cross-check /tok against the manifest both ways, with size and sha256', () => {
    write(dist, 'tok/stray/000000000000.bin', 'x');
    expect(site().errors).toEqual(['/tok/stray/000000000000.bin is not listed in the vocab manifest']);
    rmSync(join(dist, 'tok/stray'), { recursive: true });

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
    rmSync(join(dist, 'tok/openai-cl100k_base'), { recursive: true });

    const entry = asset(vocab, 'xai-grok2', randomBytes(64));
    write(vocab, VOCAB_MANIFEST_FILE, manifest({ 'xai-grok2': { ...entry, sha256: 'f'.repeat(64) } }));
    const mismatch = site().errors;
    expect(mismatch).toContain(`manifest path ${entry.path} for xai-grok2 is not /tok/xai-grok2/<sha256[0:12]>.bin`);
    expect(mismatch).toContain(`manifest lists ${entry.path} but there is no such file`);
  });

  it('fail on a vocabulary asset above the per-asset limit', () => {
    const big = asset(vocab, 'google-gemma4', randomBytes(DIST_LIMITS.assetGzipBytes + 1));
    write(vocab, VOCAB_MANIFEST_FILE, manifest({ 'google-gemma4': big }));
    write(dist, big.path.slice(1), readFileSync(join(vocab, big.path.slice(1))));
    rmSync(join(dist, 'tok/openai-cl100k_base'), { recursive: true });
    expect(site().errors).toEqual([
      expect.stringMatching(/google-gemma4\/.*\.bin is 1740\.8 KB gzip \(limit 1740\.8 KB/),
    ]);
  });

  it('fail without the manifest', () => {
    rmSync(join(vocab, VOCAB_MANIFEST_FILE));
    expect(site().errors).toEqual([expect.stringMatching(/^missing .*vocab-manifest\.generated\.json/)]);
  });

  it('enforce the _headers rule count and line length', () => {
    const many = Array.from({ length: 101 }, (_, i) => `/p${String(i)}/*\n  X-Test: ${String(i)}\n`).join('');
    write(dist, '_headers', many);
    expect(site().errors).toEqual(['_headers has 101 rules (limit 100)']);
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

  it('require the three HTML entries and the index.html brotli budget', () => {
    rmSync(join(dist, '404.html'));
    write(dist, 'index.html', page(randomBytes(30 * 1024).toString('base64')));
    expect(site().errors).toEqual([
      '404.html is missing from dist',
      expect.stringMatching(/^index\.html is \d+\.\d KB brotli \(budget 14\.0 KB\)$/),
    ]);
  });

  it('cap each examples/*.json at 16 KB gzip', () => {
    write(
      dist,
      'examples/openai-o200k_base.0123abcd.json',
      JSON.stringify({ x: randomBytes(24 * 1024).toString('hex') }),
    );
    expect(site().errors).toEqual([
      expect.stringMatching(/^examples\/openai-o200k_base\.0123abcd\.json is .* KB gzip/),
    ]);
  });

  it('count deployable files against the 2,000-file budget', () => {
    for (let i = 0; i < 1994; i += 1) write(dist, `assets/f${String(i)}.txt`, '');
    expect(site().errors).toEqual(['2001 deployable files (budget 2000)']);
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
});
