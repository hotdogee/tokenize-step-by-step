import { describe, expect, it } from 'vitest';
import { gridClassesCss, MAX_COLUMNS, MAX_K, MIN_COLUMNS } from './grid-classes.ts';

describe('gridClassesCss', () => {
  const css = gridClassesCss();

  it('emits one start class and one span class per column up to 128 (the comparison table’s window, PA-19)', () => {
    expect(MAX_COLUMNS).toBe(128);
    expect(css.match(/^\.c\d+ /gm)).toHaveLength(128);
    expect(css.match(/^\.s\d+ /gm)).toHaveLength(128);
    expect(css).toContain('.c64 { grid-column-start: 64; }');
    expect(css).toContain('.c128 { grid-column-start: 128; }');
    expect(css).toContain('.s128 { grid-column-end: span 128; --span: 128; }');
    expect(css).toContain('.s1 { grid-column-end: span 1; --span: 1; }');
    expect(css).not.toContain('.c129 ');
  });

  it('emits one column-count class per K from 8 to 64 (the board sets K with a class, never a style attribute)', () => {
    expect(MIN_COLUMNS).toBe(8);
    expect(MAX_K).toBe(64);
    expect(css.match(/^\.k\d+ /gm)).toHaveLength(57);
    expect(css).toContain('.k8 { --k: 8; }');
    expect(css).toContain('.k64 { --k: 64; }');
    expect(css).not.toContain('.k7 ');
    expect(css).not.toContain('.k65 ');
  });

  it('is deterministic', () => {
    expect(gridClassesCss()).toBe(css);
  });
});
