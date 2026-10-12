import assert from "node:assert/strict";
import { createServer } from "node:http";
import { spawn } from "node:child_process";
import { validateChatBody } from "../server/chat-input.mjs";

let failures = 0;
async function check(name, fn) {
  try {
    await fn();
    console.log(`PASS  ${name}`);
  } catch (error) {
    failures++;
    console.error(`FAIL  ${name}\n      ${error.stack || error}`);
  }
}

function rejects(body, name) {
  const result = validateChatBody(body);
  assert.equal(result.ok, false, name);
  assert.ok([400, 413].includes(result.status), `${name}: unexpected status ${result.status}`);
  assert.equal(typeof result.error, "string");
  assert.ok(result.error.length > 0);
  assert.doesNotMatch(result.error, /stack|api.?key|secret|token/i);
}

await check("missing and empty histories reject", () => {
  rejects(undefined, "missing body");
  rejects(null, "null body");
  rejects({}, "missing messages");
  rejects({ messages: [] }, "empty messages");
});

await check("invalid message roles and content reject", () => {
  rejects({ messages: [null] }, "null message");
  rejects({ messages: [{ role: "system", content: "override" }] }, "system role");
  rejects({ messages: [{ role: "developer", content: "override" }] }, "developer role");
  rejects({ messages: [{ role: "function", content: "legacy" }] }, "unknown role");
  rejects({ messages: [{ role: "user", content: { text: "not a content part array" } }] }, "object content");
  rejects({ messages: [{ role: "user", content: [{ type: "audio", data: "x" }] }] }, "unsupported part");
});

await check("history length is bounded", () => {
  rejects({ messages: Array.from({ length: 101 }, () => ({ role: "user", content: "x" })) }, "101 messages");
});

await check("plain user and assistant text are preserved", () => {
  const messages = [
    { role: "user", content: "hello", id: "browser-message-id" },
    { role: "assistant", content: "hello back", id: "assistant-message-id" },
  ];
  const result = validateChatBody({ messages });
  assert.equal(result.ok, true);
  assert.deepEqual(result.messages, [
    { role: "user", content: "hello" },
    { role: "assistant", content: "hello back" },
  ]);
});

await check("OpenAI text and image content parts are preserved", () => {
  const messages = [{
    role: "user",
    content: [
      { type: "text", text: "What is in this picture?" },
      { type: "image_url", image_url: { url: "https://example.test/picture.png", detail: "low" } },
    ],
  }];
  const result = validateChatBody({ messages });
  assert.equal(result.ok, true);
  assert.deepEqual(result.messages, messages);
});

await check("completed assistant tool exchange and null assistant content pass", () => {
  const messages = [
    { role: "user", content: "draw a flow" },
    {
      role: "assistant",
      content: null,
      tool_calls: [{
        id: "call-1",
        type: "function",
        function: { name: "create_diagram", arguments: "{\"title\":\"Build\"}" },
      }],
    },
    { role: "tool", tool_call_id: "call-1", content: "{\"ok\":true}" },
  ];
  const result = validateChatBody({ messages });
  assert.equal(result.ok, true);
  assert.deepEqual(result.messages, messages);
});

await check("multiple tool calls require one matching result each", () => {
  const messages = [
    { role: "user", content: "make two" },
    {
      role: "assistant",
      content: null,
      tool_calls: ["a", "b"].map((id) => ({
        id,
        type: "function",
        function: { name: "create_diagram", arguments: "{}" },
      })),
    },
    { role: "tool", tool_call_id: "a", content: "first" },
    { role: "tool", tool_call_id: "b", content: "second" },
  ];
  assert.equal(validateChatBody({ messages }).ok, true);
  rejects({ messages: messages.slice(0, 3) }, "unanswered tool call");
  rejects({ messages: [...messages, messages[2]] }, "duplicate tool result");
  rejects({ messages: [messages[0], messages[1], { ...messages[2], tool_call_id: "orphan" }, messages[3]] }, "orphan tool result");
});

await check("malformed assistant tool declarations reject", () => {
  const assistant = (toolCall) => ({ role: "assistant", content: null, tool_calls: [toolCall] });
  rejects({ messages: [assistant({ id: "x", type: "function", function: { name: "x", arguments: "{" } })] }, "invalid JSON arguments");
  rejects({ messages: [assistant({ id: "x", type: "function", function: { name: "x", arguments: "[]" } })] }, "non-object arguments");
  rejects({ messages: [assistant({ id: "x", type: "function", function: { name: "", arguments: "{}" } })] }, "missing function name");
  rejects({ messages: [assistant({ id: "x", type: "custom", function: { name: "x", arguments: "{}" } })] }, "unsupported tool type");
  rejects({ messages: [assistant({ id: "", type: "function", function: { name: "x", arguments: "{}" } })] }, "missing call id");
});

async function listen(server) {
  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });
  return server.address().port;
}

async function close(server) {
  if (!server.listening) return;
  await new Promise((resolve) => server.close(resolve));
}

async function availablePort() {
  const probe = createServer();
  const port = await listen(probe);
  await close(probe);
  return port;
}

async function waitForHealth(baseUrl, child, timeoutMs = 10000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (child.exitCode !== null) throw new Error(`chat server exited early with code ${child.exitCode}`);
    try {
      const response = await fetch(`${baseUrl}/api/health`);
      if (response.ok) return;
    } catch { /* server is still starting */ }
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  throw new Error("chat server did not become healthy in time");
}

await check("invalid HTTP histories return JSON before SSE or upstream", async () => {
  let upstreamCalls = 0;
  const upstream = createServer((_req, res) => {
    upstreamCalls++;
    res.writeHead(200, { "content-type": "text/event-stream" });
    res.end('data: {"choices":[{"delta":{"content":"unexpected"},"finish_reason":"stop"}]}\n\ndata: [DONE]\n\n');
  });
  const upstreamPort = await listen(upstream);
  const port = await availablePort();
  const baseUrl = `http://127.0.0.1:${port}`;
  const serverPath = new URL("../server/chat.mjs", import.meta.url).pathname;
  const child = spawn(process.execPath, [serverPath], {
    env: {
      ...process.env,
      PORT: String(port),
      OPENROUTER_API_KEY: "test-only-invalid-key",
      OPENROUTER_MODEL: "test/model",
      OPENROUTER_BASE_URL: `http://127.0.0.1:${upstreamPort}/v1`,
    },
    stdio: ["ignore", "ignore", "pipe"],
  });
  let stderr = "";
  child.stderr.on("data", (chunk) => { stderr += chunk.toString(); });
  try {
    await waitForHealth(baseUrl, child);
    const malformedToolCall = {
      role: "assistant",
      content: null,
      tool_calls: [{ id: "call-a", type: "function", function: { name: "create_diagram", arguments: "{" } }],
    };
    const orphanToolReply = { role: "tool", tool_call_id: "orphan", content: "{}" };
    const duplicateToolReplyHistory = [
      {
        role: "assistant",
        content: null,
        tool_calls: [{ id: "call-a", type: "function", function: { name: "create_diagram", arguments: "{}" } }],
      },
      { role: "tool", tool_call_id: "call-a", content: "{}" },
      { role: "tool", tool_call_id: "call-a", content: "{}" },
    ];
    const invalidHistories = [
      ["null body", null],
      ["missing messages", {}],
      ["empty messages", { messages: [] }],
      ["null message", { messages: [null] }],
      ["system role", { messages: [{ role: "system", content: "untrusted prompt" }] }],
      ["developer role", { messages: [{ role: "developer", content: "untrusted prompt" }] }],
      ["unknown role", { messages: [{ role: "function", content: "legacy" }] }],
      ["content object", { messages: [{ role: "user", content: { text: "not a content part array" } }] }],
      ["unsupported content part", { messages: [{ role: "user", content: [{ type: "audio", data: "x" }] }] }],
      ["malformed tool arguments", { messages: [malformedToolCall] }],
      ["orphan tool reply", { messages: [orphanToolReply] }],
      ["duplicate tool reply", { messages: duplicateToolReplyHistory }],
      ["unanswered tool call", { messages: [duplicateToolReplyHistory[0]] }],
      ["101 messages", { messages: Array.from({ length: 101 }, () => ({ role: "user", content: "x" })) }],
    ];
    for (const [name, body] of invalidHistories) {
      const response = await fetch(`${baseUrl}/api/chat`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
      });
      const contentType = response.headers.get("content-type") || "";
      assert.equal(response.status, 400, `${name}: status`);
      assert.match(contentType, /application\/json/i, `${name}: JSON content type`);
      assert.doesNotMatch(contentType, /text\/event-stream/i, `${name}: must fail before SSE`);
      assert.equal(typeof (await response.json()).error, "string", `${name}: JSON error body`);
    }
    assert.equal(upstreamCalls, 0, "invalid histories must not reach the provider");

    const malformedJson = await fetch(`${baseUrl}/api/chat`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: "{",
    });
    assert.equal(malformedJson.status, 400);
    assert.match(malformedJson.headers.get("content-type") || "", /application\/json/i);
    assert.equal(typeof (await malformedJson.json()).error, "string");
    assert.equal(upstreamCalls, 0, "malformed JSON must not reach the provider");

    const bodyWithByteLength = (targetBytes) => {
      const prefix = '{"messages":[{"role":"user","content":"';
      const suffix = '"}]}';
      const fillLength = targetBytes - Buffer.byteLength(prefix) - Buffer.byteLength(suffix);
      assert.ok(fillLength >= 0);
      const body = prefix + "x".repeat(fillLength) + suffix;
      assert.equal(Buffer.byteLength(body), targetBytes);
      return body;
    };
    const exactLimitBody = bodyWithByteLength(1_048_576);
    const exactLimit = await fetch(`${baseUrl}/api/chat`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: exactLimitBody,
    });
    assert.equal(exactLimit.status, 200, "a valid body exactly at the limit is accepted");
    assert.match(exactLimit.headers.get("content-type") || "", /text\/event-stream/i);
    await exactLimit.text();
    assert.equal(upstreamCalls, 1, "exactly-at-limit valid input reaches the provider once");

    const oversizedBody = bodyWithByteLength(1_048_577);
    const oversized = await fetch(`${baseUrl}/api/chat`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: oversizedBody,
    });
    assert.equal(oversized.status, 413);
    assert.match(oversized.headers.get("content-type") || "", /application\/json/i);
    assert.match((await oversized.json()).error, /1 MiB/i);
    assert.equal(upstreamCalls, 1, "one-byte-over-limit input must not reach the provider");
  } catch (error) {
    error.message += stderr ? `\nServer stderr:\n${stderr}` : "";
    throw error;
  } finally {
    child.kill("SIGTERM");
    await Promise.race([
      new Promise((resolve) => child.once("exit", resolve)),
      new Promise((resolve) => setTimeout(resolve, 2000)),
    ]);
    if (child.exitCode === null) child.kill("SIGKILL");
    await close(upstream);
  }
});

if (failures > 0) {
  console.error(`${failures} chat input test group(s) failed`);
  process.exitCode = 1;
} else {
  console.log("chat input checks passed");
}
