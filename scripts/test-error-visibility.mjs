// Regression tests for review finding I1: upstream failures must be VISIBLE
// to the chat user, and live-mode misconfiguration must fail fast at startup.
// Plain node, no test framework. Servers come from the hermetic harness in
// scripts/test-harness.mjs: isolated port, provider env cleared, readiness
// proved to belong to the spawned child. Run: node scripts/test-error-visibility.mjs
import assert from "node:assert/strict";
import { startTestServer } from "./test-harness.mjs";

async function chatText(baseUrl, prompt) {
  const res = await fetch(`${baseUrl}/api/chat`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ messages: [{ role: "user", content: prompt }] }),
  });
  const raw = await res.text();
  let text = "";
  for (const line of raw.split("\n")) {
    if (!line.startsWith("data:")) continue;
    const payload = line.slice(5).trim();
    if (payload === "[DONE]") break;
    try {
      const delta = JSON.parse(payload).choices?.[0]?.delta?.content;
      if (typeof delta === "string") text += delta;
    } catch { /* non-JSON frame */ }
  }
  return { status: res.status, text };
}

let failures = 0;
function check(name, fn) {
  return fn()
    .then(() => console.log(`PASS  ${name}`))
    .catch((e) => { failures++; console.error(`FAIL  ${name}\n      ${e.message}`); });
}

// 1. Unreachable upstream + valid-shaped key → the user must SEE an error in chat.
await check("upstream failure produces visible assistant text", async () => {
  const server = await startTestServer({
    mode: "live",
    env: {
      OPENROUTER_API_KEY: "sk-or-test-invalid",
      OPENROUTER_BASE_URL: "http://127.0.0.1:9", // closed port — fails fast, then SDK retries
      OPENROUTER_MODEL: "test/model",
    },
  });
  try {
    const health = await (await fetch(`${server.baseUrl}/api/health`)).json();
    assert.equal(health.mode, "live", `expected a live child, got ${JSON.stringify(health)}`);
    const { text } = await chatText(server.baseUrl, "hello");
    assert.match(text, /Upstream error/i, `expected visible error text in chat, got: ${JSON.stringify(text)}`);
  } finally {
    await server.stop();
  }
});

// 2. Live mode without a model id → refuse to start (fail fast, clear message).
// The harness reports the child's exit and drains its captured output, so the
// assertion sees the server's own reason, not a readiness timeout.
await check("live mode without OPENROUTER_MODEL fails fast at startup", async () => {
  await assert.rejects(
    startTestServer({ mode: "live", env: { OPENROUTER_API_KEY: "sk-or-test-invalid" } }),
    (error) => {
      assert.match(
        error.message,
        /exited before it became healthy/,
        `server must exit when key is set but model is missing, got: ${error.message.split("\n")[0]}`,
      );
      assert.match(
        error.message,
        /OPENROUTER_MODEL is empty/,
        "drained server output must carry the fail-fast reason",
      );
      return true;
    },
  );
});

process.exit(failures ? 1 : 0);
