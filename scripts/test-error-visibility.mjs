// Regression tests for review finding I1: upstream failures must be VISIBLE
// to the chat user, and live-mode misconfiguration must fail fast at startup.
// Plain node, no test framework. Run: node scripts/test-error-visibility.mjs
import { spawn } from "node:child_process";
import assert from "node:assert/strict";

const SERVER = new URL("../server/chat.mjs", import.meta.url).pathname;
const PORT = 8791; // dedicated port — must not clash with a running dev server
const BASE = `http://127.0.0.1:${PORT}`;

function startServer(extraEnv = {}) {
  const env = { ...process.env, PORT: String(PORT) };
  delete env.OPENROUTER_MODEL; // tests set exactly what they need…
  Object.assign(env, extraEnv); // …and extraEnv wins for anything it provides
  const child = spawn(process.execPath, [SERVER], { env, stdio: ["ignore", "pipe", "pipe"] });
  child.stderr.on("data", (d) => process.stderr.write(`[server] ${d}`));
  return child;
}

async function waitHealthy(timeoutMs = 10000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const res = await fetch(`${BASE}/api/health`);
      if (res.ok) return await res.json();
    } catch { /* not up yet */ }
    await new Promise((r) => setTimeout(r, 150));
  }
  throw new Error("server did not become healthy in time");
}

// POST one message, read the SSE stream to [DONE], return the assembled
// user-visible text (exactly what the browser adapter would render).
async function chatText(prompt) {
  const res = await fetch(`${BASE}/api/chat`, {
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
  const child = startServer({
    OPENROUTER_API_KEY: "sk-or-test-invalid",
    OPENROUTER_BASE_URL: "http://127.0.0.1:9", // closed port — fails fast, then SDK retries
    OPENROUTER_MODEL: "test/model",
  });
  try {
    const health = await waitHealthy();
    assert.equal(health.mode, "live");
    const { text } = await chatText("hello");
    assert.match(text, /Upstream error/i, `expected visible error text in chat, got: ${JSON.stringify(text)}`);
  } finally {
    child.kill();
  }
});

// 2. Live mode without a model id → refuse to start (fail fast, clear message).
await check("live mode without OPENROUTER_MODEL fails fast at startup", async () => {
  const child = startServer({ OPENROUTER_API_KEY: "sk-or-test-invalid" });
  const exit = await new Promise((resolve) => {
    const timer = setTimeout(() => {
      child.kill();
      resolve("still-running");
    }, 5000);
    child.on("exit", (code) => {
      clearTimeout(timer);
      resolve(code);
    });
  });
  assert.equal(
    typeof exit, "number",
    "server must actually exit when key is set but model is missing — it kept running",
  );
  assert.notEqual(exit, 0, "server must exit non-zero when key is set but model is missing");
});

process.exit(failures ? 1 : 0);
