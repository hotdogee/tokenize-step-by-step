/**
 * Catalog keys that the shell does not render yet: the design fixes their wording (05 §3.5 ARIA table, §4 marker SR text,
 * §8, §12, AD-27) and the owning work package wires them. catalogs.test.ts treats every other key as "must be referenced
 * by the source", so an unused key fails CI unless it is listed here with its owner.
 */
import type { MessageKey } from './en.ts';

export const RESERVED_KEYS: Readonly<Partial<Record<MessageKey, 'WP08' | 'WP09' | 'WP13'>>> = {
  'counts.stale': 'WP13',
  'longInput.banner': 'WP13',
  'longInput.run': 'WP13',
  'longInput.capped': 'WP13',
};
