// Render-geometry tests — the layer the parser and layout gates cannot see.
// Render the real component and assert labels sit INSIDE their boxes and the
// SVG cannot upscale without bound. Run: npx tsx scripts/test-diagram-render.mjs
import assert from "node:assert/strict";
import React from "react";
import { renderToString } from "react-dom/server";
import { FlowDiagram } from "../src/library/diagrams/flow";
import { SequenceDiagram } from "../src/library/diagrams/sequence";
import { StepExplainer } from "../src/library/diagrams/explainer";
import { chromium } from "playwright";

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

// 3. Graphs expose their actual nodes, endpoints and labels to assistive tech;
// visually shortened labels also retain native full-text alternatives.
assert.match(html, /<title[^>]*>Flow diagram<\/title>/, "flow SVG needs an accessible title");
const flowDescriptionId = html.match(/aria-describedby="([^"]+)"/)?.[1];
assert.ok(flowDescriptionId, "flow SVG must point to its accessible description");
assert.ok(html.includes(`<desc id="${flowDescriptionId}">`), "flow description must be associated with the SVG");
for (const description of ["First step (a)", "Third step (c)", "a to b: ok", "b to c: done"]) {
  assert.ok(html.includes(description), `flow graph description needs ${description}`);
}
const longNodeLabel = "A full node label that is intentionally much longer than two visual lines";
const longFlowHtml = renderToString(
  FlowDiagram.component({
    props: {
      nodes: [{ props: { id: "long", label: longNodeLabel } }],
      edges: [],
    },
  }),
);
assert.ok(longFlowHtml.includes(`<title>${longNodeLabel}</title>`), "truncated flow node needs a full-label title");

// 4. Render bounds and diagnostics remain visible after parser references become
// partial, duplicated, dangling, self-connected or over their authoring limit.
const tooManyNodes = Array.from({ length: 13 }, (_, i) => ({ props: { id: `n${i}`, label: `Node ${i}` } }));
const boundedFlowHtml = renderToString(
  FlowDiagram.component({
    props: {
      nodes: tooManyNodes,
      edges: [
        { props: { from: "n0", to: "n0", label: "self" } },
        { props: { from: "n0", to: "ghost", label: "dangling" } },
      ],
    },
  }),
);
const boundedGroups = [...boundedFlowHtml.matchAll(/<g transform="translate\(([-\d.]+),\s*([-\d.]+)\)">/g)];
assert.equal(boundedGroups.length, 12, "rendered flow is capped at 12 nodes");
assert.match(boundedFlowHtml, /node[s]? omitted/i, "flow omissions must be reported");
assert.match(boundedFlowHtml, /self-edge|self connection/i, "flow self-edge must be reported");
assert.match(boundedFlowHtml, /dangling|unknown node/i, "dangling flow connection must be reported");
assert.doesNotMatch(boundedFlowHtml, /<path d="M [^"]+"[^>]*marker-end=/, "flow self-edge must not render a path");
const duplicateFlowHtml = renderToString(
  FlowDiagram.component({
    props: {
      nodes: [
        { props: { id: "same", label: "First copy" } },
        { props: { id: "same", label: "Duplicate copy" } },
      ],
      edges: [],
    },
  }),
);
assert.match(duplicateFlowHtml, /duplicate id/i, "duplicate flow IDs must be reported");
const partialHtml = renderToString(
  FlowDiagram.component({ props: { nodes: [null, { props: { id: "partial" } }], edges: [null] } }),
);
assert.match(partialHtml, /partial|omitted/i, "partial OpenUI arrays render a visible omission diagnostic");
const partialSequenceHtml = renderToString(
  SequenceDiagram.component({
    props: {
      participants: [{ props: { id: "p0", label: "Participant" } }],
      messages: [null, { props: { from: "p0", to: "p0" } }],
    },
  }),
);
assert.match(partialSequenceHtml, /messages omitted/i, "partial messages missing required labels render an omission diagnostic");

// 5. Sequence descriptions preserve participants, endpoint IDs, and complete
// labels. A 120-character last-lane loop remains inside the layout viewBox.
const loopLabel = "self loop " + "x".repeat(110);
const sequenceHtml = renderToString(
  SequenceDiagram.component({
    props: {
      participants: [{ props: { id: "solo", label: "A deliberately long participant name" } }],
      messages: [{ props: { from: "solo", to: "solo", label: loopLabel } }],
    },
  }),
);
assert.match(sequenceHtml, /<title[^>]*>Sequence diagram<\/title>/, "sequence SVG needs an accessible title");
const sequenceDescriptionId = sequenceHtml.match(/aria-describedby="([^"]+)"/)?.[1];
assert.ok(sequenceDescriptionId, "sequence SVG must point to its accessible description");
assert.ok(sequenceHtml.includes(`<desc id="${sequenceDescriptionId}">`), "sequence description must be associated with the SVG");
assert.ok(sequenceHtml.includes("solo to solo"), "sequence description needs source and target IDs");
assert.ok(sequenceHtml.includes(loopLabel), "sequence description and title must retain the full message label");
assert.ok(sequenceHtml.includes("<title>A deliberately long participant name</title>"), "participant label needs a full-text alternative");
assert.match(sequenceHtml, /style="[^"]*overflow-x:auto[^"]*"/, "wide sequence diagrams must scroll horizontally on narrow screens");
const viewBoxWidth = Number(sequenceHtml.match(/viewBox="0 0 ([\d.]+) [\d.]+"/)?.[1]);
const loopLabelX = Number(sequenceHtml.match(/<text x="([\d.]+)" y="[\d.]+" text-anchor="start"[^>]*>self loop/)?.[1]);
assert.ok(Number.isFinite(viewBoxWidth) && Number.isFinite(loopLabelX), "sequence viewBox and loop text geometry must be present");
assert.ok(loopLabelX + loopLabel.length * 6.2 <= viewBoxWidth, "last-lane loop text must fit its viewBox");
const noisySequenceHtml = renderToString(
  SequenceDiagram.component({
    props: {
      participants: [
        ...Array.from({ length: 7 }, (_, i) => ({ props: { id: `p${i}`, label: `P${i}` } })),
        { props: { id: "p0", label: "Duplicate P0" } },
      ],
      messages: [
        { props: { from: "p0", to: "p1", label: "retained" } },
        { props: { from: "p0", to: "ghost", label: "dangling" } },
        ...Array.from({ length: 12 }, (_, i) => ({ props: { from: "p0", to: "p1", label: `extra ${i}` } })),
      ],
    },
  }),
);
assert.match(noisySequenceHtml, /duplicate id/i, "duplicate participant IDs must be reported");
assert.match(noisySequenceHtml, /unknown participant/i, "dangling sequence messages must be reported");
assert.match(noisySequenceHtml, /omitted/i, "over-limit sequence participants or messages must be reported");

// 6. Explainer steps are a semantic ordered list, not generic numbered divs.
const explainerHtml = renderToString(
  StepExplainer.component({
    props: {
      steps: [
        { props: { title: "First", body: "First body" } },
        { props: { title: "Second", body: "Second body" } },
      ],
    },
  }),
);
assert.match(explainerHtml, /<ol[^>]*aria-label="Ordered concept walkthrough"/, "explainer needs ordered-list semantics");
assert.equal((explainerHtml.match(/<li\b/g) ?? []).length, 2, "every explainer step is a list item");
assert.ok(explainerHtml.indexOf("First") < explainerHtml.indexOf("Second"), "step order must be preserved");
const omittedExplainerHtml = renderToString(
  StepExplainer.component({
    props: {
      steps: [
        ...Array.from({ length: 13 }, (_, i) => ({ props: { title: `Step ${i}` } })),
        null,
      ],
    },
  }),
);
assert.equal((omittedExplainerHtml.match(/<li\b/g) ?? []).length, 12, "rendered explainer is capped at 12 steps");
assert.match(omittedExplainerHtml, /omitted/i, "omitted explainer steps must be reported");

// 7. Verify browser accessibility and actual narrow-screen overflow behavior,
// not only the serialized markup.
const browser = await chromium.launch({ headless: true });
try {
  const flowPage = await browser.newPage({ viewport: { width: 360, height: 780 } });
  await flowPage.setContent(`<main>${html}</main>`);
  const flowImage = flowPage.getByRole("img", { name: "Flow diagram" });
  assert.equal(await flowImage.count(), 1, "browser accessibility tree must expose the flow as a named image");
  const flowAccessibleDescription = await flowImage.evaluate((element) => {
    const id = element.getAttribute("aria-describedby");
    return id ? document.getElementById(id)?.textContent : null;
  });
  assert.ok(flowAccessibleDescription?.includes("a to b: ok"), "flow accessible description must expose its connections");

  const sequencePage = await browser.newPage({ viewport: { width: 320, height: 780 } });
  await sequencePage.setContent(`<main>${sequenceHtml}</main>`);
  const sequenceImage = sequencePage.getByRole("img", { name: "Sequence diagram" });
  assert.equal(await sequenceImage.count(), 1, "browser accessibility tree must expose the sequence as a named image");
  const sequenceAccessibleDescription = await sequenceImage.evaluate((element) => {
    const id = element.getAttribute("aria-describedby");
    return id ? document.getElementById(id)?.textContent : null;
  });
  assert.ok(sequenceAccessibleDescription?.includes(`solo to solo: ${loopLabel}`), "sequence accessible description must expose full endpoints and message text");
  const scrollBefore = await sequencePage.locator(".gx-diagram").evaluate((element) => ({
    clientWidth: element.clientWidth,
    scrollWidth: element.scrollWidth,
    overflowX: getComputedStyle(element).overflowX,
  }));
  assert.equal(scrollBefore.overflowX, "auto", "the sequence wrapper must allow mobile horizontal scrolling");
  assert.ok(scrollBefore.scrollWidth > scrollBefore.clientWidth, "long sequence content must overflow the mobile viewport horizontally");
  await sequencePage.locator(".gx-diagram").evaluate((element) => { element.scrollLeft = element.scrollWidth; });
  assert.ok(await sequencePage.locator(".gx-diagram").evaluate((element) => element.scrollLeft > 0), "mobile users can scroll across the full sequence");
} finally {
  await browser.close();
}

console.log("test-diagram-render OK — bounded geometry, browser accessibility, mobile scrolling, full-label alternatives and ordered steps");
