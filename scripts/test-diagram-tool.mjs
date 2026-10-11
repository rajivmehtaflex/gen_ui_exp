// Tests for the diagram-tool core: executeDiagramTool (validate + deliver
// subprocess pipeline) and the artifact registry + GET endpoint. Plain node,
// no test framework, in-process express server on an ephemeral port.
// Run: node scripts/test-diagram-tool.mjs
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import express from "express";

const { executeDiagramTool, registerArtifactRoutes, artifactRegistry, DIAGRAM_TYPES } = await import(
  "../server/diagram-tool.mjs"
);

// --- helper: an ephemeral-port express app with the artifact routes wired ----
async function listen() {
  const app = express();
  app.use(express.json());
  registerArtifactRoutes(app);
  return new Promise((resolve) => {
    const server = app.listen(0, "127.0.0.1", () => resolve(server));
  });
}

function baseUrl(server) {
  const { address, port } = server.address();
  return `http://${address}:${port}`;
}

// --- the fixture spec Task 1 validated --------------------------------------
const spec = JSON.parse(
  readFileSync(new URL("../server/examples/diagrams/architecture.json", import.meta.url), "utf8"),
);

let failures = 0;
function check(name, fn) {
  return Promise.resolve()
    .then(fn)
    .then(() => console.log(`PASS  ${name}`))
    .catch((e) => { failures++; console.error(`FAIL  ${name}\n      ${e.message}`); });
}

await check("DIAGRAM_TYPES lists exactly the CLI's six types", () => {
  assert.deepEqual([...DIAGRAM_TYPES], [
    "architecture", "workflow", "sequence", "dataflow", "lifecycle", "explainer-steps",
  ]);
});

await check("valid spec executes, registers the artifact, and serves as HTML", async () => {
  const server = await listen();
  try {
    const result = await executeDiagramTool(JSON.stringify({ title: "Test diagram", type: "architecture", spec }));
    assert.equal(result.ok, true, `expected ok:true, got: ${JSON.stringify({ ...result, diagnostics: undefined })}`);
    assert.ok(typeof result.diagramId === "string" && result.diagramId.length > 0, "diagramId must be present");
    assert.equal(result.title, "Test diagram");
    assert.equal(result.type, "architecture");

    const artifact = artifactRegistry.get(result.diagramId);
    assert.ok(artifact, "registry must hold the artifact under diagramId");
    assert.equal(artifact.title, "Test diagram");
    assert.equal(artifact.type, "architecture");
    assert.ok(typeof artifact.html === "string" && artifact.html.length > 0, "registry entry must hold the html");
    assert.match(artifact.html, /<!doctype html|<html/i, "artifact html must be a document");
    assert.match(artifact.hash, /^[0-9a-f]{64}$/, "registry entry must hold a sha256 hash of the artifact");

    const res = await fetch(`${baseUrl(server)}/api/artifacts/${result.diagramId}`);
    assert.equal(res.status, 200);
    assert.match(res.headers.get("content-type") ?? "", /text\/html/);
    assert.equal(res.headers.get("x-content-type-options"), "nosniff");
    assert.equal(res.headers.get("cache-control"), "no-store");
    const body = await res.text();
    assert.equal(body, artifact.html, "served body must be the registered html");
    assert.match(body, /<!doctype html|<html/i);
  } finally {
    server.close();
  }
});

await check("garbage args resolve ok:false instead of throwing", async () => {
  const result = await executeDiagramTool("not json");
  assert.equal(result.ok, false);
  assert.ok(typeof result.error === "string" && result.error.length > 0, "must report an error string");
});

await check("unknown diagram type resolves ok:false", async () => {
  const result = await executeDiagramTool(JSON.stringify({ title: "x", type: "nope", spec: {} }));
  assert.equal(result.ok, false);
  assert.ok(typeof result.error === "string" && result.error.length > 0);
});

await check("malformed args shapes resolve ok:false", async () => {
  for (const [label, args] of Object.entries({
    "missing title": { type: "architecture", spec },
    "empty title": { title: "   ", type: "architecture", spec },
    "non-string title": { title: 7, type: "architecture", spec },
    "missing spec": { title: "x", type: "architecture" },
    "spec not an object": { title: "x", type: "architecture", spec: "{}" },
    "args not an object": ["architecture"],
  })) {
    const result = await executeDiagramTool(JSON.stringify(args));
    assert.equal(result.ok, false, `${label}: expected ok:false, got ${JSON.stringify(result)}`);
    assert.ok(result.error, `${label}: must report an error string`);
  }
});

await check("a spec the CLI rejects resolves ok:false with parsed diagnostics", async () => {
  const result = await executeDiagramTool(JSON.stringify({ title: "Bad", type: "architecture", spec: { nope: true } }));
  assert.equal(result.ok, false);
  assert.match(result.error, /schema/i, `error should surface the CLI's message, got: ${JSON.stringify(result.error)}`);
  assert.ok(Array.isArray(result.diagnostics) && result.diagnostics.length > 0, "diagnostics must carry the receipt's list");
});

await check("unknown artifact id returns a JSON 404", async () => {
  const server = await listen();
  try {
    const res = await fetch(`${baseUrl(server)}/api/artifacts/does-not-exist`);
    assert.equal(res.status, 404);
    assert.match(res.headers.get("content-type") ?? "", /application\/json/);
    const body = await res.json();
    assert.ok(body.error, "404 body must be JSON with an error field");
  } finally {
    server.close();
  }
});

await check("traversal-shaped and slash-containing ids return a JSON 404 and read no file", async () => {
  const server = await listen();
  try {
    const base = baseUrl(server);
    const urls = [
      `${base}/api/artifacts/..%2F..%2Fpackage.json`,
      `${base}/api/artifacts/${encodeURIComponent("../../package.json")}`,
      `${base}/api/artifacts/abc/def`,
      `${base}/api/artifacts/back\\slash`,
      `${base}/api/artifacts/`,
    ];
    const packageJson = readFileSync(new URL("../package.json", import.meta.url), "utf8");
    for (const url of urls) {
      const res = await fetch(url);
      assert.equal(res.status, 404, `expected 404 for ${url}`);
      assert.match(res.headers.get("content-type") ?? "", /application\/json/, `${url} must be a JSON 404`);
      const body = await res.json();
      assert.ok(body.error, `${url} must report an error`);
      assert.ok(!JSON.stringify(body).includes("diagram-tool"), `${url} must not leak file content`);
    }
    assert.ok(!packageJson.includes("artifactRegistry"), "sanity: package.json is a real file a fs-backed route could leak");
  } finally {
    server.close();
  }
});

process.exit(failures ? 1 : 0);
