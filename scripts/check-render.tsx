// Browser-free render check: send a prompt to the server (canned or live),
// reassemble the streamed recipe, render it through the REAL Renderer +
// library — the exact pipeline the browser runs — and gate the result through
// scripts/diagram-smoke-contract: the stream must have completed, the recipe
// must parse clean, and the render must carry the EXPECTED diagram family's
// own markup (leftover svg from a partial render proves nothing). Use it when
// the UI looks wrong but you suspect the app, not the model.
//
//   npx tsx scripts/check-render.tsx ["prompt"] [baseUrl] [family]
//
// `family` names the component whose markup must appear (FlowDiagram,
// SequenceDiagram, StepExplainer); it defaults to FlowDiagram, so a flow
// prompt needs no third argument. The fetch is bounded at 120 s.
import { readFileSync } from "node:fs";
import React from "react";
import { renderToString } from "react-dom/server";
import { createParser, Renderer } from "@openuidev/react-lang";
import { appChatLibrary } from "../src/library/chat-library";
import { verifyRenderedRecipe } from "./diagram-smoke-contract.mjs";

const base = process.argv[3] ?? "http://localhost:8787";
const prompt =
  process.argv[2] ??
  "Show our order pipeline as a flow diagram: customer places order, payment verified (failure goes back to customer), kitchen prepares, delivered. Label each arrow.";
const expectedFamily = process.argv[4] ?? "FlowDiagram";

const spec = JSON.parse(
  readFileSync(new URL("../generated/chat-library.spec.json", import.meta.url), "utf8"),
);

// 1. Get the recipe (same SSE reassembly the browser adapter does), and record
//    whether the stream actually finished.
let res;
try {
  res = await fetch(base + "/api/chat", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ messages: [{ role: "user", content: prompt }] }),
    signal: AbortSignal.timeout(120_000),
  });
} catch (error) {
  console.error(`cannot reach ${base}: ${error.message}`);
  process.exit(1);
}
if (!res.ok) {
  console.error("HTTP", res.status, (await res.text()).slice(0, 200));
  process.exit(1);
}
const raw = await res.text();
let text = "";
let completed = false;
for (const line of raw.split("\n")) {
  if (!line.startsWith("data:")) continue;
  const payload = line.slice(5).trim();
  if (payload === "[DONE]") {
    completed = true;
    break;
  }
  try {
    const delta = JSON.parse(payload).choices?.[0]?.delta?.content;
    if (typeof delta === "string") text += delta;
  } catch { /* keepalives */ }
}

// 2. Structural gate: the recipe must parse against the current library.
const parser = createParser(spec.library.schema, spec.library.root);
const parseErrors = parser.parse(text).meta?.errors ?? [];

// 3. The real render, exactly as the browser would run it.
const html = renderToString(
  <Renderer response={text} library={appChatLibrary} isStreaming={false} />,
);
const svgs = (html.match(/<svg/g) ?? []).length;
const rects = (html.match(/<rect/g) ?? []).length;
console.log(`recipe: ${text.split("\n").length} lines, ${parseErrors.length} parse error(s), ${completed ? "stream completed" : "stream did NOT complete"}`);
console.log(`render: ${svgs} <svg>, ${rects} <rect> (expecting ${expectedFamily} markup)`);

// 4. The gate: completed stream + clean parse + the family's own markup.
const verdict = verifyRenderedRecipe({
  text,
  parseErrors,
  renderedHtml: html,
  expectedFamily,
  completed,
});
if (!verdict.ok) {
  console.error(`render gate FAILED for ${expectedFamily}:`);
  for (const error of verdict.errors) console.error(`   - ${error}`);
  process.exit(1);
}
console.log(`${expectedFamily} RENDERED: clean parse, family markup present`);
