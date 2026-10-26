/**
 * `firstPaint()` — the static first paint of `/` (PA-15, the AD-16 fallback). Without it `index.html` ships an empty
 * `#app` and nothing paints until the main JS has run. During `vite build` this plugin server-renders the page's first
 * state (`src/app/prerender.ts`: the precomputed default example at stop 6) for each UI locale and each board variant and
 * writes it into `index.html`:
 *
 *   <template id="fp-en">…page…<template data-mq="(min-width: 1024px)" data-fp="{…}">…board…</template>…</template>
 *   …one per locale…
 *   <div id="app" data-keep="t=…&q=…&tsbs%3AbyteView=hex&…"></div>
 *   <script src="/assets/first-paint-<hash>.js"></script>
 *   <script type="module" async fetchpriority="low" crossorigin src="/assets/main-<hash>.js"></script>
 *
 * One inert page template per locale holds the markup outside the board once; each board variant is a nested template at
 * the board's place, with the media query it applies to and the view it was rendered for (`data-fp`, app/first-paint.ts).
 * `#app[data-keep]` is the page state the markup shows (`firstPaintKeep()`). The clone script (src/app/first-paint-script.ts,
 * compiled like boot.ts) runs while the parser stands after `#app`: it clones the template of the locale boot.js chose,
 * with the first variant whose query matches, so the first layout and paint happen in the parser's task with the page on
 * screen. The entry module moves after it as an `async` script, so it runs in a task of its own (a deferred module that
 * has already arrived runs in the parser's last task, before the browser paints), and it and its modulepreloads get
 * `fetchpriority="low"`: the first paint no longer needs them. main.ts hydrates the clone (or mounts when there is none).
 *
 * The board's row packing, its inspector surface and its labels depend on the viewport (05 §3.3), so its variants are
 * rendered per width range at the default cell size M (`#app[data-keep]` requires it): K = ⌊(width − 32 px) / cell⌋,
 * and the default example's twelve bytes, three per character, are one row from K = 12 on, 3 + 1 characters at K 9–11 and
 * 2 + 2 at K 8. A variant is packed for the smallest K of its range, so the board only widens when it measures the real
 * one after hydration; nothing moves. 464–479 px (one row, no labels) has no variant and mounts as before.
 *
 * The render runs in a Vite SSR build of `prerender.ts` with the same Svelte plugin (its scoped class names hash the file
 * path, so they match the client's), registry trim and defines. The build fails when the markup has an inline `style`
 * attribute, `<style>` or `<script>` (the strict CSP blocks them, AD-15), when a locale's variants differ outside the
 * board, or when a scoped class of the markup has no rule in the bundle's CSS.
 */
import { createHash } from 'node:crypto';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { svelte } from '@sveltejs/vite-plugin-svelte';
import { build, type Plugin, type ResolvedConfig, type Rollup } from 'vite';
import { compileBoot } from './boot-script.ts';
import { registryTrim } from './registry-trim.ts';

/** What a board variant was rendered for (mirrors `FirstPaintView` in src/app/first-paint.ts). */
export interface BoardView {
  readonly k: number;
  readonly wide: boolean;
  readonly medium: boolean;
  readonly small: boolean;
}

export interface BoardVariant {
  /** Media query of the widths it applies to (the clone script takes the first that matches). */
  readonly media: string;
  readonly view: BoardView;
}

/** The board variants, widest first (tokens.css cell sizes at M: 36 px below 768, 32 px to 1023, 30 px from 1024). */
export const BOARD_VARIANTS: readonly BoardVariant[] = [
  // Side rail; K ≥ 18 at any cell size: one row.
  { media: '(min-width: 1024px)', view: { k: 12, wide: true, medium: true, small: true } },
  // Anchored panel; K ≥ 20: one row.
  { media: '(min-width: 768px) and (max-width: 1023.98px)', view: { k: 12, wide: false, medium: true, small: true } },
  // Bottom sheet, U+ labels and the id line on the board; K ≥ 12: one row.
  { media: '(min-width: 480px) and (max-width: 767.98px)', view: { k: 12, wide: false, medium: false, small: true } },
  // Phones: bottom sheet, no labels; K 9–11: rows of 3 + 1 characters.
  { media: '(min-width: 356px) and (max-width: 463.98px)', view: { k: 9, wide: false, medium: false, small: false } },
  // 320–355 px: K 8: rows of 2 + 2 characters.
  { media: '(max-width: 355.98px)', view: { k: 8, wide: false, medium: false, small: false } },
];

/** The server entry's surface (src/app/prerender.ts). */
interface PrerenderModule {
  readonly LOCALES: readonly string[];
  renderFirstPaint(locale: string, view: BoardView): string;
  firstPaintKeep(): string;
}

/** The `index.html` element the templates precede. */
export const APP_ELEMENT = '<div id="app"></div>';
/** Where the Board component's markup starts (Board.svelte's root element). */
const BOARD_START = '<section class="board-region';
/** The entry module script Vite writes into `<head>`. */
const ENTRY_SCRIPT = /<script type="module" crossorigin src="([^"]+)"><\/script>\s*/g;

/** `"`, `&`, `<`, `>` escaped for an attribute value in double quotes. */
export function attr(value: string): string {
  return value.replaceAll('&', '&amp;').replaceAll('"', '&quot;').replaceAll('<', '&lt;').replaceAll('>', '&gt;');
}

/** One render cut at the board: `prefix + board + suffix` is the whole markup. */
export interface BoardCut {
  readonly prefix: string;
  readonly board: string;
  readonly suffix: string;
}

/** Cuts `markup` around its one board section (the `<section>` that starts with `BOARD_START`, nesting counted). */
export function cutBoard(markup: string): BoardCut {
  const start = markup.indexOf(BOARD_START);
  if (start < 0 || markup.includes(BOARD_START, start + 1))
    throw new Error('first-paint: the markup must hold exactly one board section');
  const tags = /<(\/?)section[\s>]/g;
  tags.lastIndex = start;
  let depth = 0;
  for (let match = tags.exec(markup); match !== null; match = tags.exec(markup)) {
    depth += match[1] === '/' ? -1 : 1;
    if (depth === 0) {
      const end = markup.indexOf('>', match.index) + 1;
      return { prefix: markup.slice(0, start), board: markup.slice(start, end), suffix: markup.slice(end) };
    }
  }
  throw new Error('first-paint: the board section is not closed');
}

/** Throws when `markup` holds something the strict CSP blocks (AD-15). */
export function assertCspSafe(markup: string, what: string): void {
  const found = /<script|<style|\sstyle=/i.exec(markup);
  if (found !== null)
    throw new Error(`first-paint: ${what} holds "${found[0].trim()}", which the strict CSP blocks (AD-15)`);
}

/** The page template of one locale: its variants' common markup with each board in a nested template. */
export function pageTemplate(
  locale: string,
  renders: ReadonlyArray<{ variant: BoardVariant; markup: string }>,
): string {
  const cuts = renders.map(({ variant, markup }) => ({ variant, ...cutBoard(markup) }));
  const [first] = cuts;
  if (first === undefined) throw new Error('first-paint: no board variant');
  for (const cut of cuts)
    if (cut.prefix !== first.prefix || cut.suffix !== first.suffix)
      throw new Error(`first-paint: the ${locale} variants differ outside the board (${cut.variant.media})`);
  const boards = cuts
    .map(
      ({ variant, board }) =>
        `<template data-mq="${attr(variant.media)}" data-fp="${attr(JSON.stringify(variant.view))}">${board}</template>`,
    )
    .join('');
  return `<template id="fp-${attr(locale)}">${first.prefix}${boards}${first.suffix}</template>`;
}

/**
 * `index.html` with the page templates before `#app`, the page state they show on it (`keep`), the clone script after
 * it (`clone`: its URL), and the entry module moved after that as a low-priority `async` script (its modulepreloads low
 * priority too; a browser without `fetchpriority` ignores it).
 */
export function injectFirstPaint(html: string, templates: readonly string[], keep: string, clone: string): string {
  if (html.split(APP_ELEMENT).length !== 2) throw new Error(`first-paint: index.html must hold ${APP_ELEMENT} once`);
  const entries = [...html.matchAll(ENTRY_SCRIPT)].map((match) => match[1] ?? '');
  if (entries.length !== 1) throw new Error('first-paint: index.html must hold one entry module script');
  const tail = [
    ...templates,
    `<div id="app" data-keep="${attr(keep)}"></div>`,
    `<script src="${attr(clone)}"></script>`,
    `<script type="module" async fetchpriority="low" crossorigin src="${attr(entries.join(''))}"></script>`,
  ];
  return html
    .replace(ENTRY_SCRIPT, '')
    .replace(APP_ELEMENT, () => tail.join('\n    '))
    .replaceAll('<link rel="modulepreload" ', '<link rel="modulepreload" fetchpriority="low" ');
}

/** Scoped Svelte classes (`svelte-<hash>`) of `markup` that no stylesheet of the bundle has a rule for. */
export function unstyledScopes(markup: string, css: string): string[] {
  const scopes = new Set(markup.match(/\bsvelte-[a-z0-9]+\b/g));
  return [...scopes].filter((scope) => !css.includes(`.${scope}`));
}

/** Resolves `?worker` imports to an empty class: the prerender never starts the tokenizer (bootstrap.ts imports lazily). */
function workerStub(): Plugin {
  const STUB = '\0tsbs-first-paint:worker';
  return {
    name: 'tsbs:first-paint-worker-stub',
    enforce: 'pre',
    resolveId: (source) => (source.endsWith('?worker') ? STUB : null),
    load: (id) => (id === STUB ? 'export default class {}' : null),
  };
}

/** Builds `src/app/prerender.ts` for Node like the client is built (same Svelte setup, registry trim, defines). */
async function loadPrerender(config: ResolvedConfig): Promise<PrerenderModule> {
  const outDir = resolve(config.root, '../../node_modules/.cache/tsbs/first-paint');
  await build({
    configFile: false,
    root: config.root,
    mode: config.mode,
    logLevel: 'warn',
    define: config.define ?? {},
    css: { transformer: 'lightningcss' },
    plugins: [workerStub(), svelte(), registryTrim()],
    ssr: { noExternal: true },
    build: {
      ssr: 'src/app/prerender.ts',
      outDir,
      emptyOutDir: true,
      copyPublicDir: false,
      minify: false,
      sourcemap: false,
      reportCompressedSize: false,
      rollupOptions: { output: { entryFileNames: 'prerender.mjs', inlineDynamicImports: true } },
    },
  });
  // A fresh URL per build, so a watch rebuild in the same process imports the new bundle.
  const url = pathToFileURL(resolve(outDir, 'prerender.mjs'));
  url.searchParams.set('build', String(Date.now()));
  return (await import(url.href)) as PrerenderModule;
}

/** The page templates (one per locale) and the page state they show. */
async function renderTemplates(config: ResolvedConfig): Promise<{ templates: string[]; keep: string }> {
  const prerender = await loadPrerender(config);
  const templates = prerender.LOCALES.map((locale) =>
    pageTemplate(
      locale,
      BOARD_VARIANTS.map((variant) => {
        const markup = prerender.renderFirstPaint(locale, variant.view);
        assertCspSafe(markup, `the ${locale} first paint (${variant.media})`);
        return { variant, markup };
      }),
    ),
  );
  return { templates, keep: prerender.firstPaintKeep() };
}

export interface FirstPaintOptions {
  /** The clone script's entry, relative to the Vite root. */
  readonly script?: string;
}

export function firstPaint(options: FirstPaintOptions = {}): Plugin {
  let config: ResolvedConfig | undefined;
  let clone = '';
  return {
    name: 'tsbs:first-paint',
    apply: 'build',
    configResolved(resolved) {
      config = resolved;
    },
    async buildStart() {
      if (config === undefined) return;
      const entry = resolve(config.root, options.script ?? 'src/app/first-paint-script.ts');
      const code = await compileBoot(entry);
      const hash = createHash('sha256').update(code).digest('hex').slice(0, 8);
      const fileName = `${config.build.assetsDir}/first-paint-${hash}.js`;
      this.addWatchFile(entry);
      this.emitFile({ type: 'asset', fileName, source: code });
      clone = `${config.base}${fileName}`;
    },
    transformIndexHtml: {
      order: 'post',
      async handler(html, ctx) {
        if (ctx.path !== '/index.html' || config === undefined) return html;
        const { templates, keep } = await renderTemplates(config);
        const css = Object.values(ctx.bundle ?? {})
          .filter((file): file is Rollup.OutputAsset => file.type === 'asset' && file.fileName.endsWith('.css'))
          .map((file) => String(file.source))
          .join('\n');
        const unstyled = unstyledScopes(templates.join(''), css);
        if (unstyled.length > 0)
          throw new Error(
            `first-paint: no CSS rule for ${unstyled.join(', ')} — the server and client builds hash scoped classes differently`,
          );
        return injectFirstPaint(html, templates, keep, clone);
      },
    },
  };
}
