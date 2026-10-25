/**
 * Deterministic gzip for TSBV1 assets (AD-10, 03 §C.1) and the hashing helpers the manifest needs.
 *
 * zlib level 9 with fixed parameters; the gzip header is normalised (MTIME 0, XFL 2, OS 255 "unknown") because zlib
 * writes the build platform into the OS byte (0x0A on Windows, 0x03 on Unix), which would make Windows and Linux
 * builds differ by one header byte. The header is not covered by the gzip CRC, so this is a pure relabelling.
 * zopfli is optional in the design ("when available"); this converter always uses zlib-9 so the output never depends on
 * which optional packages happen to be installed on the build machine.
 */
import { createHash } from 'node:crypto';
import { constants, gunzipSync, gzipSync } from 'node:zlib';

/** OS byte written into every gzip header: 255 = unknown (RFC 1952). */
export const GZIP_OS_UNKNOWN = 255;

/** Fixed zlib parameters (never derived from the environment). */
const GZIP_OPTIONS = {
  level: 9,
  memLevel: 9,
  windowBits: 15,
  strategy: constants.Z_DEFAULT_STRATEGY,
} as const;

/** gzip-9 with a normalised header. */
export function gzipDeterministic(data: Uint8Array): Uint8Array {
  const out = new Uint8Array(gzipSync(data, GZIP_OPTIONS));
  if (out[0] !== 0x1f || out[1] !== 0x8b || out[2] !== 8) throw new Error('zlib did not produce a gzip member');
  out.fill(0, 4, 8); // MTIME
  out[8] = 2; // XFL: maximum compression
  out[9] = GZIP_OS_UNKNOWN;
  return out;
}

/** Inverse of {@link gzipDeterministic} (any gzip member). */
export function gunzip(data: Uint8Array): Uint8Array {
  return new Uint8Array(gunzipSync(data));
}

/** Lower-case hex SHA-256. */
export function sha256Hex(data: Uint8Array | string): string {
  return createHash('sha256').update(data).digest('hex');
}

/** gzip-9 size of `data` (size reports for JSON outputs). */
export function gzipSize(data: Uint8Array | string): number {
  return gzipDeterministic(typeof data === 'string' ? new TextEncoder().encode(data) : data).length;
}
