import { describe, expect, it } from 'vitest';
import { isComposing, matchShortcut, SHORTCUT_GROUPS, type KeyLike, type ShortcutContext } from './shortcuts.ts';

const ON: ShortcutContext = { enabled: true, inEditable: false, inDialog: false };
const key = (init: Partial<KeyLike> & Pick<KeyLike, 'key' | 'code'>): KeyLike => ({
  shiftKey: false,
  ctrlKey: false,
  altKey: false,
  metaKey: false,
  ...init,
});

describe('matchShortcut (AD-22)', () => {
  it('matches punctuation by event.code, so Shift+, (key "<") is ×10 back', () => {
    expect(matchShortcut(key({ key: ',', code: 'Comma' }), ON)).toEqual({ kind: 'step', delta: -1 });
    expect(matchShortcut(key({ key: '<', code: 'Comma', shiftKey: true }), ON)).toEqual({ kind: 'step', delta: -10 });
    expect(matchShortcut(key({ key: '>', code: 'Period', shiftKey: true }), ON)).toEqual({ kind: 'step', delta: 10 });
    expect(matchShortcut(key({ key: '[', code: 'BracketLeft' }), ON)).toEqual({ kind: 'stage', delta: -1 });
    expect(matchShortcut(key({ key: ']', code: 'BracketRight' }), ON)).toEqual({ kind: 'stage', delta: 1 });
  });

  it('works on a JIS layout: keys differ, codes do not', () => {
    // JIS: Shift+/ gives "?" on the Slash key; the key labelled "[" sits on BracketRight and reports "[".
    expect(matchShortcut(key({ key: '?', code: 'Slash', shiftKey: true }), ON)).toEqual({ kind: 'help' });
    expect(matchShortcut(key({ key: '/', code: 'Slash' }), ON)).toEqual({ kind: 'focusText' });
    expect(matchShortcut(key({ key: '@', code: 'BracketLeft' }), ON)).toEqual({ kind: 'stage', delta: -1 });
    expect(matchShortcut(key({ key: '!', code: 'Digit1', shiftKey: true }), ON)).toBeNull();
  });

  it('jumps to stops 1–6 with the digit row only', () => {
    expect(matchShortcut(key({ key: '3', code: 'Digit3' }), ON)).toEqual({ kind: 'jump', stage: 3 });
    expect(matchShortcut(key({ key: '7', code: 'Digit7' }), ON)).toBeNull();
    expect(matchShortcut(key({ key: '3', code: 'Numpad3' }), ON)).toBeNull();
  });

  it('matches letters by event.key case-insensitively', () => {
    expect(matchShortcut(key({ key: 'h', code: 'KeyH' }), ON)).toEqual({ kind: 'byteView' });
    expect(matchShortcut(key({ key: 'G', code: 'KeyG' }), ON)).toEqual({ kind: 'graphemes' });
    expect(matchShortcut(key({ key: 't', code: 'KeyT' }), ON)).toEqual({ kind: 'picker' });
    expect(matchShortcut(key({ key: 'i', code: 'KeyI' }), ON)).toBeNull(); // component-scoped (board)
    expect(matchShortcut(key({ key: 'c', code: 'KeyC' }), ON)).toBeNull(); // component-scoped (board)
  });

  it('is fully disabled by "Single-key shortcuts: off" (WCAG 2.1.4)', () => {
    const off: ShortcutContext = { ...ON, enabled: false };
    for (const event of [
      key({ key: '[', code: 'BracketLeft' }),
      key({ key: ',', code: 'Comma' }),
      key({ key: '1', code: 'Digit1' }),
      key({ key: 'h', code: 'KeyH' }),
      key({ key: '?', code: 'Slash', shiftKey: true }),
      key({ key: '/', code: 'Slash' }),
    ])
      expect(matchShortcut(event, off)).toBeNull();
  });

  it('ignores editables, dialogs, modifier chords and IME composition', () => {
    const h = key({ key: 'h', code: 'KeyH' });
    expect(matchShortcut(h, { ...ON, inEditable: true })).toBeNull();
    expect(matchShortcut(h, { ...ON, inDialog: true })).toBeNull();
    expect(matchShortcut({ ...h, ctrlKey: true }, ON)).toBeNull();
    expect(matchShortcut({ ...h, metaKey: true }, ON)).toBeNull();
    expect(matchShortcut({ ...h, isComposing: true }, ON)).toBeNull();
    expect(matchShortcut(key({ key: 'Process', code: 'KeyH' }), ON)).toBeNull();
    expect(isComposing(key({ key: 'Unidentified', code: '', keyCode: 229 }))).toBe(true);
  });
});

describe('SHORTCUT_GROUPS', () => {
  it('marks exactly the global keys as single-key shortcuts', () => {
    const single = SHORTCUT_GROUPS.flatMap((group) => group.rows.filter((row) => row.singleKey));
    expect(single.map((row) => row.keys.join(' '))).toEqual(['[ ]', ', .', '1 6', 'h', 'g', 't', '/', '?']);
  });
});
