// Request-level resource bounds: diagram job admission, the whole-request
// deadline, SSE backpressure, and the model output budget. Plain node, no test
// framework, offline — a fake response simulates a real socket (queue,
// high-water mark, drain-on-empty, close) and a fake runner stands in for the
// vendored CLI, so nothing here spawns processes or touches the network.
// Run: node scripts/test-resource-limits.mjs
import assert from "node:assert/strict";
import { getEventListeners } from "node:events";
import { writeFileSync } from "node:fs";

const limits = await import("../server/resource-limits.mjs").catch(() => ({}));
const sseModule = await import("../server/sse-writer.mjs").catch(() => ({}));
const toolLoop = await import("../server/tool-loop.mjs").catch(() => ({}));
const diagramTool = await import("../server/diagram-tool.mjs").catch(() => ({}));
const { createDiagramLimiter, createRequestDeadline, createStreamBudget } = limits;
const { createSseWriter } = sseModule;
const { runToolLoop } = toolLoop;
const { executeDiagramTool, diagramJobLimiter } = diagramTool;

let failures = 0;
async function check(name, fn) {
  try {
    await fn();
    console.log(`PASS  ${name}`);
  } catch (error) {
    failures++;
    console.error(`FAIL  ${name}\n      ${error.message}`);
  }
}

// A socket-honest response stub: write() queues and reports backpressure past
// its high-water mark, "drain" fires only when a full buffer empties, and
// destroy()/end() behave like the real thing. The writer under test may only
// use this public surface.
class FakeResponse {
  constructor({ highWaterMark = 256 } = {}) {
    this.highWaterMark = highWaterMark;
    this.queue = [];
    this.pendingBytes = 0;
    this.writableLength = 0;
    this.writableEnded = false;
    this.destroyed = false;
    this.delivered = "";
    this.needDrain = false;
    this.listeners = new Map();
  }

  on(event, listener) { return this.#add(event, listener, false); }
  once(event, listener) { return this.#add(event, listener, true); }

  #add(event, listener, once) {
    const existing = this.listeners.get(event) ?? [];
    if (once) {
      // Mirror Node: a once wrapper stays removable through the original
      // listener reference.
      const wrapped = (...args) => {
        this.removeListener(event, listener);
        listener(...args);
      };
      wrapped.listener = listener;
      existing.push(wrapped);
    } else {
      existing.push(listener);
    }
    this.listeners.set(event, existing);
    return this;
  }

  removeListener(event, listener) {
    const existing = this.listeners.get(event) ?? [];
    const index = existing.findIndex((entry) => entry === listener || entry?.listener === listener);
    if (index >= 0) existing.splice(index, 1);
    return this;
  }

  listenerCount(event) { return (this.listeners.get(event) ?? []).length; }

  #emit(event, arg) {
    for (const listener of [...(this.listeners.get(event) ?? [])]) listener(arg);
  }

  write(chunkStr) {
    if (this.writableEnded || this.destroyed) return false;
    const bytes = Buffer.byteLength(chunkStr);
    this.queue.push(chunkStr);
    this.pendingBytes += bytes;
    this.writableLength = this.pendingBytes;
    this.needDrain ||= this.pendingBytes > this.highWaterMark;
    return !this.needDrain;
  }

  end() {
    this.writableEnded = true;
  }

  destroy() {
    this.destroyed = true;
    this.#emit("close");
  }

  // The slow client reads `bytes` more bytes; the buffer only reports drain
  // once it has actually emptied, exactly like a real writable.
  consume(bytes) {
    let remaining = bytes;
    while (remaining > 0 && this.queue.length > 0) {
      const head = this.queue[0];
      const size = Buffer.byteLength(head);
      const take = Math.min(size, remaining);
      this.delivered += head.slice(0, take);
      if (take === size) this.queue.shift();
      else this.queue[0] = head.slice(take);
      remaining -= take;
      this.pendingBytes -= take;
      this.writableLength = this.pendingBytes;
    }
    if (this.pendingBytes === 0 && this.needDrain) {
      this.needDrain = false;
      this.#emit("drain");
    }
  }
}

// Resolves true when `promise` settles within `ms`, false otherwise, and never
// leaves a timer behind (Promise.race with a bare delay would).
function settlesWithin(promise, ms) {
  let timer;
  return Promise.race([
    Promise.resolve(promise).then(() => true),
    new Promise((resolve) => { timer = setTimeout(() => resolve(false), ms); }),
  ]).finally(() => clearTimeout(timer));
}

const chunk = (delta, finishReason = null) => ({
  id: "chatcmpl-offline",
  choices: [{ index: 0, delta, finish_reason: finishReason }],
});
const toolRound = (calls) => [
  chunk({ role: "assistant", tool_calls: calls.map((call, index) => ({
    index,
    id: call.id,
    type: "function",
    function: { name: call.name ?? "create_diagram", arguments: call.arguments ?? "{}" },
  })) }),
  chunk({}, "tool_calls"),
];
const argRound = (pieces, id = "big") => {
  const parts = [chunk({ role: "assistant", tool_calls: [{
    index: 0, id, type: "function", function: { name: "create_diagram", arguments: "" },
  }] })];
  for (const piece of pieces) {
    parts.push(chunk({ tool_calls: [{ index: 0, function: { arguments: piece } }] }));
  }
  parts.push(chunk({}, "tool_calls"));
  return parts;
};
const textRound = (text) => [chunk({ role: "assistant", content: text }), chunk({}, "stop")];

const frameDelta = (frame) => (frame.startsWith("data: {") ? JSON.parse(frame.slice(6)).choices?.[0]?.delta ?? {} : {});
const visibleText = (frames) => frames.map((frame) => frameDelta(frame).content ?? "").join("");
const hasVisibleStop = (frames) => frames.some((frame) => frame.includes('"finish_reason":"stop"'));
const relayedArgumentBytes = (frames) => frames.reduce((sum, frame) => {
  const calls = frameDelta(frame).tool_calls ?? [];
  return sum + calls.reduce((acc, call) => acc + Buffer.byteLength(call.function?.arguments ?? ""), 0);
}, 0);

async function driveLoop(rounds, options = {}) {
  assert.equal(typeof runToolLoop, "function", "runToolLoop must be exported");
  const requests = [];
  const frames = [];
  const executed = [];
  const controller = new AbortController();
  const completed = await runToolLoop({
    messages: [{ role: "user", content: "draw a diagram" }],
    createCompletion: async (request) => {
      requests.push(structuredClone(request));
      const next = rounds[requests.length - 1];
      assert.ok(next, `unexpected completion ${requests.length}`);
      return (async function* emit() {
        for (const part of next) {
          if (part instanceof Error) throw part;
          yield part;
        }
      })();
    },
    executeTool: async () => {
      executed.push("executed");
      return options.toolResult ?? { ok: true, diagramId: "diag", title: "D", type: "architecture" };
    },
    emit: async (sse) => { frames.push(sse); },
    signal: options.signal ?? controller.signal,
    model: "offline-model",
    initialMode: "auto",
    ...(options.maxModelOutputBytes === undefined ? {} : { maxModelOutputBytes: options.maxModelOutputBytes }),
  });
  return { requests, frames, executed, completed, controller };
}

// Stands in for the vendored CLI: records spawned commands, answers with real
// receipt JSON, and materializes the deliver output the tool reads back.
function fakeRunner(behavior = "ok") {
  const commands = [];
  async function run({ args }) {
    const command = args[1];
    commands.push(command);
    if (behavior === "fail-validate" && command === "validate") {
      return {
        ok: true,
        stdout: JSON.stringify({ ok: false, error: "schema: fixture failure", diagnostics: [{ message: "fixture failure" }] }),
        stderr: "",
      };
    }
    if (command === "deliver") {
      writeFileSync(args[4], "<!doctype html><title>fixture</title>");
      return { ok: true, stdout: JSON.stringify({ ok: true, artifact: { sha256: "f".repeat(64) } }), stderr: "" };
    }
    return { ok: true, stdout: JSON.stringify({ ok: true }), stderr: "" };
  }
  return { run, commands };
}

const fixtureArgs = JSON.stringify({ title: "Fixture", type: "architecture", spec: { nodes: [] } });
const aborted = (signal) => new Promise((resolve) => {
  if (signal?.aborted) resolve();
  else signal?.addEventListener("abort", resolve, { once: true });
});

await check("budget_constants_match_plan", () => {
  assert.equal(limits.MAX_ACTIVE_DIAGRAM_JOBS, 2, "at most two active diagram jobs");
  assert.equal(limits.REQUEST_DEADLINE_MS, 120_000, "whole-request deadline is 120 seconds");
  assert.equal(limits.MAX_MODEL_OUTPUT_BYTES, 2 * 1024 * 1024, "2 MiB model text/tool argument budget");
  assert.equal(limits.DEFAULT_MAX_PENDING_SSE_BYTES, 256 * 1024, "256 KiB pending SSE budget");
  assert.equal(typeof createSseWriter, "function", "createSseWriter must be exported");
  assert.equal(createSseWriter(new FakeResponse()).maxPendingBytes, 256 * 1024,
    "the writer's default budget must be the 256 KiB plan value");
  assert.equal(typeof createStreamBudget, "function", "createStreamBudget must be exported");
  const budget = createStreamBudget(10);
  assert.equal(budget.tryCharge(6), true);
  assert.equal(budget.tryCharge(6), false, "a charge that would exceed the limit must be refused whole");
  assert.equal(budget.tryCharge(4), true, "the refused charge must not have consumed budget");
  assert.equal(budget.used, 10);
});

await check("limiter_admits_two_and_release_is_idempotent", () => {
  assert.equal(typeof createDiagramLimiter, "function", "createDiagramLimiter must be exported");
  const limiter = createDiagramLimiter(2);
  const first = limiter.tryAcquire();
  const second = limiter.tryAcquire();
  assert.equal(typeof first, "function", "admission must return a release callback");
  assert.equal(typeof second, "function");
  assert.equal(limiter.tryAcquire(), null, "the third job must be denied with no queue");
  first();
  first(); // double release must not free a second slot
  const third = limiter.tryAcquire();
  assert.ok(third, "one release must admit exactly one job");
  assert.equal(limiter.tryAcquire(), null, "a double release must not leak capacity");
  second();
  third();
  const fourth = limiter.tryAcquire();
  const fifth = limiter.tryAcquire();
  assert.ok(fourth && fifth, "all released slots must be reusable");
  assert.equal(limiter.tryAcquire(), null);
  fourth();
  fifth();
  assert.throws(() => createDiagramLimiter(0), RangeError);
  assert.throws(() => createDiagramLimiter(1.5), RangeError);
});

await check("two_jobs_only", async () => {
  assert.equal(typeof executeDiagramTool, "function", "executeDiagramTool must be exported");
  const runner = fakeRunner("ok");
  const limiter = createDiagramLimiter(2);
  const first = executeDiagramTool(fixtureArgs, null, { limiter, runner: runner.run });
  const second = executeDiagramTool(fixtureArgs, null, { limiter, runner: runner.run });
  const third = executeDiagramTool(fixtureArgs, null, { limiter, runner: runner.run });
  const results = await Promise.all([first, second, third]);
  assert.equal(results[0].ok, true, `first job must run: ${JSON.stringify(results[0])}`);
  assert.equal(results[1].ok, true, `second job must run: ${JSON.stringify(results[1])}`);
  assert.equal(results[2].ok, false, "the third concurrent admission must be denied");
  assert.equal(results[2].busy, true, "the denial must be a structured busy result");
  assert.match(results[2].error, /busy/i);
  assert.equal(results[2].diagramId, undefined, "a denied job must not produce an artifact");
  // The two admitted jobs account for every spawn; the denial adds none. Only
  // the command counts matter — the fake runner interleaves per job.
  assert.deepEqual([...runner.commands].sort(), ["deliver", "deliver", "validate", "validate"],
    "a denied job must be refused without spawning");
  const fourth = await executeDiagramTool(fixtureArgs, null, { limiter, runner: runner.run });
  assert.equal(fourth.ok, true, "released slots must admit new work");
  assert.deepEqual([...runner.commands].sort(),
    ["deliver", "deliver", "deliver", "validate", "validate", "validate"]);
});

await check("jobs_release_on_failure", async () => {
  const failing = fakeRunner("fail-validate");
  const limiter = createDiagramLimiter(2);
  const [first, second] = await Promise.all([
    executeDiagramTool(fixtureArgs, null, { limiter, runner: failing.run }),
    executeDiagramTool(fixtureArgs, null, { limiter, runner: failing.run }),
  ]);
  assert.equal(first.ok, false);
  assert.equal(second.ok, false);
  assert.notEqual(first.busy, true, "a running job that fails must report the real failure");
  const third = await executeDiagramTool(fixtureArgs, null, { limiter, runner: failing.run });
  assert.notEqual(third.busy, true, "a failed job must have released its slot");
  assert.match(third.error, /schema|fixture/i, "the real failure must survive admission");
});

await check("invalid_arguments_release_slots", async () => {
  const limiter = createDiagramLimiter(2);
  const runner = fakeRunner("ok");
  for (const [label, args] of [
    ["not json", "not json"],
    ["unknown type", JSON.stringify({ title: "x", type: "nope", spec: {} })],
    ["missing spec", JSON.stringify({ title: "x", type: "architecture" })],
  ]) {
    const result = await executeDiagramTool(args, null, { limiter, runner: runner.run });
    assert.equal(result.ok, false, `${label} must fail`);
    assert.notEqual(result.busy, true, `${label} must fail on its own terms, not saturation`);
  }
  assert.equal(limiter.active, 0, "refused arguments must have released admission");
  assert.deepEqual(runner.commands, [], "refused arguments must not spawn");
  const good = await executeDiagramTool(fixtureArgs, null, { limiter, runner: runner.run });
  assert.equal(good.ok, true, "slots must survive invalid-argument calls");
});

await check("busy_uses_default_limiter_without_spawn", async () => {
  assert.ok(diagramJobLimiter, "diagram-tool must export its process-wide limiter");
  const hold = [diagramJobLimiter.tryAcquire(), diagramJobLimiter.tryAcquire()];
  assert.ok(hold[0] && hold[1], "fixture: the default limiter must have two free slots");
  try {
    const runner = fakeRunner("ok");
    const denied = await executeDiagramTool(fixtureArgs, null, { runner: runner.run });
    assert.equal(denied.busy, true, "the default limiter must gate executeDiagramTool");
    assert.deepEqual(runner.commands, [], "a denied job must not spawn against the default limiter");
  } finally {
    for (const release of hold) release();
  }
  const admitted = await executeDiagramTool(fixtureArgs, null, { runner: fakeRunner("ok").run });
  assert.equal(admitted.ok, true, "released slots must admit work again");
});

await check("deadline_fires_and_dispose_clears_timer", async () => {
  assert.equal(typeof createRequestDeadline, "function", "createRequestDeadline must be exported");
  const originalSetTimeout = globalThis.setTimeout;
  const originalClearTimeout = globalThis.clearTimeout;
  const tracked = new Set();
  globalThis.setTimeout = (fn, ms, ...rest) => {
    const timer = originalSetTimeout(fn, ms, ...rest);
    if (ms === 5_000) tracked.add(timer);
    return timer;
  };
  globalThis.clearTimeout = (timer) => {
    tracked.delete(timer);
    return originalClearTimeout(timer);
  };
  try {
    const deadline = createRequestDeadline(null, 5_000);
    assert.equal(tracked.size, 1, "the deadline must own exactly one timer");
    deadline.dispose();
    assert.equal(tracked.size, 0, "dispose must clear the deadline timer");
  } finally {
    globalThis.setTimeout = originalSetTimeout;
    globalThis.clearTimeout = originalClearTimeout;
    for (const timer of tracked) originalClearTimeout(timer);
  }

  const fired = createRequestDeadline(null, 25);
  const abortedInTime = await settlesWithin(aborted(fired.signal), 2_000);
  assert.ok(abortedInTime, "the deadline signal must abort at the timeout");
  assert.match(String(fired.signal.reason?.message ?? fired.signal.reason), /deadline/i,
    "the abort reason must name the deadline");
  fired.dispose();

  const quiet = createRequestDeadline(null, 30);
  quiet.dispose();
  await new Promise((resolve) => setTimeout(resolve, 60));
  assert.equal(quiet.signal.aborted, false, "a disposed deadline must never fire");
});

await check("deadline_combines_parent_abort", () => {
  const parent = new AbortController();
  const before = getEventListeners(parent.signal, "abort").length;
  const deadline = createRequestDeadline(parent.signal, 60_000);
  assert.equal(getEventListeners(parent.signal, "abort").length, before + 1,
    "the deadline must follow its parent signal");
  parent.abort();
  assert.ok(deadline.signal.aborted, "a parent abort must abort the deadline immediately");
  deadline.dispose();
  assert.equal(getEventListeners(parent.signal, "abort").length, before,
    "dispose must detach the parent listener");

  const alreadyAborted = new AbortController();
  alreadyAborted.abort();
  const immediate = createRequestDeadline(alreadyAborted.signal, 60_000);
  assert.ok(immediate.signal.aborted, "an already-aborted parent must abort the deadline at once");
  immediate.dispose();
});

await check("deadline_aborts_upstream_and_cli", async () => {
  const seen = {};
  const frames = [];
  const emit = async (sse) => { frames.push(sse); };
  const hangUntilAborted = (signal) => aborted(signal)
    .then(() => { throw Object.assign(new Error("aborted"), { name: "AbortError" }); });

  // The CLI path: a tool call starts a render that hangs until the deadline.
  const cliDeadline = createRequestDeadline(null, 60);
  const cliRun = runToolLoop({
    messages: [{ role: "user", content: "draw a diagram" }],
    createCompletion: async (request, { signal }) => {
      seen.upstream = signal;
      return (async function* emit() {
        yield chunk({ role: "assistant", tool_calls: [{
          index: 0, id: "call_slow", type: "function",
          function: { name: "create_diagram", arguments: "{}" },
        }] });
        yield chunk({}, "tool_calls");
      })();
    },
    executeTool: async (args, signal) => {
      seen.cli = signal;
      await hangUntilAborted(signal);
    },
    emit,
    signal: cliDeadline.signal,
    model: "offline-model",
    initialMode: "interactive",
  }).then((value) => {
    seen.cliCompleted = value?.completed;
    return value;
  });
  assert.equal(seen.upstream, cliDeadline.signal, "upstream work must run under the deadline signal");
  const cliSettled = await settlesWithin(cliRun, 2_000);
  assert.ok(cliSettled, "the request must settle once the deadline fires — no hanging promise");
  assert.ok(cliDeadline.signal.aborted, "the deadline must have fired during the render");
  assert.equal(seen.cli, cliDeadline.signal, "CLI work must run under the deadline signal");
  assert.equal(seen.cliCompleted, false, "an aborted request did not complete");
  assert.match(visibleText(frames), /stopped|deadline|timed out/i,
    "the deadline must produce a visible diagnostic, not a truncated reply");
  assert.ok(hasVisibleStop(frames), "the diagnostic must settle the stream terminally");
  cliDeadline.dispose();

  // The upstream path: a provider stream that hangs until the deadline.
  frames.length = 0;
  const upstreamDeadline = createRequestDeadline(null, 60);
  const upstreamRun = runToolLoop({
    messages: [{ role: "user", content: "draw a diagram" }],
    createCompletion: async (request, { signal }) => {
      seen.upstream = signal;
      await hangUntilAborted(signal);
    },
    executeTool: async () => { throw new Error("must not be reached"); },
    emit,
    signal: upstreamDeadline.signal,
    model: "offline-model",
    initialMode: "interactive",
  }).then((value) => {
    seen.upstreamCompleted = value?.completed;
    return value;
  });
  const upstreamSettled = await settlesWithin(upstreamRun, 2_000);
  assert.ok(upstreamSettled, "a stalled provider stream must settle at the deadline");
  assert.ok(upstreamDeadline.signal.aborted);
  assert.equal(seen.upstreamCompleted, false);
  assert.match(visibleText(frames), /stopped|deadline|timed out/i);
  assert.ok(hasVisibleStop(frames));
  upstreamDeadline.dispose();
});

await check("slow_reader_bounds_memory", async () => {
  assert.equal(typeof createSseWriter, "function", "createSseWriter must be exported");
  const res = new FakeResponse({ highWaterMark: 128 });
  const maxPendingBytes = 512;
  const writer = createSseWriter(res, { maxPendingBytes });
  const frames = Array.from({ length: 20 }, (_, index) => `data: frame-${index} ${"x".repeat(60)}\n\n`);
  let settled = false;
  const producer = (async () => {
    const written = [];
    for (const frame of frames) written.push(await writer.write(frame));
    return written;
  })();
  producer.then(() => { settled = true; }, () => { settled = true; });
  let peakPending = 0;
  let ticks = 0;
  while (!settled && ticks++ < 10_000) {
    await new Promise((resolve) => setImmediate(resolve));
    peakPending = Math.max(peakPending, res.pendingBytes);
    res.consume(97); // the client reads slowly and unevenly
  }
  assert.ok(settled, "the producer must finish writing every frame to a slow reader");
  const written = await producer;
  assert.ok(written.every((entry) => entry === true), "no frame may be dropped for a reading client");
  assert.ok(peakPending <= maxPendingBytes,
    `pending SSE bytes peaked at ${peakPending}, over the ${maxPendingBytes}-byte budget`);
  assert.equal(res.delivered, frames.join(""), "a slow reader must still receive every byte, in order");
  writer.close();
  res.end();
});

await check("deadline_unblocks_stalled_writer", async () => {
  const deadline = createRequestDeadline(null, 60);
  const res = new FakeResponse({ highWaterMark: 64 });
  const writer = createSseWriter(res, { signal: deadline.signal, maxPendingBytes: 512 });
  let settled = false;
  const producer = (async () => {
    const written = [];
    for (let index = 0; index < 200; index++) {
      written.push(await writer.write(`data: ${index} ${"x".repeat(50)}\n\n`));
    }
    return written;
  })();
  producer.then(() => { settled = true; }, () => { settled = true; });
  let ticks = 0;
  while (!settled && ticks++ < 250) await new Promise((resolve) => setTimeout(resolve, 20));
  assert.ok(settled, "a stalled reader must not hang the producer past the deadline");
  assert.ok(deadline.signal.aborted);
  const written = await producer;
  assert.ok(written.includes(false), "frames that no longer fit must be dropped, not queued");
  assert.ok(res.pendingBytes <= 512, `a stalled reader must never hold more than the budget: ${res.pendingBytes}`);
  writer.close();
  deadline.dispose();
});

await check("disconnect_during_drain", async () => {
  const controller = new AbortController();
  const res = new FakeResponse({ highWaterMark: 64 });
  const maxPendingBytes = 4_096;
  const writer = createSseWriter(res, { signal: controller.signal, maxPendingBytes });
  const writes = [];
  let settled = false;
  const producer = (async () => {
    for (let index = 0; index < 40; index++) {
      writes.push(await writer.write(`data: chunk-${index}\n\n`));
    }
    return writes;
  })();
  producer.then(() => { settled = true; }, () => { settled = true; });
  let peakPending = 0;
  for (let index = 0; index < 40 && !settled; index++) {
    await new Promise((resolve) => setTimeout(resolve, 5));
    peakPending = Math.max(peakPending, res.pendingBytes);
  }
  assert.ok(res.pendingBytes > 0, "fixture: frames must be queued while the client stalls");
  controller.abort(); // what chat.mjs does when the response closes
  res.destroy();
  const settledInTime = await settlesWithin(producer, 2_000);
  assert.ok(settledInTime, "a disconnect must settle every pending write — no hanging promise");
  assert.equal(await writer.write("data: after\n\n"), false, "writes after a disconnect must be dropped");
  assert.ok(peakPending <= maxPendingBytes,
    `the queue must stay bounded while draining: ${peakPending}`);
  writer.close();
});

await check("writer_close_drops_and_detaches", async () => {
  const res = new FakeResponse({ highWaterMark: 16 });
  const controller = new AbortController();
  const signalBaseline = getEventListeners(controller.signal, "abort").length;
  const writer = createSseWriter(res, { signal: controller.signal, maxPendingBytes: 1_024 });
  assert.equal(getEventListeners(controller.signal, "abort").length, signalBaseline + 1,
    "the writer must follow its signal");
  assert.equal(await writer.write("data: one\n\n"), true);
  writer.close();
  assert.equal(await writer.write("data: two\n\n"), false, "writes after close must be dropped");
  assert.equal(res.listenerCount("drain"), 0, "close must detach the res listeners");
  assert.equal(res.listenerCount("close"), 0);
  assert.equal(res.listenerCount("error"), 0);
  assert.equal(getEventListeners(controller.signal, "abort").length, signalBaseline,
    "close must detach the signal listener");
  writer.close(); // idempotent
});

await check("tool_argument_budget", async () => {
  const bigArgs = JSON.stringify({ title: "Big", type: "architecture", spec: { blob: "y".repeat(360) } });
  const pieces = bigArgs.match(/.{1,60}/g);
  const state = await driveLoop([argRound(pieces)], { maxModelOutputBytes: 200 });
  assert.equal(state.executed.length, 0, "arguments that exceed the budget must never execute");
  assert.equal(state.requests.length, 1, "an over-budget round must not continue the loop");
  assert.match(visibleText(state.frames), /stopped|budget|limit/i,
    "the budget stop must be visible instead of a truncated reply");
  assert.ok(hasVisibleStop(state.frames), "the budget stop must settle the stream terminally");
  assert.equal(state.completed?.completed, true, "a settled budget stop is a completed request");
  assert.ok(relayedArgumentBytes(state.frames) <= 200,
    `relayed ${relayedArgumentBytes(state.frames)} argument bytes over a 200-byte budget`);

  const textual = await driveLoop([
    toolRound([{ id: "small", arguments: "{}" }]),
    textRound("z".repeat(600)),
  ], { maxModelOutputBytes: 300 });
  assert.equal(textual.executed.length, 1, "arguments within the budget still run");
  assert.match(visibleText(textual.frames), /stopped|budget|limit/i,
    "model text over the budget must stop visibly");
  assert.ok(hasVisibleStop(textual.frames));
});

await check("no_outstanding_handles", () => {
  const pinning = ["Timeout", "Immediate", "Interval", "TCPSocketWrap", "TCPConnectWrap",
    "TCPServerWrap", "PipeWrap", "DNSCHANNEL"];
  const leftover = process.getActiveResourcesInfo().filter((type) => pinning.includes(type));
  assert.deepEqual(leftover, [], `the harness must own no outstanding handles: ${leftover.join(", ")}`);
});

process.exitCode = failures ? 1 : 0;
