// Live smoke test: send a prompt through the server, reassemble the recipe
// from the SSE deltas, and parse it against the REAL library schema — the same
// gate the canned recipe faces. Usage:
//   node scripts/live-smoke.mjs [baseUrl] ["your prompt"] [runs]
// Multiple runs print per-run error counts and end with `clean N/M`.
import { readFileSync } from "node:fs";
import { createParser } from "@openuidev/lang-core";

const base = process.argv[2] ?? "http://localhost:8787";
const prompt =
  process.argv[3] ??
  "Show a tiny Q4 dashboard: two metric tiles (Revenue $1.2M, Orders 8214) and three follow-up questions.";
const runs = Math.max(1, Number(process.argv[4] ?? 1) || 1);

const spec = JSON.parse(
  readFileSync(new URL("../generated/chat-library.spec.json", import.meta.url), "utf8"),
);
const parser = createParser(spec.library.schema, spec.library.root);

// POST the prompt and join the SSE content deltas into the full recipe text.
async function streamOnce() {
  const res = await fetch(base + "/api/chat", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ messages: [{ role: "user", content: prompt }] }),
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}: ${(await res.text()).slice(0, 200)}`);

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
  return text;
}

let clean = 0;
for (let k = 1; k <= runs; k++) {
  let text = "";
  try {
    text = await streamOnce();
  } catch (err) {
    console.log(`run ${k}/${runs}: FAILED — ${err.message}`);
    continue;
  }
  if (runs === 1) {
    console.log("=== reassembled recipe (first 15 lines) ===");
    console.log(text.split("\n").slice(0, 15).join("\n"));
    console.log("...");
  }
  const result = parser.parse(text);
  const errors = result.meta?.errors ?? [];
  const blank = text.trim().length === 0;
  if (blank) {
    console.log(`run ${k}/${runs}: BLANK reply`);
    continue;
  }
  console.log(`run ${k}/${runs}: ${errors.length} error(s)`);
  for (const e of errors.slice(0, 3)) console.log("   -", JSON.stringify(e).slice(0, 200));
  if (errors.length === 0) clean += 1;
}

console.log(`clean ${clean}/${runs} runs against "${spec.library.root}"`);
process.exit(clean === runs ? 0 : 1);
