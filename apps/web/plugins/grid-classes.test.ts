import { describe, expect, it } from 'vitest';
import { gridClassesCss, MAX_COLUMNS } from './grid-classes.ts';

describe('gridClassesCss', () => {
  const css = gridClassesCss();

  it('emits one start class and one span class per column up to K = 64', () => {
    expect(MAX_COLUMNS).toBe(64);
    expect(css.match(/^\.c\d+ /gm)).toHaveLength(64);
    expect(css.match(/^\.s\d+ /gm)).toHaveLength(64);
    expect(css).toContain('.c64 { grid-column-start: 64; }');
    expect(css).toContain('.s1 { grid-column-end: span 1; }');
  });

  it('is deterministic', () => {
    expect(gridClassesCss()).toBe(css);
  });
});
