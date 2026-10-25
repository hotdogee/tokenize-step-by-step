/**
 * Main-thread feature probe (05 §14 › Diagnostics reads it without a Worker; the Worker's `ready.features` uses the same
 * four flags, 04 §6).
 */
import type { Features } from '@tsbs/core';

/** True when `DecompressionStream('brotli')` constructs (Firefox 147 / Safari 18.4; absent in Chrome, AD-10). */
function hasBrotli(): boolean {
  if (typeof DecompressionStream !== 'function') return false;
  try {
    new DecompressionStream('brotli' as CompressionFormat);
    return true;
  } catch {
    return false;
  }
}

export function probeFeatures(): Features {
  return {
    cacheApi: typeof caches !== 'undefined',
    // eslint-disable-next-line compat/compat -- feature detection itself (Intl.Segmenter: Firefox 125+, PD-4 fallback)
    segmenter: typeof Intl.Segmenter === 'function',
    brotli: hasBrotli(),
    subtleCrypto: typeof crypto !== 'undefined' && typeof crypto.subtle !== 'undefined',
  };
}
