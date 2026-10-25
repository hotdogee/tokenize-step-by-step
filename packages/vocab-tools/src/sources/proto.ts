/**
 * Minimal protobuf (proto2) wire reader for SentencePiece `.model` files (03 §C.5 `spmProto`): varint,
 * length-delimited, fixed32 and fixed64 fields; groups are rejected. Values stay raw; the caller applies the proto2
 * defaults for absent fields.
 */

/** Wire types (protobuf encoding spec). */
export const WireType = { Varint: 0, Fixed64: 1, LengthDelimited: 2, Fixed32: 5 } as const;

/** One decoded field. `varint` is a bigint so 10-byte negative int32/int64 values survive. */
export type ProtoField =
  | { readonly field: number; readonly wire: 0; readonly varint: bigint }
  | { readonly field: number; readonly wire: 1; readonly bytes: Uint8Array }
  | { readonly field: number; readonly wire: 2; readonly bytes: Uint8Array }
  | { readonly field: number; readonly wire: 5; readonly bytes: Uint8Array };

/** Reads a varint at `pos`; returns the value and the next offset. Throws past `end` or beyond 10 bytes. */
export function readVarint(buf: Uint8Array, pos: number, end: number): [bigint, number] {
  let fast = 0;
  let p = pos;
  // Up to 7 bytes fit a double exactly (49 bits); fall back to bigint beyond.
  for (let shift = 0; shift < 49; shift += 7) {
    if (p >= end) throw new RangeError(`truncated varint at offset ${String(pos)}`);
    const byte = buf[p++] ?? 0;
    fast += (byte & 0x7f) * 2 ** shift;
    if (byte < 0x80) return [BigInt(fast), p];
  }
  let value = BigInt(fast);
  for (let shift = 49n; shift < 70n; shift += 7n) {
    if (p >= end) throw new RangeError(`truncated varint at offset ${String(pos)}`);
    const byte = buf[p++] ?? 0;
    value |= BigInt(byte & 0x7f) << shift;
    if (byte < 0x80) return [BigInt.asUintN(64, value), p];
  }
  throw new RangeError(`varint longer than 10 bytes at offset ${String(pos)}`);
}

/** Decodes every field of the message in `buf[start, end)`, in wire order. */
export function readMessage(buf: Uint8Array, start = 0, end = buf.length): ProtoField[] {
  const fields: ProtoField[] = [];
  let pos = start;
  while (pos < end) {
    const [key, afterKey] = readVarint(buf, pos, end);
    const field = Number(key >> 3n);
    const wire = Number(key & 7n);
    if (field === 0) throw new RangeError(`field number 0 at offset ${String(pos)}`);
    pos = afterKey;
    switch (wire) {
      case WireType.Varint: {
        const [value, next] = readVarint(buf, pos, end);
        fields.push({ field, wire: 0, varint: value });
        pos = next;
        break;
      }
      case WireType.Fixed64:
      case WireType.Fixed32: {
        const size = wire === WireType.Fixed64 ? 8 : 4;
        if (pos + size > end) throw new RangeError(`truncated fixed${String(size * 8)} at offset ${String(pos)}`);
        const bytes = buf.subarray(pos, pos + size);
        fields.push(wire === WireType.Fixed64 ? { field, wire: 1, bytes } : { field, wire: 5, bytes });
        pos += size;
        break;
      }
      case WireType.LengthDelimited: {
        const [length, next] = readVarint(buf, pos, end);
        const stop = next + Number(length);
        if (length > BigInt(end - next))
          throw new RangeError(`length-delimited field ${String(field)} overruns the message at offset ${String(pos)}`);
        fields.push({ field, wire: 2, bytes: buf.subarray(next, stop) });
        pos = stop;
        break;
      }
      default:
        throw new RangeError(`unsupported wire type ${String(wire)} (field ${String(field)}) at offset ${String(pos)}`);
    }
  }
  return fields;
}

/** Last occurrence of `field` (proto2 semantics for a non-repeated scalar). */
export function lastField(fields: readonly ProtoField[], field: number): ProtoField | undefined {
  for (let i = fields.length - 1; i >= 0; i--) if (fields[i]?.field === field) return fields[i];
  return undefined;
}

/** A varint field as a signed 32-bit integer (int32/enum), or `fallback` (the proto2 default) when absent. */
export function int32Field(fields: readonly ProtoField[], field: number, fallback: number): number {
  const f = lastField(fields, field);
  if (f === undefined) return fallback;
  if (f.wire !== 0) throw new Error(`field ${String(field)} is not a varint`);
  return Number(BigInt.asIntN(32, f.varint));
}

/** A bool field, or `fallback` when absent. */
export function boolField(fields: readonly ProtoField[], field: number, fallback: boolean): boolean {
  const f = lastField(fields, field);
  if (f === undefined) return fallback;
  if (f.wire !== 0) throw new Error(`field ${String(field)} is not a varint`);
  return f.varint !== 0n;
}

/** A length-delimited field's bytes, or `null` when absent. */
export function bytesField(fields: readonly ProtoField[], field: number): Uint8Array | null {
  const f = lastField(fields, field);
  if (f === undefined) return null;
  if (f.wire !== 2) throw new Error(`field ${String(field)} is not length-delimited`);
  return f.bytes;
}

/** A float (fixed32) field, or `fallback` when absent. */
export function floatField(fields: readonly ProtoField[], field: number, fallback: number): number {
  const f = lastField(fields, field);
  if (f === undefined) return fallback;
  if (f.wire !== 5) throw new Error(`field ${String(field)} is not a fixed32`);
  return new DataView(f.bytes.buffer, f.bytes.byteOffset, 4).getFloat32(0, true);
}
