// Tests for the diagram-tool core: executeDiagramTool (validate + deliver
// subprocess pipeline) and the artifact registry + GET endpoint. Plain node,
// no test framework, in-process express server on an ephemeral port.
// Run: node scripts/test-diagram-tool.mjs
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import express from "express";
import { createArtifactStore } from "../server/artifact-store.mjs";

const {
  executeDiagramTool,
  registerArtifactRoutes,
  artifactRegistry,
  DIAGRAM_TYPES,
  diagramToolDeclaration,
  diagramPromptBlock,
  accumulateToolCalls,
} = await import(
  "../server/diagram-tool.mjs"
);

// --- helper: an ephemeral-port express app with the artifact routes wired ----
async function listen(store) {
  const app = express();
  app.use(express.json());
  registerArtifactRoutes(app, store ? { store } : {});
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
    assert.equal(artifact.bytes, Buffer.byteLength(artifact.html, "utf8"), "registry records actual UTF-8 HTML bytes");
    assert.ok(Number.isFinite(artifact.createdAt), "registry records its insertion time");

    const res = await fetch(`${baseUrl(server)}/api/artifacts/${result.diagramId}`);
    assert.equal(res.status, 200);
    assert.match(res.headers.get("content-type") ?? "", /text\/html/);
    assert.equal(res.headers.get("x-content-type-options"), "nosniff");
    assert.equal(res.headers.get("cache-control"), "no-store");
    assert.ok(res.headers.get("content-security-policy")?.includes("sandbox allow-scripts allow-downloads"));
    const body = await res.text();
    assert.equal(body, artifact.html, "served body must be the registered html");
    assert.match(body, /<!doctype html|<html/i);
  } finally {
    server.close();
  }
});

await check("expired_and_evicted_ids_return_404_while_live_entries_keep_security_headers", async () => {
  let now = 0;
  const store = createArtifactStore({
    maxEntries: 2,
    maxBytes: 100,
    ttlMs: 10,
    maxArtifactBytes: 100,
    now: () => now,
  });
  const put = (id, createdAt) => store.put(id, {
    title: id,
    type: "architecture",
    html: `<!doctype html><title>${id}</title>`,
    hash: `hash-${id}`,
    createdAt,
  });
  assert.equal(put("evicted", 0).ok, true);
  now = 1;
  assert.equal(put("expired", 1).ok, true);
  now = 2;
  assert.equal(put("live", 2).ok, true);

  const beforeExpiryServer = await listen(store);
  try {
    const evicted = await fetch(`${baseUrl(beforeExpiryServer)}/api/artifacts/evicted`);
    assert.equal(evicted.status, 404, "count-evicted ids return 404 before their TTL expires");
  } finally {
    beforeExpiryServer.close();
  }

  now = 11;

  const server = await listen(store);
  try {
    const base = baseUrl(server);
    for (const id of ["evicted", "expired"]) {
      const missing = await fetch(`${base}/api/artifacts/${id}`);
      assert.equal(missing.status, 404, `${id} must not be served`);
      assert.match(missing.headers.get("content-type") ?? "", /application\/json/);
    }
    const response = await fetch(`${base}/api/artifacts/live`);
    assert.equal(response.status, 200);
    assert.equal(response.headers.get("x-content-type-options"), "nosniff");
    assert.equal(response.headers.get("cache-control"), "no-store");
    assert.match(response.headers.get("content-security-policy") ?? "", /sandbox allow-scripts allow-downloads/);
    assert.equal(await response.text(), "<!doctype html><title>live</title>");
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
    "args are null": null,
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

await check("diagramToolDeclaration specifies create_diagram with the 6 types", () => {
  assert.equal(diagramToolDeclaration.type, "function");
  assert.equal(diagramToolDeclaration.function?.name, "create_diagram");
  const params = diagramToolDeclaration.function?.parameters;
  assert.equal(params?.type, "object");
  assert.deepEqual([...params.properties?.type?.enum], [
    "architecture", "workflow", "sequence", "dataflow", "lifecycle", "explainer-steps",
  ]);
  assert.ok(params.required?.includes("title"));
  assert.ok(params.required?.includes("type"));
  assert.ok(params.required?.includes("spec"));
});

await check("diagramPromptBlock contains authoring guidance and inlined example", () => {
  assert.ok(typeof diagramPromptBlock === "string" && diagramPromptBlock.length > 0);
  assert.ok(diagramPromptBlock.includes("create_diagram"));
  for (const t of DIAGRAM_TYPES) {
    assert.ok(diagramPromptBlock.includes(t), `prompt block must mention ${t}`);
  }
  assert.ok(diagramPromptBlock.includes("showcase"));
  assert.ok(diagramPromptBlock.includes("Diagram Artifact Pipeline"));
});

await check("accumulateToolCalls handles empty input, fragment merging, and parallel calls", () => {
  assert.deepEqual(accumulateToolCalls([]), []);
  assert.deepEqual(accumulateToolCalls(null), []);

  // Fragment split across 3 chunks:
  const chunk1 = [{ index: 0, id: "call_1", type: "function", function: { name: "create_diagram", arguments: '{"title":' } }];
  const chunk2 = [{ index: 0, function: { arguments: '"My Diagram",' } }];
  const chunk3 = [{ index: 0, function: { arguments: '"type":"architecture"}' } }];

  const merged = accumulateToolCalls([chunk1, chunk2, chunk3]);
  assert.equal(merged.length, 1);
  assert.equal(merged[0].id, "call_1");
  assert.equal(merged[0].name, "create_diagram");
  assert.equal(merged[0].arguments, '{"title":"My Diagram","type":"architecture"}');

  // Parallel calls: index 0 and 1
  const parallelCalls = accumulateToolCalls([
    [
      { index: 0, id: "c1", function: { name: "create_diagram", arguments: '{"t":"1"' } },
      { index: 1, id: "c2", function: { name: "create_diagram", arguments: '{"t":"2"' } },
    ],
    [
      { index: 0, function: { arguments: '}' } },
      { index: 1, function: { arguments: '}' } },
    ],
  ]);
  assert.equal(parallelCalls.length, 2);
  assert.equal(parallelCalls[0].id, "c1");
  assert.equal(parallelCalls[0].arguments, '{"t":"1"}');
  assert.equal(parallelCalls[1].id, "c2");
  assert.equal(parallelCalls[1].arguments, '{"t":"2"}');
});

process.exit(failures ? 1 : 0);
