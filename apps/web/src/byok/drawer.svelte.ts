/**
 * The live-check drawer's open state (first-paint code, tiny): whether the drawer is open and which panel to focus once
 * its lazy body has mounted. `openLiveCheck` is what the picker's "Claude 3+ → live check" row calls (App.svelte).
 */
import type { ByokPanel } from './pairing.ts';

class DrawerState {
  open = $state(false);
  /** The panel to focus once the body has mounted (the body clears it). */
  focus: ByokPanel | null = $state(null);
}

/** The app-wide drawer state. */
export const drawer = new DrawerState();

/** Opens the drawer and moves focus to `panel` (the picker's live-check row). */
export function openLiveCheck(panel: ByokPanel): void {
  drawer.focus = panel;
  drawer.open = true;
}
