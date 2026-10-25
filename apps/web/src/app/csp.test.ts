/**
 * Strict CSP (AD-15, PA-2a): Svelte 5 instantiates static markup by cloning template HTML, so a `style="…"` in a compiled
 * client template would be an inline style that `style-src 'self'` blocks. Every component is compiled the way the
 * production build compiles it and its templates are checked; `style:` directives compile to CSSOM writes instead.
 * (Server rendering prints `style:` directives as attributes, but the site never server-renders.)
 */
import { compile } from 'svelte/compiler';
import { describe, expect, it } from 'vitest';

const components = import.meta.glob<string>('../**/*.svelte', { query: '?raw', import: 'default', eager: true });

describe('compiled client components', () => {
  it('finds the shell, app and about components', () => {
    expect(Object.keys(components).length).toBeGreaterThanOrEqual(20);
  });

  for (const [path, source] of Object.entries(components)) {
    it(`${path} has no inline style or runtime <style> in its client output`, () => {
      const { js, css } = compile(source, { filename: path, generate: 'client', css: 'external', runes: true });
      expect(js.code).not.toMatch(/\sstyle=\\?["']/);
      expect(js.code).not.toContain('append_styles');
      expect(css === null || !js.code.includes(css.code)).toBe(true);
    });
  }
});
