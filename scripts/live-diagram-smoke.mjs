// Live diagram smoke test: send an interactive-diagram prompt through the
// server, verify that the SSE stream contains a create_diagram tool call and
// result, extract the diagramId, and verify that GET /api/artifacts/<id>
// serves valid HTML.
//
// Usage:
//   node scripts/live-diagram-smoke.mjs [baseUrl] ["prompt"] [runs]
import { createHash } from "node:crypto";

const base = process.argv[2] ?? "http://localhost:8787";
const prompt =
  process.argv[3] ??
  "Diagram our deploy pipeline as an interactive architecture map";
const runs = Math.max(1, Number(process.argv[4] ?? 1) || 1);

async function runOnce(runIndex) {
  const res = await fetch(base + "/api/chat", {
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
  let finished = false;
  let toolCallDetected = false;
  let toolResult = null;
  let assistantText = "";

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
        if (payload === "[DONE]") {
          finished = true;
          continue;
        }
        try {
          const parsed = JSON.parse(payload);
          const choice = parsed.choices?.[0];
          const delta = choice?.delta;

          if (delta?.tool_calls) {
            for (const tc of delta.tool_calls) {
              if (tc?.function?.name === "create_diagram" || tc?.id) {
                toolCallDetected = true;
              }
            }
          }

          if (delta?.role === "tool" && delta?.content) {
            try {
              const resData = JSON.parse(delta.content);
              toolResult = resData;
            } catch {
              // content might be raw string or partial
            }
          }

          if (typeof delta?.content === "string") {
            assistantText += delta.content;
          }

          if (parsed.error) {
            console.error("server error event:", parsed.error.message);
          }
        } catch {
          // ignore unparseable keepalives or frames
        }
      }
    }
  }

  // Check tool result
  const hasToolCall = Boolean(toolCallDetected || (toolResult && toolResult.diagramId));
  const diagramId = toolResult?.diagramId;

  if (!hasToolCall || !diagramId) {
    console.log(
      `run ${runIndex}/${runs}: NO_TOOL_CALL — toolCallDetected=${toolCallDetected}, result=${JSON.stringify(
        toolResult
      )}`
    );
    if (assistantText) {
      console.log(`   assistant replied with text: ${assistantText.slice(0, 150)}...`);
    }
    return { toolCallOk: false, artifactOk: false };
  }

  // Verify artifact endpoint
  const artifactRes = await fetch(`${base}/api/artifacts/${encodeURIComponent(diagramId)}`);
  if (!artifactRes.ok) {
    console.log(
      `run ${runIndex}/${runs}: ARTIFACT_HTTP_${artifactRes.status} for diagramId ${diagramId}`
    );
    return { toolCallOk: true, artifactOk: false };
  }

  const contentType = artifactRes.headers.get("content-type") ?? "";
  if (!contentType.includes("text/html")) {
    console.log(
      `run ${runIndex}/${runs}: UNEXPECTED_CONTENT_TYPE "${contentType}" (expected text/html)`
    );
    return { toolCallOk: true, artifactOk: false };
  }

  const html = await artifactRes.text();
  if (html.length === 0) {
    console.log(`run ${runIndex}/${runs}: EMPTY_ARTIFACT_HTML for diagramId ${diagramId}`);
    return { toolCallOk: true, artifactOk: false };
  }

  const hash = createHash("sha256").update(html).digest("hex").slice(0, 8);
  console.log(
    `run ${runIndex}/${runs}: OK — title="${toolResult.title}" type="${toolResult.type}" id=${diagramId.slice(
      0,
      8
    )}... html=${html.length}b (sha256:${hash})`
  );
  return { toolCallOk: true, artifactOk: true };
}

let toolCallsOK = 0;
let artifactsOK = 0;

for (let k = 1; k <= runs; k++) {
  try {
    const { toolCallOk, artifactOk } = await runOnce(k);
    if (toolCallOk) toolCallsOK++;
    if (artifactOk) artifactsOK++;
  } catch (err) {
    console.log(`run ${k}/${runs}: FAILED — ${err.message}`);
  }
}

console.log(`toolCalls ${toolCallsOK}/${runs} · artifactsOK ${artifactsOK}/${runs}`);
process.exit(toolCallsOK === runs && artifactsOK === runs ? 0 : 1);
