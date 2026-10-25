/**
 * Minimal TSBV1 reader for `registry:check` (Node only): returns the parsed `META` section of a built `.bin` so the
 * registry can be compared with what the converter measured (03 §C.1). It accepts the gzip wire file (`1F 8B`) or a
 * bare container (`TSBV`), like the loader's sniffing (AD-37), and reads nothing but the section table and `META`.
 * The full reader is WP02's `readTsbv1`; this one exists so `@tsbs/registry` needs no runtime dependency on core.
 */
import { gunzipSync } from 'node:zlib';

const MAGIC = 'TSBV';

/** Decodes the `META` JSON of a TSBV1 file; throws an Error naming the problem. */
export function readTsbvMeta(file: Uint8Array): Record<string, unknown> {
  const bytes = file[0] === 0x1f && file[1] === 0x8b ? new Uint8Array(gunzipSync(file)) : file;
  if (bytes.length < 8 || String.fromCharCode(...bytes.subarray(0, 4)) !== MAGIC)
    throw new Error('not a TSBV1 container');
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const version = view.getUint8(4);
  if (version !== 1) throw new Error(`unsupported TSBV version ${String(version)}`);
  const sectionCount = view.getUint16(6, true);
  let offset = 8;
  for (let i = 0; i < sectionCount; i++) {
    if (offset + 8 > bytes.length) throw new Error(`section ${String(i)} header is truncated`);
    const tag = String.fromCharCode(...bytes.subarray(offset, offset + 4));
    const length = view.getUint32(offset + 4, true);
    const start = offset + 8;
    if (start + length > bytes.length) throw new Error(`section ${tag} is truncated`);
    if (tag === 'META') {
      const meta: unknown = JSON.parse(
        new TextDecoder('utf-8', { fatal: true }).decode(bytes.subarray(start, start + length)),
      );
      if (typeof meta !== 'object' || meta === null || Array.isArray(meta))
        throw new Error('META is not a JSON object');
      return meta as Record<string, unknown>;
    }
    offset = start + length + ((4 - (length % 4)) % 4);
  }
  throw new Error('no META section');
}
