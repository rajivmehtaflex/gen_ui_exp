// Browser wire shape and stream lifecycle pinned through the real adapter.
// No test framework. Run: ./node_modules/.bin/tsx scripts/test-tool-wire.mjs
import assert from "node:assert/strict";
import { assistantToolCallChunks, toolResultChunk } from "../server/diagram-tool.mjs";
import { chatAdapter } from "../src/llm.ts";
import { processStreamedMessage } from "@openuidev/react-headless";

let failures = 0;
function check(name, fn) {
  return Promise.resolve()
    .then(fn)
    .then(() => console.log(`PASS  ${name}`))
    .catch((e) => {
      failures++;
      console.error(`FAIL  ${name}\n      ${e.message}`);
    });
}

await check("assistantToolCallChunks generates valid SSE chunks", () => {
  const chunks = assistantToolCallChunks({
    id: "call_123",
    name: "create_diagram",
    arguments: '{"title":"Test Diagram","type":"architecture"}',
  });
  assert.ok(Array.isArray(chunks) && chunks.length >= 2, "must return multiple chunks");
  assert.ok(chunks[0].startsWith("data: "));
  assert.ok(chunks[chunks.length - 1].includes('"finish_reason":"tool_calls"'));
});

await check("toolResultChunk generates valid tool-result SSE chunk", () => {
  const resultJson = JSON.stringify({ ok: true, diagramId: "diag-abc", title: "Test", type: "architecture" });
  const line = toolResultChunk({ toolCallId: "call_123", content: resultJson });
  assert.ok(line.startsWith("data: "));
  assert.ok(line.includes('"role":"tool"'));
  assert.ok(line.includes('"tool_call_id":"call_123"'));
  assert.ok(line.includes("diag-abc"));
});

await check("chatAdapter emits TOOL_CALL_START, ARGS, END, and RESULT in order", async () => {
  const toolCallChunks = assistantToolCallChunks({
    id: "call_abc",
    name: "create_diagram",
    arguments: '{"title":"My Pipeline","type":"architecture","spec":{}}',
  });
  const resultJson = JSON.stringify({
    ok: true,
    diagramId: "diag-1",
    title: "My Pipeline",
    type: "architecture",
  });
  const resChunk = toolResultChunk({ toolCallId: "call_abc", content: resultJson });

  const rawSSE = toolCallChunks.join("") + resChunk + "data: [DONE]\n\n";
  const response = new Response(rawSSE);

  const adapter = chatAdapter();
  const events = [];
  for await (const event of adapter.parse(response)) {
    events.push(event);
  }

  const start = events.find((e) => e.type === "TOOL_CALL_START");
  assert.ok(start, "must emit TOOL_CALL_START");
  assert.equal(start.toolCallId, "call_abc");
  assert.equal(start.toolCallName, "create_diagram");

  const args = events.find((e) => e.type === "TOOL_CALL_ARGS");
  assert.ok(args, "must emit TOOL_CALL_ARGS");
  assert.equal(args.toolCallId, "call_abc");
  assert.ok(args.delta.includes("My Pipeline"));

  const end = events.find((e) => e.type === "TOOL_CALL_END");
  assert.ok(end, "must emit TOOL_CALL_END");
  assert.equal(end.toolCallId, "call_abc");

  const result = events.find((e) => e.type === "TOOL_CALL_RESULT");
  assert.ok(result, "must emit TOOL_CALL_RESULT");
  assert.equal(result.toolCallId, "call_abc");
  assert.equal(result.content, resultJson);
});

const doneFrame = "data: [DONE]\n\n";
const frame = (delta, finish = null) => `data: ${JSON.stringify({ choices: [{ delta, finish_reason: finish }] })}\n\n`;
const toolRound = (id, index = 0) => frame({ role: "assistant", tool_calls: [{ index, id, function: { name: "create_diagram", arguments: "{}" } }] }) + frame({}, "tool_calls");
async function parse(raw) {
  const events = [];
  for await (const event of chatAdapter().parse(raw instanceof Response ? raw : new Response(raw))) events.push(event);
  return events;
}
function balanced(events) {
  for (const [startType, endType, key] of [
    ["TEXT_MESSAGE_START", "TEXT_MESSAGE_END", "messageId"],
    ["TOOL_CALL_START", "TOOL_CALL_END", "toolCallId"],
  ]) {
    const open = new Set();
    const seen = new Set();
    for (const event of events) {
      if (event.type === startType) {
        assert.ok(!seen.has(event[key]), `duplicate start ${event[key]}`);
        seen.add(event[key]);
        open.add(event[key]);
      }
      if (event.type === endType) {
        assert.ok(open.delete(event[key]), `unmatched or duplicate end ${event[key]}`);
      }
      if (event.type === "TEXT_MESSAGE_CONTENT" && key === "messageId") {
        assert.ok(open.has(event[key]), "text content must belong to an open segment");
      }
    }
    assert.equal(open.size, 0, `unclosed ${startType}`);
  }
}
const visibleError = (events, pattern) => {
  const errors = events.filter((event) => event.type === "RUN_ERROR");
  assert.equal(errors.length, 1, "must emit one visible error");
  assert.match(errors[0].message, pattern);
  assert.equal(events.at(-1).type, "RUN_ERROR", "error must be terminal");
};

await check("two_round_tool_ids_reset", async () => {
  // Check both index reuse and an index absent from the later round.
  for (const secondIndex of [0, 1]) {
    const events = await parse(toolRound("first", 0) + toolResultChunk({ toolCallId: "first", content: "{}" }) + toolRound("second", secondIndex) + toolResultChunk({ toolCallId: "second", content: "{}" }) + doneFrame);
    balanced(events);
    assert.deepEqual(events.filter((e) => e.type === "TOOL_CALL_END").map((e) => e.toolCallId), ["first", "second"]);
  }
});
await check("tool_then_text_balanced", async () => {
  const events = await parse(frame({ role: "assistant", content: "Before" }) + toolRound("one") + toolResultChunk({ toolCallId: "one", content: "{}" }) + frame({ role: "assistant", content: "After" }) + frame({}, "stop") + frame({ content: "forbidden" }) + doneFrame);
  balanced(events);
  assert.equal(events.filter((e) => e.type === "TEXT_MESSAGE_START").length, 2);
  assert.equal(events.filter((e) => e.type === "TEXT_MESSAGE_CONTENT").map((e) => e.delta).join(""), "BeforeAfter");
});
await check("done_without_stop", async () => {
  const events = await parse(frame({ content: "Complete" }) + frame({ tool_calls: [{ index: 0, id: "unfinished", function: { name: "create_diagram" } }] }) + doneFrame + frame({ content: "forbidden" }));
  balanced(events);
  assert.equal(events.filter((e) => e.type === "TEXT_MESSAGE_CONTENT").map((e) => e.delta).join(""), "Complete");
});
await check("length_and_filter_visible", async () => {
  for (const reason of ["length", "content_filter"]) {
    const events = await parse(frame({ content: "Partial" }) + frame({}, reason) + frame({ content: "forbidden" }) + doneFrame);
    balanced(events);
    visibleError(events, reason === "length" ? /limit|truncat/i : /filter/i);
  }
});
await check("server_error_visible", async () => {
  const events = await parse(toolRound("pending") + 'event: error\ndata: {"error":{"message":"renderer unavailable"}}\n\n' + frame({ content: "forbidden" }) + doneFrame);
  balanced(events);
  visibleError(events, /renderer unavailable/);
});
await check("eof_without_done_visible", async () => {
  const events = await parse(frame({ content: "Partial" }) + frame({ tool_calls: [{ index: 0, id: "partial", function: { name: "create_diagram" } }] }));
  balanced(events);
  visibleError(events, /unexpected|incomplete|ended|truncat/i);
});
await check("split_utf8_crlf", async () => {
  const raw = ': comment\r\nevent: message\r\ndata: {"choices":\r\ndata: [{"delta":{"content":"你好 🌍"},"finish_reason":null}]}\r\n\r\n' + doneFrame.replaceAll("\n", "\r\n");
  const bytes = new TextEncoder().encode(raw);
  const response = new Response(new ReadableStream({ start(controller) {
    for (const byte of bytes) controller.enqueue(Uint8Array.of(byte));
    controller.close();
  } }));
  const events = await parse(response);
  assert.equal(response.body.locked, false, "terminal frame must release reader lock");
  balanced(events);
  assert.equal(events.filter((e) => e.type === "TEXT_MESSAGE_CONTENT").map((e) => e.delta).join(""), "你好 🌍");
});
await check("consumer_break_releases_reader", async () => {
  let cancelled = 0;
  const stream = new ReadableStream({ start(controller) { controller.enqueue(new TextEncoder().encode(frame({ content: "First" }))); }, cancel() { cancelled++; } });
  for await (const event of chatAdapter().parse(new Response(stream))) { assert.equal(event.type, "TEXT_MESSAGE_START"); break; }
  assert.equal(cancelled, 1, "consumer break must cancel the unread stream");
  assert.equal(stream.locked, false, "consumer break must release reader lock");
});

await check("transport_failure_settles_and_propagates", async () => {
  const failure = new Error("transport disconnected");
  let reads = 0;
  const stream = new ReadableStream({ pull(controller) {
    if (reads++ === 0) controller.enqueue(new TextEncoder().encode(frame({ content: "Partial", tool_calls: [{ index: 0, id: "interrupted", function: { name: "create_diagram" } }] })));
    else controller.error(failure);
  } }, { highWaterMark: 0 });
  const events = [];
  await assert.rejects(async () => {
    for await (const event of chatAdapter().parse(new Response(stream))) events.push(event);
  }, (error) => error === failure);
  balanced(events);
  assert.equal(events.some((e) => e.type === "RUN_ERROR"), false, "transport handler owns the error");
  assert.equal(stream.locked, false);
});
await check("sdk_segments_and_tool_execution", async () => {
  // The browser SDK batches updates using animation frames; use real timers here.
  const originalRequest = globalThis.requestAnimationFrame;
  const originalCancel = globalThis.cancelAnimationFrame;
  globalThis.requestAnimationFrame = (fn) => setTimeout(fn, 0);
  globalThis.cancelAnimationFrame = clearTimeout;
  try {
    const messages = [];
    const executing = new Set();
    await processStreamedMessage({
      response: new Response(frame({ content: "Before" }) + toolRound("sdk-call") + toolResultChunk({ toolCallId: "sdk-call", content: "{}" }) + frame({ content: "After" }) + frame({}, "stop") + doneFrame),
      adapter: chatAdapter(),
      createMessage: (message) => messages.push(message),
      updateMessage: (message) => { messages[messages.findIndex((m) => m.id === message.id)] = message; },
      markToolExecuting: (id) => executing.add(id),
      clearToolExecuting: (id) => executing.delete(id),
    });
    assert.deepEqual(messages.map((m) => [m.role, m.content]), [["assistant", "Before"], ["tool", "{}"], ["assistant", "After"]]);
    assert.equal(messages[0].toolCalls[0].id, "sdk-call");
    assert.equal(executing.size, 0);
  } finally {
    globalThis.requestAnimationFrame = originalRequest;
    globalThis.cancelAnimationFrame = originalCancel;
  }
});

process.exit(failures ? 1 : 0);
