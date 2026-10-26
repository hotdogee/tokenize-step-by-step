/**
 * The keyboard map of 05 §8 for display (the `?` help dialog and About › Keyboard, both loaded on demand). Kept out of
 * shortcuts.ts, whose matcher `/` needs at startup, so the table stays out of the initial bundle (06 §3).
 */

/** One row of the help dialog and About › Keyboard: the keys (as shown) and the catalog key of the description. */
export interface ShortcutRow {
  readonly keys: readonly string[];
  readonly description:
    | 'help.key.stops'
    | 'help.key.steps'
    | 'help.key.jump'
    | 'help.key.byteView'
    | 'help.key.graphemes'
    | 'help.key.picker'
    | 'help.key.focusText'
    | 'help.key.help'
    | 'help.key.move'
    | 'help.key.tier'
    | 'help.key.rowEdges'
    | 'help.key.rows'
    | 'help.key.pin'
    | 'help.key.inspector'
    | 'help.key.escape'
    | 'help.key.copy'
    | 'help.key.play'
    | 'help.key.firstLast';
  /** A global single-key shortcut (affected by the setting; shown with *). */
  readonly singleKey: boolean;
}

export interface ShortcutGroup {
  readonly title: 'help.group.global' | 'help.group.board' | 'help.group.scrubber';
  readonly rows: readonly ShortcutRow[];
}

/** The keyboard map of 05 §8, grouped for display. */
export const SHORTCUT_GROUPS: readonly ShortcutGroup[] = [
  {
    title: 'help.group.global',
    rows: [
      { keys: ['[', ']'], description: 'help.key.stops', singleKey: true },
      { keys: [',', '.'], description: 'help.key.steps', singleKey: true },
      { keys: ['1', '6'], description: 'help.key.jump', singleKey: true },
      { keys: ['h'], description: 'help.key.byteView', singleKey: true },
      { keys: ['g'], description: 'help.key.graphemes', singleKey: true },
      { keys: ['t'], description: 'help.key.picker', singleKey: true },
      { keys: ['/'], description: 'help.key.focusText', singleKey: true },
      { keys: ['?'], description: 'help.key.help', singleKey: true },
    ],
  },
  {
    title: 'help.group.board',
    rows: [
      { keys: ['←', '→'], description: 'help.key.move', singleKey: false },
      { keys: ['↑', '↓'], description: 'help.key.tier', singleKey: false },
      { keys: ['Home', 'End'], description: 'help.key.rowEdges', singleKey: false },
      { keys: ['Page Up', 'Page Down'], description: 'help.key.rows', singleKey: false },
      { keys: ['Enter', 'Space'], description: 'help.key.pin', singleKey: false },
      { keys: ['i'], description: 'help.key.inspector', singleKey: false },
      { keys: ['c'], description: 'help.key.copy', singleKey: false },
      { keys: ['Esc'], description: 'help.key.escape', singleKey: false },
    ],
  },
  {
    title: 'help.group.scrubber',
    rows: [
      { keys: ['Space'], description: 'help.key.play', singleKey: false },
      { keys: ['Home', 'End'], description: 'help.key.firstLast', singleKey: false },
    ],
  },
];
