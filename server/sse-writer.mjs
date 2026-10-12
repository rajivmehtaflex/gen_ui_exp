// Bounded, backpressure-aware SSE writer for the chat route. While the client
// reads slower than the server produces, write() waits for drain instead of
// growing the queue past maxPendingBytes; a single frame larger than that
// budget is only ever queued into an empty queue, so pending bytes can exceed
// the budget by at most that one frame (frame sources are clamped upstream —
// see runCli in diagram-tool.mjs). Once the signal aborts (deadline or
// disconnect) nothing waits again — only frames that already fit are flushed,
// so terminal diagnostics still reach a reader that keeps up. Every write
// settles on drain, close, error, or abort; a stalled or gone client can never
// leave the request handler hanging on an unresolved promise. Pass a signal:
// the deadline is the only bound on how long a write may wait for a client
// that never reads.
import { DEFAULT_MAX_PENDING_SSE_BYTES } from "./resource-limits.mjs";

export function createSseWriter(res, { signal = null, maxPendingBytes = DEFAULT_MAX_PENDING_SSE_BYTES } = {}) {
  if (!Number.isSafeInteger(maxPendingBytes) || maxPendingBytes <= 0) {
    throw new RangeError("maxPendingBytes must be a positive safe integer");
  }

  let pendingBytes = 0; // mirror of the queue for responses without writableLength
  let stopped = false; // abort seen: stop waiting, flush only what already fits
  let closed = false; // close() called: detach and refuse further writes
  const waiters = [];

  const pending = () => (typeof res.writableLength === "number" ? res.writableLength : pendingBytes);
  const unblock = () => {
    for (const resolve of waiters.splice(0, waiters.length)) resolve();
  };
  const onDrain = () => {
    pendingBytes = 0;
    unblock();
  };
  const stop = () => {
    stopped = true;
    unblock();
  };
  const onAbort = () => stop();
  const detach = () => {
    res.removeListener("drain", onDrain);
    res.removeListener("close", stop);
    res.removeListener("error", stop);
    signal?.removeEventListener("abort", onAbort);
  };

  res.on("drain", onDrain);
  res.once("close", stop);
  res.once("error", stop);
  signal?.addEventListener("abort", onAbort, { once: true });

  async function write(frame) {
    if (typeof frame !== "string") throw new TypeError("sse frames must be strings");
    if (closed) return false;
    const bytes = Buffer.byteLength(frame, "utf8");
    // Backpressure: never queue past the budget while the stream may still
    // wait for this client to catch up.
    while (!stopped && pending() > 0 && pending() + bytes > maxPendingBytes) {
      await new Promise((resolve) => waiters.push(resolve));
    }
    if (closed || res.destroyed || res.writableEnded) return false;
    // Stopped writers no longer wait: a terminal frame goes out only if it
    // already fits in the budget.
    if (stopped && pending() + bytes > maxPendingBytes) return false;
    let accepted;
    try {
      accepted = res.write(frame);
    } catch {
      stop();
      return false;
    }
    pendingBytes += bytes;
    // Respect the writable's own backpressure signal while waiting is allowed.
    if (!accepted && !stopped) await new Promise((resolve) => waiters.push(resolve));
    return true;
  }

  function close() {
    if (closed) return;
    closed = true;
    stop();
    detach();
  }

  return {
    write,
    close,
    get maxPendingBytes() { return maxPendingBytes; },
  };
}
