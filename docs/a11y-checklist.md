# Accessibility checklist (manual, once per release)

The automated gates catch what tools can see: every E2E page/state runs axe with the WCAG 2.2 AA tags
(`e2e/support/axe.ts`, zero violations), Lighthouse must score Accessibility 100 on the preview, and component tests
assert the grid ARIA contract. They cannot judge the criteria below, so a person checks them before every release and
records the result at the end (`docs/design/06-quality-ci-deploy.md` §1, §7 item 12; 05 §3.3, §5, §8, §9).

**Already asserted by the e2e matrix** (`E2E_FULL_MATRIX=1`, 06 §1; `docs/release.md` § How a change ships). These
checks run on every PR; repeat them by hand only where the matrix is red, skipped, or cannot reach (real devices, AT):

| Criterion                     | Automated check                                                                                                                                                                        | Projects                                    |
| ----------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------- |
| 2.5.8 Target Size             | every visible pointer target ≥ 24 × 24 on the default view, at stop 4 and in the picker and help dialogs (`device.spec.ts`); board cells and the sheet handle (`board-layout.spec.ts`) | `pixel-5`, `iphone-12` (touch projects)     |
| 1.4.10 Reflow                 | no horizontal page overflow in en / zh-TW / ja with the picker open, and on About (`device.spec.ts`); 320 px chrome with `[data-reflow-exempt]` on the board (`shell-layout.spec.ts`)  | every project, `chromium-320` in particular |
| 2.4.11 Focus Not Obscured     | at 360 px the focused cell never meets the sheet or the header over 120 key presses; at 768–1023 px never under the anchored panel (`board-layout.spec.ts`)                            | every project                               |
| 2.1.4 Character Key Shortcuts | "Single-key shortcuts: off" makes `t`, `?`, `h`, `3` inert while arrows, Enter, `i`, `c`, Esc keep working (`shell-notices.spec.ts`, `board-keyboard.spec.ts`)                         | every project                               |
| Forced colours                | borders in CanvasText, hatch and focus outline in Highlight (`board-layout.spec.ts`); an outline at every Tab stop of `/`, both ways (`focus-visible.spec.ts`)                         | every project                               |
| axe (WCAG 2.2 AA)             | zero violations on `/` and `/about/` × 3 locales × 2 themes, the open dialogs and menus, the pinned board                                                                              | every project                               |

**Setup.** The release build on the preview or production URL. Desktop: NVDA (current) + Firefox (current) on Windows;
VoiceOver + Safari on macOS. Phone: a real 360 px-wide Android device (Chrome) and an iPhone (Safari, VoiceOver). Run
each section in English and spot-check zh-TW and ja.

## WCAG 2.2 criteria axe and Lighthouse do not detect

### 2.1.4 Character Key Shortcuts (A)

- [ ] With shortcuts on (default), `[` `]`, `,` `.` (`Shift` = ×10), `1`–`6`, `h`, `g`, `t`, `/`, `?` act as documented in
      the `?` dialog.
- [ ] Turn **"Single-key shortcuts: off"** in the `?` dialog; reload. Every global single-key shortcut above is inert,
      also with speech input (Windows Voice Access or Voice Control: say a letter).
- [ ] Still working with shortcuts off: arrows, `Enter`, `Space`, `Esc`, `Home`/`End`, `PageUp`/`PageDown`, `Tab`, `i`, `c`
      (component-scoped keys).
- [ ] The setting persists across reloads and is also reachable under About › Keyboard.
- [ ] Shortcuts never fire while typing in the textarea, inside a dialog, or during an IME composition.

### 2.4.11 Focus Not Obscured (Minimum) (AA)

- [ ] At 360 px, Tab into the board and arrow through every row with the inspector sheet collapsed, then expanded: the
      focused cell is never hidden behind the bottom sheet or the sticky header (it scrolls into view).
- [ ] At 768–1023 px the anchored inspector never covers the focused cell.
- [ ] Focus is never hidden behind the notices strip or the BYOK drawer.

### 2.5.7 Dragging Movements (AA)

- [ ] The bottom sheet expands and collapses with its handle **button** (tap, `Enter`, `Space`); dragging is optional.
- [ ] Every scrubber position is reachable without dragging: clicking the track, the step buttons, `,` `.` and
      `Home`/`End` on the focused scrubber.
- [ ] Chip rows and the pipeline rail scroll with buttons/keyboard as well as by panning.

### 2.5.8 Target Size (Minimum) (AA)

On the phone (coarse pointer), using the browser's element inspector or a ruler overlay:

- [ ] Char cell ≥ 36 × 40 px, byte cell ≥ 36 × 24, token chip ≥ 36 × 28, marker cell ≥ 36 × 28 (a full column),
      example chips ≥ 40 px tall, scrubber thumb 44 px, sheet handle button 44 px (05 §3.3).
- [ ] No two targets closer than the spacing exception allows (2 px gaps between chips).

### 1.4.10 Reflow (AA)

- [ ] At 320 × 568 CSS px (or 1280 px at 400 % zoom) the page chrome — header, input, chips row, toggles, notices strip,
      inspector, help dialog, About — needs no horizontal scrolling and loses no content or function.
- [ ] The board alone may scroll in two dimensions: it carries `data-reflow-exempt` (WCAG 1.4.10 exception for content
      that requires a two-dimensional layout) and still works with keyboard and touch.
- [ ] zh-TW and ja copy in the notices strip, inspector and help dialog does not overflow at 360 px.

### 1.4.13 Content on Hover or Focus (AA)

- [ ] Hovering a cell (fine pointer) updates the inspector after ~120 ms; moving the pointer onto the inspector keeps it
      open (hoverable).
- [ ] `Esc` closes hover content without moving focus (dismissible); a second `Esc` unpins a pinned cell.
- [ ] Hover content stays until the pointer leaves, focus moves, or it is dismissed (persistent); nothing is available
      only on hover.

## Screen-reader scripts

### NVDA + Firefox, VoiceOver + Safari

- [ ] Landmarks: banner, main, contentinfo; one `h1`; heading order is logical on `/` and `/about/`.
- [ ] `<html lang>` follows the UI locale; the example text and chips announce in their own language (`lang` attributes).
- [ ] The board is announced as a grid with row/column counts; arrows move by cell; each cell's label reads like
      "byte 4 of 12: E7, decimal 231, first byte of 灣, in token 2 of 5 (id 66285, partial)"; fragments of one token
      announce "continued (part 2 of 2)".
- [ ] The status region announces stage changes ("UTF-8 bytes: 12 bytes"), load completion ("o200k_base ready"), pin
      ("pinned: token 2 of 5 …") and copy ("copied: 66285"); merge steps are announced when stepping by keyboard, never
      during playback.
- [ ] The inspector is a labelled region; `i` moves focus into it, `Esc` returns to the originating cell; it never traps
      focus or makes the board inert.
- [ ] Picker and help dialogs trap focus, announce their title, and return focus to the opener on close.
- [ ] Notices (e.g. "Powered by xAI" with Grok-2 selected) are reachable and read in full; error toasts are announced
      (`role="alert"`).
- [ ] BYOK drawer: the key field has a label, the "stays in memory only" statement is read, results and errors are
      announced.
- [ ] Semantic markers (continuation, zero-width, split hatch, lock, Byte, merged star) and whitespace stand-ins are read
      by their text alternatives, never as raw symbols.

## Display preferences

- [ ] Light and dark themes (auto follows the OS; the toggle overrides); text, borders and focus rings stay visible.
- [ ] `prefers-reduced-motion: reduce`: no transform animations; scrolling into view is instant.
- [ ] `forced-colors: active` (Windows High Contrast): borders, hatches and focus remain visible in system colours.
- [ ] `prefers-contrast: more`: borders become 2 px `--fg`.
- [ ] 200 % browser zoom and 200 % text-only zoom (Firefox) keep all content and functions.

## 360 px touch pass

- [ ] Tap a cell to pin, tap elsewhere to unpin; long-press equals tap; pinch-zoom is not intercepted.
- [ ] Horizontal drags on the scrubber scrub; vertical pans scroll the page; chip rows pan horizontally.
- [ ] Switching tokenizer from the picker shows progress and keeps the previous result until the new one is ready.

## Sign-off

| Release / commit | Tester | Platform, AT and browser versions | Date | Result and issues filed |
| ---------------- | ------ | --------------------------------- | ---- | ----------------------- |
|                  |        |                                   |      |                         |
