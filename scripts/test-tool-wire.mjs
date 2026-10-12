// Tests for Task 4: Browser wire shape pinned through the real adapter.
// Plain node, no test framework. Run: node scripts/test-tool-wire.mjs
import assert from "node:assert/strict";
import { assistantToolCallChunks, toolResultChunk } from "../server/diagram-tool.mjs";
import { chatAdapter } from "../src/llm.ts";

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

process.exit(failures ? 1 : 0);
