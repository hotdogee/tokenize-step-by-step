/**
 * Global single-key shortcuts (AD-22, 05 §8; WCAG 2.2 SC 2.1.4).
 *
 * - Letters match `event.key` case-insensitively; punctuation and digits match `event.code` (`BracketLeft`, `Comma`,
 *   `Digit1`, `Slash`, …), so `Shift+,` (key `<`) and JIS layouts behave; `event.keyCode` is never read except for the
 *   IME composition test (229).
 * - Every global shortcut is disabled by the persisted "Single-key shortcuts: off" setting, while an IME composition is
 *   active, while focus is in an editable control or a dialog, and when Ctrl / Alt / Meta is held. Component-scoped keys
 *   (arrows, Enter, Space, Esc, Home/End, PageUp/Down, `i`, `c`) are not handled here and are never disabled.
 */

/** What a shortcut asks for. Stage and step moves are the rail's (WP09); the shell implements the rest. */
export type ShortcutAction =
  | { readonly kind: 'stage'; readonly delta: -1 | 1 }
  | { readonly kind: 'jump'; readonly stage: 1 | 2 | 3 | 4 | 5 | 6 }
  | { readonly kind: 'step'; readonly delta: -10 | -1 | 1 | 10 }
  | { readonly kind: 'byteView' }
  | { readonly kind: 'graphemes' }
  | { readonly kind: 'picker' }
  | { readonly kind: 'focusText' }
  | { readonly kind: 'help' };

/** The fields of a KeyboardEvent the matcher reads. */
export interface KeyLike {
  readonly key: string;
  readonly code: string;
  readonly shiftKey: boolean;
  readonly ctrlKey: boolean;
  readonly altKey: boolean;
  readonly metaKey: boolean;
  readonly isComposing?: boolean;
  readonly keyCode?: number;
}

export interface ShortcutContext {
  /** The "Single-key shortcuts" setting. */
  readonly enabled: boolean;
  /** Focus is in a textarea / input / select / contenteditable. */
  readonly inEditable: boolean;
  /** A modal dialog is open. */
  readonly inDialog: boolean;
}

/** IME composition in progress (05 §6: `isComposing || key === 'Process' || keyCode === 229`). */
export function isComposing(event: KeyLike): boolean {
  return event.isComposing === true || event.key === 'Process' || event.keyCode === 229;
}

const DIGITS: Readonly<Record<string, 1 | 2 | 3 | 4 | 5 | 6>> = {
  Digit1: 1,
  Digit2: 2,
  Digit3: 3,
  Digit4: 4,
  Digit5: 5,
  Digit6: 6,
};

/** The global shortcut `event` triggers in `context`, or null. */
export function matchShortcut(event: KeyLike, context: ShortcutContext): ShortcutAction | null {
  if (!context.enabled || context.inEditable || context.inDialog) return null;
  if (event.ctrlKey || event.altKey || event.metaKey || isComposing(event)) return null;
  switch (event.code) {
    case 'BracketLeft':
      return event.shiftKey ? null : { kind: 'stage', delta: -1 };
    case 'BracketRight':
      return event.shiftKey ? null : { kind: 'stage', delta: 1 };
    case 'Comma':
      return { kind: 'step', delta: event.shiftKey ? -10 : -1 };
    case 'Period':
      return { kind: 'step', delta: event.shiftKey ? 10 : 1 };
    case 'Slash':
      return event.shiftKey ? { kind: 'help' } : { kind: 'focusText' };
    default:
      break;
  }
  const digit = DIGITS[event.code];
  if (digit !== undefined) return event.shiftKey ? null : { kind: 'jump', stage: digit };
  if (event.shiftKey) return null;
  switch (event.key.toLowerCase()) {
    case 'h':
      return { kind: 'byteView' };
    case 'g':
      return { kind: 'graphemes' };
    case 't':
      return { kind: 'picker' };
    default:
      return null;
  }
}

/** True when `target` is a text-entry control (shortcuts are ignored there). */
export function isEditableTarget(target: EventTarget | null): boolean {
  if (typeof HTMLElement === 'undefined' || !(target instanceof HTMLElement)) return false;
  if (target.isContentEditable) return true;
  const tag = target.tagName;
  if (tag === 'TEXTAREA' || tag === 'SELECT') return true;
  if (tag !== 'INPUT') return false;
  const type = (target as HTMLInputElement).type;
  return !['button', 'checkbox', 'radio', 'range', 'reset', 'submit', 'color', 'file', 'image'].includes(type);
}

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
