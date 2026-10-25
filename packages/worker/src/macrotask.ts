/**
 * A macrotask yield for the encode loop (AD-21, 04 §1.3): between two `mergeStep` slices the host gives the event loop
 * one turn so a queued `cancel` or `encode` message is handled. A `MessageChannel` round trip is used instead of
 * `setTimeout(0)`, which browsers clamp to ≥ 4 ms after a few nested calls and would double the cancel latency.
 */

/** Returns a function that resolves after one macrotask. The channel is created on the first call. */
export function createMacrotaskYield(): () => Promise<void> {
  let port: MessagePort | null = null;
  const waiting: Array<() => void> = [];
  return () =>
    new Promise<void>((resolve) => {
      if (typeof MessageChannel !== 'function') {
        setTimeout(resolve, 0);
        return;
      }
      if (port === null) {
        const channel = new MessageChannel();
        channel.port1.onmessage = () => {
          waiting.shift()?.();
        };
        // Node (tests): an active port would keep the process alive; browsers have no unref.
        (channel.port1 as { unref?: () => void }).unref?.();
        port = channel.port2;
      }
      waiting.push(resolve);
      port.postMessage(null);
    });
}
