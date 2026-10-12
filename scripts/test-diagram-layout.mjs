// Layout math tests (pure TS, no React) — run via: npx tsx scripts/test-diagram-layout.mjs
import assert from "node:assert/strict";
import { layoutFlow, wrapLabel, pointsToPath } from "../src/library/diagrams/flow-layout";
import { layoutSequence } from "../src/library/diagrams/sequence-layout";
import { dedupeById } from "../src/library/diagrams/dedupe";

const limits = await import("../src/library/diagrams/limits").catch(() => null);
assert.ok(limits, "diagram limits module must provide render-time normalizers");
const { normalizeFlow, normalizeSequence, normalizeSteps } = limits;

// Duplicate ids (a model hallucination the parser cannot see) must be de-duped
// BEFORE layout — keeping the first occurrence and reporting the count — so the
// view can show a note instead of the layout throwing into a silent error
// boundary (review finding I2).
{
  const { kept, duplicates } = dedupeById([{ id: "a" }, { id: "b" }, { id: "a" }, { id: "a" }]);
  assert.deepEqual(kept.map((n) => n.id), ["a", "b"], "first occurrence wins, order preserved");
  assert.equal(duplicates, 2, "duplicate count reported");
}
assert.deepEqual(dedupeById([]), { kept: [], duplicates: 0 });
const single = dedupeById([{ id: "x", label: "X" }]);
assert.equal(single.kept.length, 1);
assert.equal(single.duplicates, 0);

// ---------- Flow ----------
const nodes = [
  { id: "push", label: "Push to main" },
  { id: "ci", label: "CI tests" },
  { id: "review", label: "Review OK?" },
  { id: "staging", label: "Staging" },
  { id: "prod", label: "Production" },
];
const edges = [
  { from: "push", to: "ci", label: "on merge" },
  { from: "ci", to: "review", label: "green" },
  { from: "review", to: "staging", label: "yes" },
  { from: "review", to: "ci", label: "fix requested" },
  { from: "staging", to: "prod", label: "promote" },
];

const tb = layoutFlow(nodes, edges, "TB");
for (const n of tb.nodes) {
  for (const v of [n.x, n.y, n.width, n.height]) {
    assert.ok(Number.isFinite(v), `non-finite value in node ${n.id}`);
  }
  assert.ok(n.x - n.width / 2 >= -0.5 && n.x + n.width / 2 <= tb.width + 0.5, `node ${n.id} out of x bounds`);
  assert.ok(n.y - n.height / 2 >= -0.5 && n.y + n.height / 2 <= tb.height + 0.5, `node ${n.id} out of y bounds`);
}
assert.equal(tb.edges.length, edges.length, "every edge should get a route");
for (const e of tb.edges) {
  assert.ok(e.points.length >= 2, "edge route needs >= 2 points");
  for (const p of e.points) assert.ok(Number.isFinite(p.x) && Number.isFinite(p.y), "edge point NaN");
  assert.ok(Number.isFinite(e.labelX) && Number.isFinite(e.labelY), "edge label position NaN");
}
const tbById = Object.fromEntries(tb.nodes.map((n) => [n.id, n]));
// Ordering is asserted on the DAG subset only — the fixture contains a deliberate
// back edge (review -> ci) that dagre legitimately ranks by breaking the cycle.
const dagEdges = edges.filter((e) => !(e.from === "review" && e.to === "ci"));
for (const e of dagEdges) {
  assert.ok(tbById[e.to].y >= tbById[e.from].y - 1, `TB ordering violated: ${e.from}->${e.to}`);
}
const lr = layoutFlow(nodes, edges, "LR");
const lrById = Object.fromEntries(lr.nodes.map((n) => [n.id, n]));
for (const e of dagEdges) {
  assert.ok(lrById[e.to].x >= lrById[e.from].x - 1, `LR ordering violated: ${e.from}->${e.to}`);
}
assert.deepEqual(layoutFlow(nodes, edges, "TB"), tb, "layout must be deterministic");

// Dangling edge: dropped (not crashed, no NaN) and reported.
const dangling = layoutFlow(nodes, [...edges, { from: "ci", to: "ghost" }], "TB");
assert.equal(dangling.edges.length, edges.length, "dangling edge must be dropped");
assert.equal(dangling.dropped.length, 1, "dangling edge must be reported in dropped[]");

// The self-edge rule also holds in the pure layout helper and remains visible
// through its existing dropped diagnostics.
const selfEdge = layoutFlow([{ id: "only", label: "Only" }], [{ from: "only", to: "only" }]);
assert.equal(selfEdge.edges.length, 0, "flow self-edge must not be laid out");
assert.deepEqual(selfEdge.dropped, [{ from: "only", to: "only" }], "flow self-edge must be reported");

// Duplicate id: authoring bug, throws.
assert.throws(() => layoutFlow([...nodes, nodes[0]], edges, "TB"), /[Dd]uplicate/);

// Degenerate sizes stay finite.
assert.ok(Number.isFinite(layoutFlow([], [], "TB").height), "empty graph needs finite height");
const one = layoutFlow([nodes[0]], [], "TB");
assert.ok(Number.isFinite(one.width) && Number.isFinite(one.height), "1-node graph needs finite size");

// wrapLabel: short labels stay one line; long labels wrap to <=2 lines with ellipsis tail.
assert.deepEqual(wrapLabel("CI tests"), ["CI tests"]);
const longLines = wrapLabel("a".repeat(60));
assert.ok(longLines.length >= 2 && longLines.length <= 2, "long labels wrap to 2 lines");
assert.ok(longLines[longLines.length - 1].endsWith("…"), "truncated tail ends with ellipsis");

// pointsToPath: straight segments through the points.
assert.equal(pointsToPath([{ x: 0, y: 0 }, { x: 10, y: 0 }]), "M 0 0 L 10 0");

// ---------- Sequence ----------
const participants = [
  { id: "browser", label: "Browser" },
  { id: "api", label: "Checkout API" },
  { id: "db", label: "Postgres" },
];
const messages = [
  { from: "browser", to: "api", label: "POST /checkout", kind: "sync" },
  { from: "api", to: "db", label: "INSERT order", kind: "sync" },
  { from: "db", to: "api", label: "row id", kind: "return" },
  { from: "api", to: "api", label: "validate", kind: "sync" },
  { from: "api", to: "browser", label: "201 created", kind: "return" },
];
const seq = layoutSequence(participants, messages);
assert.equal(seq.lanes.length, 3, "one lane per participant");
for (let i = 1; i < seq.lanes.length; i++) {
  assert.ok(seq.lanes[i].x > seq.lanes[i - 1].x, "lanes must be strictly increasing in x");
}
assert.equal(seq.arrows.length, messages.length, "every message gets an arrow");
for (let i = 1; i < seq.arrows.length; i++) {
  assert.ok(seq.arrows[i].y > seq.arrows[i - 1].y, "message rows must increase in time order");
}
for (const a of seq.arrows) {
  assert.ok(Number.isFinite(a.x1) && Number.isFinite(a.x2) && Number.isFinite(a.y), "arrow NaN");
  if (a.selfLoop) continue; // zero span by definition — label sits above the loop
  const lo = Math.min(a.x1, a.x2), hi = Math.max(a.x1, a.x2);
  assert.ok(
    (a.labelX - a.labelHalfWidth >= lo - 1 && a.labelX + a.labelHalfWidth <= hi + 1) || a.truncated,
    "label must fit its span or be flagged truncated",
  );
}
const selfLoop = seq.arrows.find((a) => a.selfLoop);
assert.ok(selfLoop, "self-message must be flagged");
// Dangling participant reference: dropped + reported, no crash.
const dangly = layoutSequence(participants, [...messages, { from: "api", to: "ghost", label: "x", kind: "sync" }]);
assert.equal(dangly.arrows.length, messages.length);
assert.equal(dangly.dropped.length, 1);
assert.throws(() => layoutSequence([participants[0], participants[0]], messages), /[Dd]uplicate/);
// Degenerate: single participant, no messages — finite.
const tiny = layoutSequence([participants[0]], []);
assert.ok(Number.isFinite(tiny.width) && Number.isFinite(tiny.height));

// A last-lane self-loop keeps the entire path and the full 120-character label
// inside the SVG viewBox. The renderer can show a short visual label plus a
// full-label alternative, but layout must account for the latter's extent.
const longLoopLabel = "self loop " + "x".repeat(110);
const lastLaneLoop = layoutSequence(
  [{ id: "solo", label: "Solo" }],
  [{ from: "solo", to: "solo", label: longLoopLabel }],
);
const longLoop = lastLaneLoop.arrows[0];
assert.equal(longLoop.from, "solo");
assert.equal(longLoop.to, "solo");
assert.equal(longLoop.fullLabel, longLoopLabel);
assert.ok(longLoop.bounds.left >= 0 && longLoop.bounds.right <= lastLaneLoop.width, "self-loop path and label must fit horizontally");
assert.ok(longLoop.bounds.top >= 0 && longLoop.bounds.bottom <= lastLaneLoop.height, "self-loop path and label must fit vertically");

// Render-time normalization is deterministic at each schema boundary and safe
// for partial OpenUI arrays. Dedupe happens before the cap; links are checked
// against the retained IDs after the cap.
const makeFlowNodes = (count) =>
  Array.from({ length: count }, (_, i) => ({ id: `n${i}`, label: `Node ${i}` }));
const makeFlowEdges = (count) =>
  Array.from({ length: count }, () => ({ from: "n0", to: "n1", label: "next" }));
for (const count of [12, 13]) {
  const result = normalizeFlow(makeFlowNodes(count), []);
  assert.equal(result.nodes.length, Math.min(count, 12), `${count} flow nodes normalize to at most 12`);
  assert.equal(result.omittedNodes, Math.max(0, count - 12), `${count} flow nodes report omissions`);
}
for (const count of [24, 25]) {
  const result = normalizeFlow(makeFlowNodes(12), makeFlowEdges(count));
  assert.equal(result.edges.length, Math.min(count, 24), `${count} flow edges normalize to at most 24`);
  assert.equal(result.omittedEdges, Math.max(0, count - 24), `${count} flow edges report omissions`);
}
const normalizedFlow = normalizeFlow(
  [...makeFlowNodes(12), { id: "n0", label: "Duplicate" }, { id: "n12", label: "Over limit" }],
  [
    { from: "n0", to: "n0", label: "self" },
    { from: "n0", to: "missing", label: "dangling" },
    { from: "n0", to: "n1", label: "kept" },
  ],
);
assert.equal(normalizedFlow.nodes.length, 12, "dedupe then cap flow nodes");
assert.equal(normalizedFlow.omittedNodes, 2, "duplicate and over-limit nodes are counted");
assert.deepEqual(normalizedFlow.edges.map((edge) => edge.label), ["kept"], "only retained-node relationships survive");
assert.equal(normalizedFlow.selfEdges, 1, "flow self-edges are counted");
assert.equal(normalizedFlow.omittedEdges, 2, "self and dangling edges are counted");
const partialFlow = normalizeFlow([null, {}, { id: "ok", label: "OK" }], [null, { from: "", to: "ok" }]);
assert.equal(partialFlow.nodes.length, 1, "partial flow nodes do not crash normalization");
assert.equal(partialFlow.omittedNodes, 2, "partial flow nodes are counted as omitted");
assert.equal(partialFlow.omittedEdges, 2, "partial flow edges are counted as omitted");

const makeParticipants = (count) =>
  Array.from({ length: count }, (_, i) => ({ id: `p${i}`, label: `Participant ${i}` }));
const makeMessages = (count) =>
  Array.from({ length: count }, () => ({ from: "p0", to: "p1", label: "request" }));
for (const count of [6, 7]) {
  const result = normalizeSequence(makeParticipants(count), []);
  assert.equal(result.participants.length, Math.min(count, 6), `${count} sequence participants normalize to at most 6`);
  assert.equal(result.omittedParticipants, Math.max(0, count - 6), `${count} participants report omissions`);
}
for (const count of [12, 13]) {
  const result = normalizeSequence(makeParticipants(6), makeMessages(count));
  assert.equal(result.messages.length, Math.min(count, 12), `${count} messages normalize to at most 12`);
  assert.equal(result.omittedMessages, Math.max(0, count - 12), `${count} messages report omissions`);
}
const partialSequence = normalizeSequence(
  [null, { id: "p0", label: "P0" }],
  [null, { from: "p0", to: "ghost", label: "dangling" }, { from: "p0", to: "p0" }],
);
assert.equal(partialSequence.participants.length, 1, "partial sequence participants do not crash normalization");
assert.equal(partialSequence.omittedParticipants, 1, "partial sequence participants are counted");
assert.equal(partialSequence.messages.length, 0, "unknown sequence endpoints are omitted");
assert.equal(partialSequence.omittedMessages, 3, "partial, unlabeled and dangling sequence messages are counted");

for (const count of [12, 13]) {
  const result = normalizeSteps(Array.from({ length: count }, (_, i) => ({ title: `Step ${i}` })));
  assert.equal(result.steps.length, Math.min(count, 12), `${count} steps normalize to at most 12`);
  assert.equal(result.omittedSteps, Math.max(0, count - 12), `${count} steps report omissions`);
}
const partialSteps = normalizeSteps([null, {}, { title: "Visible" }]);
assert.deepEqual(partialSteps.steps, [{ title: "Visible" }], "partial explainer steps are filtered safely");
assert.equal(partialSteps.omittedSteps, 2, "partial explainer steps are counted");

console.log("test-diagram-layout OK — bounded flow, sequence and explainer normalization plus geometry");
