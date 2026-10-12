// Live smoke test: send a prompt through the server, reassemble the recipe
// from the SSE deltas, and make the run PROVE itself through
// scripts/diagram-smoke-contract — a terminal [DONE], nonblank output, a clean
// parse against the REAL library schema (the same gate the canned recipe
// faces), and a Card actually holding content. Absence of parser errors alone
// has never been the bar. Usage:
//   node scripts/live-smoke.mjs [baseUrl] ["your prompt"] [runs]
// Multiple runs print per-run results and end with `clean N/M`.
import { readFileSync } from "node:fs";
import { createParser } from "@openuidev/lang-core";
import { DONE, verifyTextRun } from "./diagram-smoke-contract.mjs";

const base = process.argv[2] ?? "http://localhost:8787";
const prompt =
  process.argv[3] ??
  "Show a tiny Q4 dashboard: two metric tiles (Revenue $1.2M, Orders 8214) and three follow-up questions.";
const runs = Math.max(1, Number(process.argv[4] ?? 1) || 1);

// Match the server's whole-request deadline: a smoke fetch may never hang.
const FETCH_TIMEOUT_MS = 120_000;
const fetchBounded = (url, options = {}) =>
  fetch(url, { ...options, signal: AbortSignal.timeout(FETCH_TIMEOUT_MS) });

const spec = JSON.parse(
  readFileSync(new URL("../generated/chat-library.spec.json", import.meta.url), "utf8"),
);
const parser = createParser(spec.library.schema, spec.library.root);

async function reportMode() {
  try {
    const health = await (await fetchBounded(`${base}/api/health`)).json();
    return `mode=${health.mode ?? "unknown"} model=${JSON.stringify(health.model ?? "")}`;
  } catch {
    return "mode=unknown (health check failed)";
  }
}

// POST the prompt and join the SSE content deltas into the full recipe text,
// keeping the parsed events so completion can be proved, not assumed.
async function streamOnce() {
  const res = await fetchBounded(base + "/api/chat", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ messages: [{ role: "user", content: prompt }] }),
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}: ${(await res.text()).slice(0, 200)}`);

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "", text = "";
  const events = [];
  for (;;) {
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
        if (payload === "[DONE]") { events.push(DONE); continue; }
        try {
          const parsed = JSON.parse(payload);
          events.push(parsed);
          const delta = parsed.choices?.[0]?.delta?.content;
          if (typeof delta === "string") text += delta;
        } catch { /* ignore malformed keepalives */ }
      }
    }
  }
  return { text, events };
}

const mode = await reportMode();
console.log(`text smoke against ${base} (${mode}), ${runs} run(s)`);

let clean = 0;
for (let k = 1; k <= runs; k++) {
  let stream;
  try {
    stream = await streamOnce();
  } catch (err) {
    console.log(`run ${k}/${runs}: FAILED — ${err.message}`);
    continue;
  }
  const { text, events } = stream;
  if (runs === 1) {
    console.log("=== reassembled recipe (first 15 lines) ===");
    console.log(text.split("\n").slice(0, 15).join("\n"));
    console.log("...");
  }
  const result = parser.parse(text);
  const verdict = verifyTextRun({
    text,
    events,
    parseErrors: result.meta?.errors ?? [],
    root: result.root ?? null,
  });
  if (verdict.ok) {
    clean += 1;
    console.log(`run ${k}/${runs}: clean — Card with ${result.root?.props?.children?.length ?? 0} block(s)`);
    continue;
  }
  console.log(`run ${k}/${runs}: FAILED`);
  for (const error of verdict.errors) console.log(`   - ${error}`);
}

console.log(`clean ${clean}/${runs} runs against "${spec.library.root}"`);
process.exit(clean === runs ? 0 : 1);
