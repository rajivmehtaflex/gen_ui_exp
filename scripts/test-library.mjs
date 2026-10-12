// Library contract test — run via: npx tsx scripts/test-library.mjs
// Pins: root, all built-ins intact, diagram component names + EXACT signatures
// (positional order = the model contract), Diagrams group, parser gate per family.
import assert from "node:assert/strict";
import { createParser } from "@openuidev/lang-core";
import { openuiChatLibrary } from "@openuidev/react-ui";
import { appChatLibrary } from "../src/library/chat-library";

const lib = appChatLibrary;

// 1. Root + every built-in survives the extension.
assert.equal(lib.root, "Card", "root must stay Card");
const builtIn = Object.keys(openuiChatLibrary.components);
for (const name of builtIn) {
  assert.ok(lib.components[name], `built-in ${name} missing after extension`);
}

// 2. New components exist with exact signatures (T2 flow / T3 sequence / T4 explainer).
const expected = {
  FlowDiagram: 'FlowDiagram(nodes: FlowNode[], edges: FlowEdge[], direction?: "TB" | "LR")',
  FlowNode:
    'FlowNode(id: string, label: string, kind?: "process" | "start" | "end" | "decision" | "input" | "store")',
  FlowEdge: "FlowEdge(from: string, to: string, label?: string)",
  SequenceDiagram: "SequenceDiagram(participants: Participant[], messages: Message[])",
  Participant: "Participant(id: string, label: string)",
  Message: 'Message(from: string, to: string, label: string, kind?: "sync" | "async" | "return")',
  StepExplainer: "StepExplainer(steps: ExplainerStep[])",
  ExplainerStep: "ExplainerStep(title: string, body?: string, code?: string, note?: string)",
};
const spec = lib.toSpec();
for (const [name, sig] of Object.entries(expected)) {
  assert.ok(lib.components[name], `${name} not registered`);
  const got = spec.components?.[name]?.signature;
  assert.equal(got, sig, `${name} signature mismatch:\n  got:  ${got}\n  want: ${sig}`);
}

// 3. Total count: 84 built-ins + 8 diagram components.
assert.equal(
  Object.keys(lib.components).length,
  builtIn.length + 8,
  `expected ${builtIn.length + 8} components`,
);

// 4. Diagrams group lists exactly the 8, with notes.
const group = (lib.componentGroups ?? []).find((g) => g.name === "Diagrams");
assert.ok(group, "Diagrams componentGroup missing");
for (const name of Object.keys(expected)) {
  assert.ok(group.components.includes(name), `Diagrams group missing ${name}`);
}
assert.ok((group.notes ?? []).length >= 3, "Diagrams group should carry guidance notes");

// 5. Parser gate: one canonical recipe per family, 0 errors against the extended schema.
const parser = createParser(lib.toJSONSchema(), "Card");
const flow = `root = Card([header, flow])
header = CardHeader("Deploy pipeline", "push to main -> production")
flow = FlowDiagram([n1, n2, n3], [e1, e2], "TB")
n1 = FlowNode("push", "Push to main", "start")
n2 = FlowNode("ci", "CI tests")
n3 = FlowNode("prod", "Production", "end")
e1 = FlowEdge("push", "ci", "on merge")
e2 = FlowEdge("ci", "prod", "promote")`;
const sequence = `root = Card([header, seq])
header = CardHeader("Checkout lifecycle", "browser -> api -> data")
seq = SequenceDiagram([p1, p2, p3], [m1, m2, m3, m4])
p1 = Participant("browser", "Browser")
p2 = Participant("api", "Checkout API")
p3 = Participant("db", "Postgres")
m1 = Message("browser", "api", "POST /checkout", "sync")
m2 = Message("api", "db", "INSERT order", "sync")
m3 = Message("db", "api", "row id", "return")
m4 = Message("api", "browser", "201 created", "return")`;
const explainer = `root = Card([header, ex])
header = CardHeader("How HTTP caching works", "in four moves")
ex = StepExplainer([s1, s2, s3])
s1 = ExplainerStep("Request", "The browser checks its local cache first.", null, "Fresh means not yet past max-age.")
s2 = ExplainerStep("Revalidate", "If stale, it asks the server with If-None-Match.", "GET /logo.png\\nIf-None-Match: \\"abc123\\"")
s3 = ExplainerStep("Reuse", "Unchanged resources answer 304 and the cache keeps serving.")`;
for (const [family, recipe] of [["flow", flow], ["sequence", sequence], ["explainer", explainer]]) {
  const result = parser.parse(recipe);
  const errors = result.meta?.errors ?? [];
  assert.deepEqual(errors, [], `${family} recipe parse errors: ${JSON.stringify(errors)}`);
}

// 6. Array maxima are carried by the authoring JSON Schema. OpenUI's streaming
// parser resolves references and preserves parser diagnostics, but does not
// enforce JSON Schema maxItems while parsing, so render-time normalization is
// exercised separately by test-diagram-layout.mjs.
const flowRecipe = (nodeCount, edgeCount) => {
  const nodeRefs = Array.from({ length: nodeCount }, (_, i) => `n${i}`);
  const edgeRefs = Array.from({ length: edgeCount }, (_, i) => `e${i}`);
  const nodeDefs = nodeRefs.map((id, i) => `${id} = FlowNode("n${i}", "Node ${i}")`).join("\n");
  const edgeDefs = edgeRefs
    .map((id) => `${id} = FlowEdge("n0", "n1", "next")`)
    .join("\n");
  return `root = Card([diagram])\ndiagram = FlowDiagram([${nodeRefs.join(", ")}], [${edgeRefs.join(", ")}])\n${nodeDefs}\n${edgeDefs}`;
};
const sequenceRecipe = (participantCount, messageCount) => {
  const participantRefs = Array.from({ length: participantCount }, (_, i) => `p${i}`);
  const messageRefs = Array.from({ length: messageCount }, (_, i) => `m${i}`);
  const participantDefs = participantRefs
    .map((id, i) => `${id} = Participant("p${i}", "Participant ${i}")`)
    .join("\n");
  const messageDefs = messageRefs
    .map((id) => `${id} = Message("p0", "p1", "request")`)
    .join("\n");
  return `root = Card([diagram])\ndiagram = SequenceDiagram([${participantRefs.join(", ")}], [${messageRefs.join(", ")}])\n${participantDefs}\n${messageDefs}`;
};
const explainerRecipe = (stepCount) => {
  const refs = Array.from({ length: stepCount }, (_, i) => `s${i}`);
  const definitions = refs.map((id, i) => `${id} = ExplainerStep("Step ${i}")`).join("\n");
  return `root = Card([diagram])\ndiagram = StepExplainer([${refs.join(", ")}])\n${definitions}`;
};
const errorsFor = (recipe) => parser.parse(recipe).meta?.errors ?? [];
const authoringSchema = lib.toJSONSchema();
const maxItems = (component, prop) => authoringSchema.$defs?.[component]?.properties?.[prop]?.maxItems;
assert.equal(maxItems("FlowDiagram", "nodes"), 12, "flow schema caps nodes at 12 (13 is over bound)");
assert.equal(maxItems("FlowDiagram", "edges"), 24, "flow schema caps edges at 24 (25 is over bound)");
assert.equal(maxItems("SequenceDiagram", "participants"), 6, "sequence schema caps participants at 6 (7 is over bound)");
assert.equal(maxItems("SequenceDiagram", "messages"), 12, "sequence schema caps messages at 12 (13 is over bound)");
assert.equal(maxItems("StepExplainer", "steps"), 12, "explainer schema caps steps at 12 (13 is over bound)");
assert.deepEqual(errorsFor(flowRecipe(12, 24)), [], "12 flow nodes and 24 referenced edges retain parser behavior");
assert.deepEqual(errorsFor(sequenceRecipe(6, 12)), [], "6 participants and 12 messages retain parser behavior");
assert.deepEqual(errorsFor(explainerRecipe(12)), [], "12 ordered steps retain parser behavior");

// A partial OpenUI stream still reports parser diagnostics. Array bounds do not
// convert an incomplete referenced component into a successful parse.
const partial = parser.parse("root = Card([diagram])\ndiagram = FlowDiagram([n1]");
assert.ok(
  (partial.meta?.errors ?? []).some((error) => error.code === "missing-required" && error.path === "/edges"),
  "partial FlowDiagram reference should retain its missing-required parser diagnostic",
);

console.log(
  `test-library OK — ${builtIn.length} built-ins + 8 diagram components, 3 family recipes parse clean, bounded arrays and partial parser diagnostics hold`,
);
