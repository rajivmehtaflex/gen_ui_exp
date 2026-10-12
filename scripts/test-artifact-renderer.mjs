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
  assert.equal(parsed.props.status, "ready");
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
  assert.equal(partialWithTitle.props.status, "building");
  assert.equal(partialWithTitle.props.title, "Deploy Pipeline");
  assert.equal(partialWithTitle.meta, null, "meta must be null during streaming");

  // Unparseable / empty:
  const broken = diagramArtifactRenderer.parser(
    { args: '{"something_else":', response: null },
    { isStreaming: true, isActive: false, open: () => {}, close: () => {} },
  );
  assert.equal(broken, null, "unparseable or title-less partial should return null without throwing");
  assert.equal(diagramArtifactRenderer.parser(
    { args: '{"title":{ "bad":true }}', response: null },
    { isStreaming: true, isActive: false, open: () => {}, close: () => {} },
  ), null);
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

await check("failed response wins over complete arguments and renders a failure", () => {
  const parsed = diagramArtifactRenderer.parser(
    { args: JSON.stringify({ title: "Deploy", type: "architecture", spec: {} }), response: { ok: false, error: "invalid layout" } },
    { isStreaming: false, isActive: false, open: () => {}, close: () => {} },
  );
  assert.equal(parsed.props.status, "failed");
  assert.equal(parsed.props.error, "invalid layout");
  assert.equal(parsed.meta, null);
  const preview = renderToString(diagramArtifactRenderer.preview(parsed.props, { isStreaming: false, isActive: false, open: () => {}, close: () => {} }));
  assert.match(preview, /invalid layout/);
  assert.doesNotMatch(preview, /Open|building/i);
  const panel = renderToString(diagramArtifactRenderer.actual(parsed.props, { isStreaming: false, isActive: true, open: () => {}, close: () => {} }));
  assert.match(panel, /invalid layout/);
  assert.doesNotMatch(panel, /<iframe/);
});

await check("failure panel shows diagnostic details", () => {
  const parsed = diagramArtifactRenderer.parser(
    { args: JSON.stringify({ title: "Deploy" }), response: { ok: false, error: "validation failed", diagnostics: [{ message: "node A has no label" }] } },
    { isStreaming: false, isActive: false, open: () => {}, close: () => {} },
  );
  const panel = renderToString(diagramArtifactRenderer.actual(parsed.props, { isStreaming: false, isActive: true, open: () => {}, close: () => {} }));
  assert.match(panel, /validation failed/);
  assert.match(panel, /node A has no label/);
});

await check("parser rejects malformed completed response fields", () => {
  const controls = { isStreaming: false, isActive: false, open: () => {}, close: () => {} };
  const args = JSON.stringify({ title: "Deploy", type: "architecture", spec: {} });
  for (const response of [
    { ok: "true", diagramId: "d1", title: "Deploy", type: "architecture" },
    { ok: true, diagramId: {}, title: "Deploy", type: "architecture" },
    { ok: true, diagramId: "d1", title: {}, type: "architecture" },
    { ok: true, diagramId: "d1", title: "Deploy", type: "unknown" },
  ]) {
    const parsed = diagramArtifactRenderer.parser({ args, response }, controls);
    assert.notEqual(parsed?.props.status, "ready", JSON.stringify(response));
    assert.equal(parsed?.meta, null);
  }
});

await check("ready panel checks availability before rendering iframe", () => {
  const html = renderToString(
    diagramArtifactRenderer.actual(
      { status: "ready", diagramId: "d1", title: "Deploy", type: "architecture" },
      { isStreaming: false, isActive: true, open: () => {}, close: () => {} },
    ),
  );
  assert.match(html, /Checking diagram availability/);
  assert.doesNotMatch(html, /<iframe/);
});

await check("preview renders title text and building state", () => {
  const previewHtml = renderToString(
    diagramArtifactRenderer.preview(
      { status: "building", title: "My Architecture Map" },
      { isStreaming: false, isActive: false, open: () => {}, close: () => {} },
    ),
  );
  assert.ok(previewHtml.includes("My Architecture Map"));

  const streamingHtml = renderToString(
    diagramArtifactRenderer.preview(
      { status: "building", title: "My Architecture Map" },
      { isStreaming: true, isActive: false, open: () => {}, close: () => {} },
    ),
  );
  assert.ok(streamingHtml.includes("building"));
});

process.exit(failures ? 1 : 0);
