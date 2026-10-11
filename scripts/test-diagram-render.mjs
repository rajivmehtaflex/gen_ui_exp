// Render-geometry tests — the layer the parser and layout gates cannot see.
// Render the real component and assert labels sit INSIDE their boxes and the
// SVG cannot upscale without bound. Run: npx tsx scripts/test-diagram-render.mjs
import assert from "node:assert/strict";
import React from "react";
import { renderToString } from "react-dom/server";
import { FlowDiagram } from "../src/library/diagrams/flow";

const nodes = [
  { props: { id: "a", label: "First step" } },
  { props: { id: "b", label: "Second step" } },
  { props: { id: "c", label: "Third step" } },
];
const edges = [
  { props: { from: "a", to: "b", label: "ok" } },
  { props: { from: "b", to: "c", label: "done" } },
];

const html = renderToString(FlowDiagram.component({ props: { nodes, edges } }));

// 1. Every node's label must be inside its own box: the group is translated to
// the box top-left, so each <text> y must fall within [0, box height] locally.
const groups = [...html.matchAll(/<g transform="translate\(([-\d.]+),\s*([-\d.]+)\)">([\s\S]*?)<\/g>/g)];
assert.equal(groups.length, nodes.length, `expected ${nodes.length} node groups, got ${groups.length}`);
for (const [, tx, ty, inner] of groups) {
  const boxH = Number(inner.match(/height="([\d.]+)"/)?.[1]);
  assert.ok(boxH > 0, "node box height missing");
  const textYs = [...inner.matchAll(/<text [^>]*y="([-\d.]+)"/g)].map((m) => Number(m[1]));
  assert.ok(textYs.length >= 1, "node label text missing");
  for (const y of textYs) {
    assert.ok(
      y > 0 && y < boxH,
      `label y=${y} outside its box (local range 0..${boxH}) — displaced-label bug`,
    );
  }
}

// 2. The SVG must cap upscaling (no stretching a narrow layout to full width).
assert.match(html, /max-width/, "svg style must cap upscaling (max-width)");
assert.doesNotMatch(html, /min-width:520/, "old fixed minWidth must not return");

console.log("test-diagram-render OK — labels inside boxes, scaling capped");
