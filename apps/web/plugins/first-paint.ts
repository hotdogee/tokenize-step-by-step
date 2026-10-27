/**
 * `firstPaint()` — the static first paint of `/` (PA-15, the AD-16 fallback). Without it `index.html` ships an empty
 * `#app` and nothing paints until the main JS has run. During `vite build` this plugin server-renders the page's first
 * state (`src/app/prerender.ts`: the comparison table with the five precomputed default rows of 台灣台南 and the Advanced
 * disclosure closed, PA-19) once per UI locale and writes it into `index.html`:
 *
 *   <template id="fp-en">…page…</template>
 *   …one per locale…
 *   <div id="app" data-keep="t=&q=…&r=&s=&b=hex&tl=auto&tsbs%3Arows=&…"></div>
 *   <script src="/assets/first-paint-<hash>.js"></script>
 *   <script type="module" async fetchpriority="low" crossorigin src="/assets/main-<hash>.js"></script>
 *
 * One inert page template per locale holds the whole page; nothing in it depends on the viewport (the table's U+ labels
 * and narrow-screen sizes are CSS; the board, whose packing did, is not part of it any more: it lives in the closed
 * Advanced disclosure and loads as a lazy chunk). `#app[data-keep]` is the page state the markup shows
 * (`firstPaintKeep()`; a key with an empty value must be unset). The clone script (src/app/first-paint-script.ts,
 * compiled like boot.ts) runs while the parser stands after `#app`: it clones the template of the locale boot.js chose,
 * so the first layout and paint happen in the parser's task with the page on screen. The entry module moves after it as
 * an `async` script, so it runs in a task of its own (a deferred module that has already arrived runs in the parser's
 * last task, before the browser paints), and it and its modulepreloads get `fetchpriority="low"`: the first paint no
 * longer needs them. main.ts hydrates the clone (or mounts when there is none). The token ids' digits font (PA-17,
 * `font-display: block`) is preloaded right after the stylesheet, so its request starts with the CSS instead of after the
 * first layout and the chips are not painted empty while it loads.
 *
 * The render runs in a Vite SSR build of `prerender.ts` with the same Svelte plugin (its scoped class names hash the file
 * path, so they match the client's), registry trim and defines. The build fails when the markup has an inline `style`
 * attribute, `<style>` or `<script>` (the strict CSP blocks them, AD-15), or when a scoped class of the markup has no
 * rule in the bundle's CSS.
 */
import { createHash } from 'node:crypto';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { svelte } from '@sveltejs/vite-plugin-svelte';
import { build, type Plugin, type ResolvedConfig, type Rollup } from 'vite';
import { compileBoot } from './boot-script.ts';
import { registryTrim } from './registry-trim.ts';

/** The server entry's surface (src/app/prerender.ts). */
interface PrerenderModule {
  readonly LOCALES: readonly string[];
  renderFirstPaint(locale: string): string;
  firstPaintKeep(): string;
}

/** The `index.html` element the templates precede. */
export const APP_ELEMENT = '<div id="app"></div>';
/** The entry module script Vite writes into `<head>`. */
const ENTRY_SCRIPT = /<script type="module" crossorigin src="([^"]+)"><\/script>\s*/g;
/** The first stylesheet link Vite writes into `<head>` (the digits font's preload follows it). */
const STYLESHEET = /<link rel="stylesheet"[^>]*>/;
/** The emitted digits subset of the token ids (packages/ui-tokens fonts.css, PA-17). */
export const DIGITS_FONT = /(^|\/)tsbs-digits-[^/]+\.woff2$/;

/** `"`, `&`, `<`, `>` escaped for an attribute value in double quotes. */
export function attr(value: string): string {
  return value.replaceAll('&', '&amp;').replaceAll('"', '&quot;').replaceAll('<', '&lt;').replaceAll('>', '&gt;');
}

/** Throws when `markup` holds something the strict CSP blocks (AD-15). */
export function assertCspSafe(markup: string, what: string): void {
  const found = /<script|<style|\sstyle=/i.exec(markup);
  if (found !== null)
    throw new Error(`first-paint: ${what} holds "${found[0].trim()}", which the strict CSP blocks (AD-15)`);
}

/** The page template of one locale: its whole first render, inert until the clone script copies it into `#app`. */
export function pageTemplate(locale: string, markup: string): string {
  return `<template id="fp-${attr(locale)}">${markup}</template>`;
}

/**
 * `index.html` with the page templates before `#app`, the page state they show on it (`keep`), the clone script after
 * it (`clone`: its URL), the entry module moved after that as a low-priority `async` script (its modulepreloads low
 * priority too; a browser without `fetchpriority` ignores it), and a preload of the digits font (`font`: its URL) right
 * after the first stylesheet in `<head>`.
 */
export function injectFirstPaint(
  html: string,
  templates: readonly string[],
  keep: string,
  clone: string,
  font: string,
): string {
  if (html.split(APP_ELEMENT).length !== 2) throw new Error(`first-paint: index.html must hold ${APP_ELEMENT} once`);
  const entries = [...html.matchAll(ENTRY_SCRIPT)].map((match) => match[1] ?? '');
  if (entries.length !== 1) throw new Error('first-paint: index.html must hold one entry module script');
  const stylesheet = STYLESHEET.exec(html);
  const headEnd = html.indexOf('</head>');
  if (stylesheet === null || headEnd < 0 || stylesheet.index > headEnd)
    throw new Error('first-paint: index.html must hold a stylesheet link in <head>');
  const preload = `<link rel="preload" as="font" type="font/woff2" crossorigin href="${attr(font)}">`;
  const tail = [
    ...templates,
    `<div id="app" data-keep="${attr(keep)}"></div>`,
    `<script src="${attr(clone)}"></script>`,
    `<script type="module" async fetchpriority="low" crossorigin src="${attr(entries.join(''))}"></script>`,
  ];
  return html
    .replace(STYLESHEET, (link) => `${link}\n    ${preload}`)
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
  const templates = prerender.LOCALES.map((locale) => {
    const markup = prerender.renderFirstPaint(locale);
    assertCspSafe(markup, `the ${locale} first paint`);
    return pageTemplate(locale, markup);
  });
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
        const font = Object.values(ctx.bundle ?? {}).find(
          (file) => file.type === 'asset' && DIGITS_FONT.test(file.fileName),
        );
        if (font === undefined)
          throw new Error('first-paint: the build emitted no tsbs-digits-*.woff2 to preload (the token ids, PA-17)');
        return injectFirstPaint(html, templates, keep, clone, `${config.base}${font.fileName}`);
      },
    },
  };
}
