/**
 * Picker progress (03 §C.6): the phases map onto one bar — download 0–75 %, verify 75–78 %, decompress 78–84 %,
 * build 84–100 %; a cache hit jumps to the end of the download segment.
 */
import type { Progress } from '@tsbs/core';

const SEGMENTS: Readonly<Record<Progress['phase'], readonly [from: number, to: number]>> = {
  cache: [0, 75],
  download: [0, 75],
  verify: [75, 78],
  decompress: [78, 84],
  build: [84, 100],
  encode: [100, 100],
};

/** 0…100 for the progress bar. */
export function progressPercent(progress: Progress): number {
  const [from, to] = SEGMENTS[progress.phase];
  const fraction = progress.total !== null && progress.total > 0 ? Math.min(1, progress.loaded / progress.total) : 0;
  return Math.round(from + (to - from) * fraction);
}

/** The catalog key naming a phase. */
export function phaseKey(
  phase: Progress['phase'],
):
  | 'progress.cache'
  | 'progress.download'
  | 'progress.verify'
  | 'progress.decompress'
  | 'progress.build'
  | 'progress.encode' {
  switch (phase) {
    case 'cache':
      return 'progress.cache';
    case 'download':
      return 'progress.download';
    case 'verify':
      return 'progress.verify';
    case 'decompress':
      return 'progress.decompress';
    case 'build':
      return 'progress.build';
    case 'encode':
      return 'progress.encode';
  }
}
