// Browser-free render check: send a prompt to the server (canned or live),
// reassemble the streamed recipe, render it through the REAL Renderer +
// library — the exact pipeline the browser runs — and report whether the
// diagram materialized. Use it when the UI looks wrong but you suspect the
// app, not the model.
//
//   npx tsx scripts/check-render.tsx ["prompt"] [baseUrl]
import { readFileSync } from "node:fs";
import React from "react";
import { renderToString } from "react-dom/server";
import { createParser, Renderer } from "@openuidev/react-lang";
import { appChatLibrary } from "../src/library/chat-library";

const base = process.argv[3] ?? "http://localhost:8787";
const prompt =
  process.argv[2] ??
  "Show our order pipeline as a flow diagram: customer places order, payment verified (failure goes back to customer), kitchen prepares, delivered. Label each arrow.";

const spec = JSON.parse(
  readFileSync(new URL("../generated/chat-library.spec.json", import.meta.url), "utf8"),
);

// 1. Get the recipe (same SSE reassembly the browser adapter does).
const res = await fetch(base + "/api/chat", {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({ messages: [{ role: "user", content: prompt }] }),
});
if (!res.ok) {
  console.error("HTTP", res.status, (await res.text()).slice(0, 200));
  process.exit(1);
}
const raw = await res.text();
let text = "";
for (const line of raw.split("\n")) {
  if (!line.startsWith("data:")) continue;
  const payload = line.slice(5).trim();
  if (payload === "[DONE]") break;
  try {
    const delta = JSON.parse(payload).choices?.[0]?.delta?.content;
    if (typeof delta === "string") text += delta;
  } catch { /* keepalives */ }
}

// 2. Structural gate.
const parser = createParser(spec.library.schema, spec.library.root);
const parseErrors = parser.parse(text).meta?.errors ?? [];
console.log(`recipe: ${text.split("\n").length} lines, ${parseErrors.length} parse error(s)`);

// 3. The real render, exactly as the browser would run it.
const html = renderToString(
  <Renderer response={text} library={appChatLibrary} isStreaming={false} />,
);
const svgs = (html.match(/<svg/g) ?? []).length;
const rects = (html.match(/<rect/g) ?? []).length;
console.log(`render: ${svgs} <svg>, ${rects} <rect>`);
console.log(html.includes("Order Pipeline") || svgs > 0 ? "diagram RENDERED" : "diagram MISSING from render");
process.exit(svgs > 0 ? 0 : 1);
