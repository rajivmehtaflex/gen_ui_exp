// Request-level resource bounds shared by the chat route, the tool loop, and
// the diagram tool: diagram job admission (no queue), the whole-request
// deadline, and the byte budgets for accumulated model output and pending SSE
// frames. Pure logic with no I/O, so every piece is exercisable offline with
// fakes.
export const MAX_ACTIVE_DIAGRAM_JOBS = 2;
export const REQUEST_DEADLINE_MS = 120_000;
export const MAX_MODEL_OUTPUT_BYTES = 2 * 1024 * 1024;
export const DEFAULT_MAX_PENDING_SSE_BYTES = 256 * 1024;
// Tool-result text bounds. A failed CLI run embeds its receipt error, stderr,
// and diagnostics verbatim into the tool result frame and the upstream tool
// message; the CLI's 1 MiB output caps bound the raw bytes, not those strings.
export const MAX_TOOL_ERROR_CHARS = 2_000;
export const MAX_DIAGNOSTIC_CHARS = 500;
export const MAX_DIAGNOSTIC_ENTRIES = 20;

export function requestDeadlineMessage(timeoutMs = REQUEST_DEADLINE_MS) {
  const seconds = Math.max(1, Math.round(timeoutMs / 1000));
  return `This request exceeded its ${seconds}-second deadline and was stopped before it finished. Ask again to continue.`;
}

function requirePositiveSafeInteger(name, value) {
  if (!Number.isSafeInteger(value) || value <= 0) {
    throw new RangeError(`${name} must be a positive safe integer`);
  }
}

function requireNonNegativeSafeInteger(name, value) {
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new TypeError(`${name} must be a non-negative safe integer`);
  }
}

// Counts down the bytes a single request may accumulate from the model: text
// deltas plus tool-call argument deltas. Charging is all-or-nothing — a charge
// that would cross the limit is refused whole, so nothing over budget is ever
// retained or relayed.
export function createStreamBudget(maxBytes = MAX_MODEL_OUTPUT_BYTES) {
  requirePositiveSafeInteger("maxBytes", maxBytes);
  let used = 0;
  return {
    get used() { return used; },
    get limit() { return maxBytes; },
    tryCharge(bytes) {
      requireNonNegativeSafeInteger("bytes", bytes);
      if (used + bytes > maxBytes) return false;
      used += bytes;
      return true;
    },
  };
}

// Admission for diagram jobs. There is deliberately no queue: a caller that
// cannot acquire a slot must return a structured busy result instead of
// waiting. The returned release callback is idempotent, so a finally block
// cannot double-release a slot and leak capacity to a fourth job.
export function createDiagramLimiter(maxActive) {
  requirePositiveSafeInteger("maxActive", maxActive);
  let active = 0;
  return {
    get active() { return active; },
    get maxActive() { return maxActive; },
    tryAcquire() {
      if (active >= maxActive) return null;
      active++;
      let released = false;
      return () => {
        if (released) return;
        released = true;
        active--;
      };
    },
  };
}

// One abort signal that fires when either the parent aborts (client gone) or
// the whole-request deadline expires. dispose() clears the timer and detaches
// the parent listener, so a finished request leaves no handle behind.
export function createRequestDeadline(parentSignal, timeoutMs = REQUEST_DEADLINE_MS) {
  requirePositiveSafeInteger("timeoutMs", timeoutMs);
  if (parentSignal !== null && parentSignal !== undefined
    && typeof parentSignal.addEventListener !== "function") {
    throw new TypeError("parentSignal must be an AbortSignal when given");
  }

  const controller = new AbortController();
  const onParentAbort = () => controller.abort(parentSignal.reason);
  let timer = null;
  let disposed = false;

  if (parentSignal?.aborted) {
    onParentAbort();
  } else {
    timer = setTimeout(() => {
      timer = null;
      controller.abort(new Error(requestDeadlineMessage(timeoutMs)));
    }, timeoutMs);
    parentSignal?.addEventListener("abort", onParentAbort, { once: true });
  }

  return {
    signal: controller.signal,
    dispose() {
      if (disposed) return;
      disposed = true;
      if (timer) {
        clearTimeout(timer);
        timer = null;
      }
      parentSignal?.removeEventListener("abort", onParentAbort);
    },
  };
}
