import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { generateSystemPrompt } from "@openuidev/lang-core";
import { diagramPromptBlock, diagramToolDeclaration, DIAGRAM_TYPES } from "../server/diagram-tool.mjs";

const repoRoot = fileURLToPath(new URL("..", import.meta.url));
const cli = path.join(repoRoot, "server/vendor/diagramify/bin/diagramify.mjs");
const failures = [];
function check(name, fn) {
  try { fn(); console.log(`${name}: PASS`); }
  catch (err) { failures.push(name); console.error(`${name}: FAIL — ${err.message}`); }
}
check("architecture_guidance_uses_real_placement", () => {
  assert.doesNotMatch(diagramPromptBlock, /["`]tier["`]/, "architecture prose must not advertise tier");
  assert.match(diagramPromptBlock, /pos/);
  assert.match(diagramPromptBlock, /layout\.mode.*grid/);
  assert.match(diagramPromptBlock, /row/);
  assert.match(diagramPromptBlock, /col/);
});
check("hybrid_prompt_preserves_inline", () => {
  assert.match(diagramPromptBlock, /inline.*precedence/i);
  assert.match(diagramPromptBlock, /inline labels.*inline code examples.*interactive/i);
  assert.doesNotMatch(diagramPromptBlock, /or asks for an architecture/);
});
check("generated_library_and_canonical_example", () => {
  const spec = JSON.parse(readFileSync(new URL("../generated/chat-library.spec.json", import.meta.url), "utf8"));
  const prompt = generateSystemPrompt({ library: spec.library, promptOptions: spec.promptOptions });
  for (const component of ["FlowDiagram", "SequenceDiagram", "StepExplainer"]) assert.ok(prompt.includes(component));
  assert.equal([...diagramPromptBlock.matchAll(/```json\n/g)].length, 1, "retain only one canonical JSON example");
  assert.deepEqual(diagramToolDeclaration.function.parameters.properties.type.enum, DIAGRAM_TYPES);
});

// Fresh fixtures authored from the basic contract, independent of showcase examples.
const base = (type) => ({ schema_version: 1, diagram_type: type, meta: { title: "Authoring check", quality_profile: "showcase" } });
const architecture = {
  ...base("architecture"),
  components: [
    { id: "client", type: "frontend", label: "Client", pos: [40, 200], size: [120, 60] },
    { id: "api", type: "backend", label: "API", pos: [300, 200], size: [120, 60] },
  ],
  connections: [{ from: "client", to: "api", label: "Request" }],
};
const grid = {
  ...base("architecture"), layout: { mode: "grid", cols: 2 },
  components: [
    { id: "client", type: "frontend", label: "Client", row: 0, col: 0 },
    { id: "api", type: "backend", label: "API", row: 0, col: 1 },
  ],
  connections: [{ from: "client", to: "api", label: "Request" }],
};
const fixtures = {
  architecture,
  workflow: {
    ...base("workflow"), lanes: [{ id: "team", label: "Team" }],
    nodes: [
      { id: "review", lane: "team", col: 0, type: "frontend", label: "Review" },
      { id: "ship", lane: "team", col: 1, type: "backend", label: "Ship" },
    ], edges: [{ from: "review", to: "ship" }],
  },
  sequence: {
    ...base("sequence"), participants: [{ id: "client", type: "frontend", label: "Client" }, { id: "api", type: "backend", label: "API" }],
    messages: [{ from: "client", to: "api", y: 180, label: "Request" }],
  },
  dataflow: {
    ...base("dataflow"), stages: [{ label: "Ingest" }, { label: "Store" }],
    nodes: [{ id: "input", type: "backend", label: "Input", stage: 0, row: 1 }, { id: "store", type: "database", label: "Store", stage: 1, row: 1 }],
    flows: [{ from: "input", to: "store", label: "Records" }],
  },
  lifecycle: {
    ...base("lifecycle"), lanes: [{ id: "main", label: "Phases" }],
    states: [{ id: "start", type: "start", label: "Start", lane: "main", col: 0 }, { id: "done", type: "success", label: "Done", lane: "main", col: 2 }],
    transitions: [{ from: "start", to: "done" }],
  },
  "explainer-steps": {
    ...base("explainer-steps"),
    steps: [{ id: "read", type: "start", label: "Read", code: { language: "js", content: "read();" } }, { id: "done", type: "success", label: "Done" }],
  },
};
const dir = mkdtempSync(path.join(tmpdir(), "diagram-prompt-test-"));
function validate(type, spec) {
  const specPath = path.join(dir, `${type}.json`);
  writeFileSync(specPath, JSON.stringify(spec));
  const result = spawnSync(process.execPath, [cli, "validate", type, specPath, "--quality", "showcase", "--json"], { cwd: repoRoot, encoding: "utf8" });
  assert.ifError(result.error);
  const receipt = JSON.parse(result.stdout);
  return { result, receipt };
}
function valid(type, spec) {
  const { result, receipt } = validate(type, spec);
  assert.equal(result.status, 0, JSON.stringify(receipt));
  assert.equal(receipt.ok, true, JSON.stringify(receipt));
}
try {
  for (const [type, spec] of Object.entries(fixtures)) check(`minimal_${type}_authoring`, () => valid(type, spec));
  check("architecture_grid_authoring", () => valid("architecture", grid));
  check("collection_minima_and_label_code_bounds", () => {
    const mutations = [
      ["architecture", (s) => { s.components = []; }],
      ["workflow", (s) => { s.lanes = []; }],
      ["sequence", (s) => { s.participants.pop(); }],
      ["sequence", (s) => { s.messages = []; }],
      ["dataflow", (s) => { s.stages.pop(); }],
      ["lifecycle", (s) => { s.states.pop(); }],
      ["explainer-steps", (s) => { s.steps.pop(); }],
      ["explainer-steps", (s) => { s.steps[0].label = "x".repeat(61); }],
      ["explainer-steps", (s) => { s.steps[0].code.content = "x".repeat(601); }],
      ["explainer-steps", (s) => { s.steps[0].code.language = "x".repeat(25); }],
    ];
    for (const [type, mutate] of mutations) {
      const spec = structuredClone(fixtures[type]); mutate(spec);
      assert.equal(validate(type, spec).receipt.ok, false, `${type} invalid bounds must fail`);
    }
    const nodeMinimumCases = [
      ["workflow", 1, (spec) => { spec.nodes = []; spec.edges = []; }],
      ["dataflow", 2, (spec) => { spec.nodes = [spec.nodes[0]]; spec.flows = []; }],
    ];
    for (const [type, minimum, makeUnderMinimum] of nodeMinimumCases) {
      const validSpec = structuredClone(fixtures[type]);
      valid(type, validSpec);
      const underMinimum = structuredClone(validSpec);
      makeUnderMinimum(underMinimum);
      const { result, receipt } = validate(type, underMinimum);
      assert.notEqual(result.status, 0, `${type} under-minimum nodes must fail`);
      assert.ok(receipt.diagnostics.some((diagnostic) =>
        diagnostic.code === "schema/minItems"
        && diagnostic.subject?.path === "/nodes"
        && diagnostic.evidence?.keyword === "minItems"
        && diagnostic.evidence?.limit === minimum
      ), `${type} must report its nodes minItems=${minimum} violation: ${JSON.stringify(receipt.diagnostics)}`);
    }
    const boundary = structuredClone(fixtures["explainer-steps"]);
    boundary.steps[0].label = "L".repeat(60);
    boundary.steps[0].code = { language: "j".repeat(24), content: "x".repeat(600) };
    valid("explainer-steps", boundary);
  });
} finally { rmSync(dir, { recursive: true, force: true }); }
if (failures.length) { console.error(`${failures.length} prompt contract check(s) failed`); process.exitCode = 1; }
else console.log("All diagram prompt contract checks pass");
