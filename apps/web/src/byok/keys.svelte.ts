/**
 * The BYOK keys (05 §13): module-level runes state in this tab's memory only. Never persisted (no localStorage,
 * sessionStorage, IndexedDB, cookie or URL), never logged, never part of a result. Cleared by "Forget key", by
 * collapsing the drawer (LiveCheckBody's teardown) and on `pagehide` (LiveCheckBody registers the listener).
 */
import type { ByokProvider } from './errors.ts';

class KeyStore {
  anthropic = $state('');
  xai = $state('');

  /** Forgets one provider's key. */
  forget(provider: ByokProvider): void {
    this[provider] = '';
  }

  /** Forgets both keys. */
  forgetAll(): void {
    this.anthropic = '';
    this.xai = '';
  }
}

/** The app-wide key store (one per tab). */
export const keys = new KeyStore();
