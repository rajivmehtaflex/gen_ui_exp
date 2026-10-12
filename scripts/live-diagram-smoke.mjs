// Live diagram smoke test: send an interactive-diagram prompt through the
// server and make the run PROVE itself through scripts/diagram-smoke-contract
// — a create_diagram tool call correlated with its result by tool call id, a
// receipt that names the diagram, its full sha256 and its byte count, a
// terminal [DONE], and a GET /api/artifacts/<id> that serves text/html with
// nosniff/no-store and whose bytes re-hash to exactly the receipt's digest.
//
// Usage:
//   node scripts/live-diagram-smoke.mjs [baseUrl] ["prompt"] [runs]
//
// Every fetch is bounded (120 s, the server's own request deadline). Live
// provider runs stay opt-in: point this at a server started with a key.
import { successfulDiagramResult, verifyDiagramRun } from "./diagram-smoke-contract.mjs";

const base = process.argv[2] ?? "http://localhost:8787";
const prompt =
  process.argv[3] ??
  "Diagram our deploy pipeline as an interactive architecture map";
const runs = Math.max(1, Number(process.argv[4] ?? 1) || 1);

// Match the server's whole-request deadline: a smoke fetch may never hang.
const FETCH_TIMEOUT_MS = 120_000;
const fetchBounded = (url, options = {}) =>
  fetch(url, { ...options, signal: AbortSignal.timeout(FETCH_TIMEOUT_MS) });

async function reportMode() {
  try {
    const health = await (await fetchBounded(`${base}/api/health`)).json();
    return `mode=${health.mode ?? "unknown"} model=${JSON.stringify(health.model ?? "")}`;
  } catch {
    return "mode=unknown (health check failed)";
  }
}

// POST the prompt and collect the SSE evidence: parsed chunk objects plus the
// [DONE] sentinel, exactly the shapes the contract judges.
async function streamRun() {
  const res = await fetchBounded(base + "/api/chat", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ messages: [{ role: "user", content: prompt }] }),
  });
  if (!res.ok) {
    throw new Error(`HTTP ${res.status}: ${(await res.text()).slice(0, 200)}`);
  }

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  const events = [];
  let assistantText = "";

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
        if (payload === "[DONE]") {
          events.push("[DONE]");
          continue;
        }
        try {
          const parsed = JSON.parse(payload);
          events.push(parsed);
          if (typeof parsed.choices?.[0]?.delta?.content === "string") {
            assistantText += parsed.choices[0].delta.content;
          }
        } catch {
          // ignore unparseable keepalives or comment frames
        }
      }
    }
  }
  return { events, assistantText };
}

async function runOnce(runIndex) {
  const { events, assistantText } = await streamRun();
  const success = successfulDiagramResult(events);

  let artifactResponse = null;
  if (success?.diagramId) {
    const res = await fetchBounded(`${base}/api/artifacts/${encodeURIComponent(success.diagramId)}`);
    artifactResponse = {
      status: res.status,
      headers: Object.fromEntries([...res.headers]),
      body: await res.text(),
    };
  }

  const verdict = verifyDiagramRun({ events, artifactResponse });
  if (verdict.ok) {
    console.log(
      `run ${runIndex}/${runs}: OK — title="${success.title}" type="${success.type}" id=${success.diagramId.slice(0, 8)}... ` +
      `html=${success.bytes}b sha256=${success.sha256}`,
    );
    return true;
  }

  console.log(`run ${runIndex}/${runs}: FAILED — ${success?.diagramId ? "artifact" : "diagram"} contract violated`);
  for (const error of verdict.errors) console.log(`   - ${error}`);
  if (!success && assistantText) {
    console.log(`   assistant replied with text: ${assistantText.slice(0, 150)}...`);
  }
  return false;
}

const mode = await reportMode();
console.log(`diagram smoke against ${base} (${mode}), ${runs} run(s)`);

let passed = 0;
for (let k = 1; k <= runs; k++) {
  try {
    if (await runOnce(k)) passed += 1;
  } catch (err) {
    console.log(`run ${k}/${runs}: FAILED — ${err.message}`);
  }
}

console.log(`runs ${passed}/${runs} passed the diagram contract`);
process.exit(passed === runs ? 0 : 1);
