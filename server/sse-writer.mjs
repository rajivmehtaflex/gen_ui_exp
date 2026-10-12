// Bounded, backpressure-aware SSE writer for the chat route. At most
// maxPendingBytes may sit queued, for every caller: a frame larger than the
// budget is refused outright (write resolves false and nothing is queued), and
// while the client reads slower than the server produces, write() waits for
// drain instead of growing the queue. Once the signal aborts (deadline or
// disconnect) nothing waits again — only frames that already fit are flushed,
// so terminal diagnostics still reach a reader that keeps up. A refused frame
// never reached the client, so callers must not stream past one as if it had:
// the tool loop settles the request with a visible diagnostic instead. Every
// write settles on drain, close, error, or abort; a stalled or gone client can
// never leave the request handler hanging on an unresolved promise. Pass a
// signal: the deadline is the only bound on how long a write may wait for a
// client that never reads.
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
    // A frame larger than the whole budget can never sit inside it, on any
    // path (empty queue, backpressure wait, or post-abort flush): refuse it
    // outright so no single write can lift pending bytes past the cap.
    if (bytes > maxPendingBytes) return false;
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
