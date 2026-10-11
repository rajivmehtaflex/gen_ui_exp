// Live smoke test: send one prompt through the server, reassemble the recipe
// from the SSE deltas, and parse it against the REAL library schema — the same
// gate the canned recipe faces. Usage:
//   node scripts/live-smoke.mjs [baseUrl] ["your prompt"]
import { readFileSync } from "node:fs";
import { createParser } from "@openuidev/lang-core";

const base = process.argv[2] ?? "http://localhost:8787";
const prompt =
  process.argv[3] ??
  "Show a tiny Q4 dashboard: two metric tiles (Revenue $1.2M, Orders 8214) and three follow-up questions.";

const spec = JSON.parse(
  readFileSync(new URL("../generated/chat-library.spec.json", import.meta.url), "utf8"),
);

const res = await fetch(base + "/api/chat", {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({ messages: [{ role: "user", content: prompt }] }),
});
if (!res.ok) {
  console.error("HTTP", res.status, await res.text());
  process.exit(1);
}

// Consume the SSE stream, joining content deltas into the full recipe text.
const reader = res.body.getReader();
const decoder = new TextDecoder();
let buffer = "", text = "", finished = false;
while (!finished) {
  const { value, done } = await reader.read();
  if (done) break;
  buffer += decoder.decode(value, { stream: true });
  let idx;
  while ((idx = buffer.indexOf("\n\n")) >= 0) {
    const frame = buffer.slice(0, idx);
    buffer = buffer.slice(idx + 2);
    for (const line of frame.split("\n")) {
      if (!line.startsWith("data:")) continue;
      const payload = line.slice(5).trim();
      if (payload === "[DONE]") { finished = true; continue; }
      try {
        const parsed = JSON.parse(payload);
        const delta = parsed.choices?.[0]?.delta?.content;
        if (typeof delta === "string") text += delta;
        if (parsed.error) console.error("server error event:", parsed.error.message);
      } catch { /* ignore malformed keepalives */ }
    }
  }
}

console.log("=== reassembled recipe (first 15 lines) ===");
console.log(text.split("\n").slice(0, 15).join("\n"));
console.log("...");

const parser = createParser(spec.library.schema, spec.library.root);
const result = parser.parse(text);
const errors = result.meta?.errors ?? [];
console.log(`=== parse against "${spec.library.root}": ${errors.length} error(s) ===`);
for (const e of errors.slice(0, 10)) console.log(" -", JSON.stringify(e).slice(0, 300));
process.exit(errors.length ? 1 : 0);
