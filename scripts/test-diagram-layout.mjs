// Layout math tests (pure TS, no React) — run via: npx tsx scripts/test-diagram-layout.mjs
import assert from "node:assert/strict";
import { layoutFlow, wrapLabel, pointsToPath } from "../src/library/diagrams/flow-layout";
import { layoutSequence } from "../src/library/diagrams/sequence-layout";

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

console.log("test-diagram-layout OK — flow + sequence");
