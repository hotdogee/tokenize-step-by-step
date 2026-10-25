import { describe, expect, it } from 'vitest';
import { WORKER_NAME, type FromWorker, type TokenizerClientLike } from '../src/index.ts';

describe('@tsbs/worker scaffold', () => {
  it('names the Worker', () => {
    expect(WORKER_NAME).toBe('tsbs-tokenizer');
  });

  it('accepts a real AbortSignal where the frozen protocol takes a signal', () => {
    // Compile-time check: core declares a structural AbortSignal subset (it has no DOM lib); the WebWorker one must fit.
    const signal: NonNullable<Parameters<TokenizerClientLike['load']>[2]> = new AbortController().signal;
    expect(signal.aborted).toBe(false);
  });

  it('narrows FromWorker messages by type', () => {
    const cancelledReqId = (msg: FromWorker): number | null => (msg.type === 'cancelled' ? msg.reqId : null);
    expect(cancelledReqId({ type: 'cancelled', reqId: 7 })).toBe(7);
    expect(cancelledReqId({ type: 'unloaded', reqId: 8 })).toBeNull();
  });
});
