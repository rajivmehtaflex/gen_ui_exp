// Tests for Task 7: Artifact renderer contract tests.
// Plain node / tsx, renderToString from react-dom/server.
// Run: npx tsx scripts/test-artifact-renderer.mjs
import assert from "node:assert/strict";
import React from "react";
import { renderToString } from "react-dom/server";
import { diagramArtifactRenderer } from "../src/artifacts/diagram-artifact.tsx";

let failures = 0;
function check(name, fn) {
  return Promise.resolve()
    .then(fn)
    .then(() => console.log(`PASS  ${name}`))
    .catch((e) => {
      failures++;
      console.error(`FAIL  ${name}\n      ${e.message}`);
    });
}

await check("diagramArtifactRenderer configuration matches specification", () => {
  assert.equal(diagramArtifactRenderer.type, "diagram-html");
  assert.equal(diagramArtifactRenderer.toolName, "create_diagram");
});

await check("parser handles completed final tool result", () => {
  const finalResult = {
    ok: true,
    diagramId: "d1",
    title: "Deploy",
    type: "architecture",
  };
  const parsed = diagramArtifactRenderer.parser(
    { args: JSON.stringify({ title: "Deploy" }), response: finalResult },
    { isStreaming: false, isActive: false, open: () => {}, close: () => {} },
  );
  assert.ok(parsed, "must return non-null ParsedArtifact");
  assert.equal(parsed.props.diagramId, "d1");
  assert.equal(parsed.props.title, "Deploy");
  assert.equal(parsed.props.type, "architecture");
  assert.deepEqual(parsed.meta, { id: "d1", version: 1, heading: "Deploy" });
});

await check("parser handles partial streaming arguments", () => {
  // Partial with title:
  const partialWithTitle = diagramArtifactRenderer.parser(
    { args: '{"title":"Deploy Pipeline"', response: null },
    { isStreaming: true, isActive: false, open: () => {}, close: () => {} },
  );
  assert.ok(partialWithTitle, "must return non-null when title is parsed");
  assert.equal(partialWithTitle.props.title, "Deploy Pipeline");
  assert.equal(partialWithTitle.meta, null, "meta must be null during streaming");

  // Unparseable / empty:
  const broken = diagramArtifactRenderer.parser(
    { args: '{"something_else":', response: null },
    { isStreaming: true, isActive: false, open: () => {}, close: () => {} },
  );
  assert.equal(broken, null, "unparseable or title-less partial should return null without throwing");
});

await check("parser handles stored reopen without args", () => {
  const stored = diagramArtifactRenderer.parser(
    { args: undefined, response: { ok: true, diagramId: "d1", title: "Deploy", type: "architecture" } },
    { isStreaming: false, isActive: false, open: () => {}, close: () => {} },
  );
  assert.ok(stored);
  assert.equal(stored.props.diagramId, "d1");
  assert.equal(stored.props.title, "Deploy");
  assert.deepEqual(stored.meta, { id: "d1", version: 1, heading: "Deploy" });
});

await check("actual renders a sandboxed iframe without allow-same-origin", () => {
  const html = renderToString(
    diagramArtifactRenderer.actual(
      { diagramId: "d1", title: "Deploy", type: "architecture" },
      { isStreaming: false, isActive: true, open: () => {}, close: () => {} },
    ),
  );
  assert.ok(html.includes("<iframe"), "must render an iframe");
  assert.ok(html.includes('src="/api/artifacts/d1"'));
  assert.ok(html.includes('sandbox="allow-scripts"'));
  assert.ok(!html.includes("allow-same-origin"), "must NOT contain allow-same-origin");
});

await check("preview renders title text and building state", () => {
  const previewHtml = renderToString(
    diagramArtifactRenderer.preview(
      { title: "My Architecture Map" },
      { isStreaming: false, isActive: false, open: () => {}, close: () => {} },
    ),
  );
  assert.ok(previewHtml.includes("My Architecture Map"));

  const streamingHtml = renderToString(
    diagramArtifactRenderer.preview(
      { title: "My Architecture Map" },
      { isStreaming: true, isActive: false, open: () => {}, close: () => {} },
    ),
  );
  assert.ok(streamingHtml.includes("building"));
});

process.exit(failures ? 1 : 0);
