/**
 * The props contract between the drawer's first-paint trigger (LiveCheckDrawer) and its lazily imported body
 * (LiveCheckBody), type-only so the trigger never pulls the body's code into the initial chunk.
 */
import type { ByokPanel } from './pairing.ts';

export interface BodyProps {
  /** The panel to focus once mounted (the picker's live-check row), or null. */
  readonly focus: ByokPanel | null;
  /** Called after the body has moved focus to `focus`. */
  readonly onfocused: () => void;
}
