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

console.log(
  `test-library OK — ${builtIn.length} built-ins + 8 diagram components, root ${lib.root}, 3 family recipes parse clean`,
);
