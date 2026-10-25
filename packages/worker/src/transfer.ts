/**
 * The transfer list of a `result` message (AD-20, 04 §6: "all typed arrays in the transfer list"). A
 * `TokenizationResult` is struct-of-arrays and every array is allocated for that result (`buildResult` copies its
 * inputs), so moving the buffers to the main thread is zero-copy and leaves nothing the engine still uses.
 */

/** Unique `ArrayBuffer`s behind every typed array in `value`, searched to `depth` levels of nested objects. */
export function transferablesOf(value: unknown, depth = 3): ArrayBuffer[] {
  const found = new Set<ArrayBuffer>();
  const visit = (node: unknown, level: number): void => {
    if (typeof node !== 'object' || node === null) return;
    if (ArrayBuffer.isView(node)) {
      if (node.buffer instanceof ArrayBuffer) found.add(node.buffer);
      return;
    }
    if (level >= depth) return;
    for (const child of Object.values(node)) visit(child, level + 1);
  };
  visit(value, 0);
  return [...found];
}
