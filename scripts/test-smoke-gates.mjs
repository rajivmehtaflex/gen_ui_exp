// Tests for the smoke and render gate contracts: what a diagram run, a text
// run, a rendered recipe, and the prompt example set must prove before any
// script may call them a pass. Pure fixtures — no server, no provider, no I/O.
// Run: node scripts/test-smoke-gates.mjs
import assert from "node:assert/strict";
import { createHash } from "node:crypto";

const contract = await import("./diagram-smoke-contract.mjs").catch((error) => ({ __importError: error }));
const {
  DONE,
  verifyDiagramRun,
  successfulDiagramResult,
  verifyTextRun,
  verifyRenderedRecipe,
  verifyExampleCoverage,
  parsedComponentNames,
} = contract;

let failures = 0;
async function check(name, fn) {
  try {
    await fn();
    console.log(`PASS  ${name}`);
  } catch (error) {
    failures++;
    console.error(`FAIL  ${name}\n      ${error.message}`);
  }
}

// --- SSE fixtures: the shapes server/chat.mjs actually puts on the wire ------
const chunk = (delta, finishReason = null) => ({
  choices: [{ index: 0, delta, finish_reason: finishReason }],
});
const toolCallEvents = (id, args = "{}") => [
  chunk({
    role: "assistant",
    tool_calls: [{ index: 0, id, type: "function", function: { name: "create_diagram", arguments: args } }],
  }),
  chunk({}, "tool_calls"),
];
const toolResultEvent = (toolCallId, result) => [
  chunk({ role: "tool", tool_call_id: toolCallId, content: JSON.stringify(result) }),
];
const assistantTextEvents = (text) => [chunk({ role: "assistant", content: text }), chunk({}, "stop")];

const sha256 = (text) => createHash("sha256").update(text, "utf8").digest("hex");
const HTML = "<!doctype html><html><body>delivered diagram</body></html>";
const receipt = (html, overrides = {}) => ({
  ok: true,
  diagramId: "diag-1",
  title: "Deploy Pipeline",
  type: "architecture",
  sha256: sha256(html),
  bytes: Buffer.byteLength(html, "utf8"),
  ...overrides,
});
const artifactResponse = (body, overrides = {}) => ({
  status: 200,
  headers: {
    "content-type": "text/html; charset=utf-8",
    "x-content-type-options": "nosniff",
    "cache-control": "no-store",
    ...overrides.headers,
  },
  body,
  ...overrides.rest,
});
const happyRun = (html = HTML) => [
  ...toolCallEvents("call_1"),
  ...toolResultEvent("call_1", receipt(html)),
  ...assistantTextEvents("Created the diagram."),
  DONE,
];

function has(errors, pattern, label) {
  assert.ok(errors.some((error) => pattern.test(error)), `${label} must report ${pattern}: ${JSON.stringify(errors)}`);
}

await check("contract module loads with the required exports", () => {
  const error = contract.__importError;
  assert.ok(!error, `diagram-smoke-contract.mjs must load: ${error?.message ?? "ok"}`);
  for (const name of ["verifyDiagramRun", "successfulDiagramResult", "verifyTextRun",
    "verifyRenderedRecipe", "verifyExampleCoverage", "parsedComponentNames"]) {
    assert.equal(typeof contract[name], "function", `export ${name} must exist`);
  }
  assert.equal(contract.DONE, "[DONE]", "DONE must be the terminal SSE sentinel string");
});

await check("valid_diagram_run_passes", () => {
  const verdict = verifyDiagramRun({ events: happyRun(), artifactResponse: artifactResponse(HTML) });
  assert.deepEqual(verdict, { ok: true, errors: [] }, `a complete honest run must pass: ${JSON.stringify(verdict.errors)}`);
});

await check("wrong_digest_fails", () => {
  // Same byte length, different bytes: only the digest may complain.
  const other = "<!doctype html><html><body>DELIVERED diagram</body></html>";
  assert.equal(Buffer.byteLength(other, "utf8"), Buffer.byteLength(HTML, "utf8"), "fixture: byte lengths must match");
  const verdict = verifyDiagramRun({ events: happyRun(), artifactResponse: artifactResponse(other) });
  assert.equal(verdict.ok, false);
  has(verdict.errors, /sha-?256|digest/i, "a swapped body must fail its digest");
  assert.ok(!verdict.errors.some((error) => /byte/i.test(error)), `byte count must still agree: ${JSON.stringify(verdict.errors)}`);
});

await check("wrong_bytes_fails", () => {
  const verdict = verifyDiagramRun({ events: happyRun(), artifactResponse: artifactResponse(`${HTML}!`) });
  assert.equal(verdict.ok, false);
  has(verdict.errors, /byte/i, "an extra byte must fail the byte count");
  has(verdict.errors, /sha-?256|digest/i, "changed bytes must also fail the digest");
});

await check("unrelated_tool_fails", () => {
  const events = [
    ...toolCallEvents("call_1"),
    ...toolResultEvent("call_unrelated", receipt(HTML)),
    ...assistantTextEvents("Created the diagram."),
    DONE,
  ];
  const verdict = verifyDiagramRun({ events, artifactResponse: artifactResponse(HTML) });
  assert.equal(verdict.ok, false);
  has(verdict.errors, /correlat|unrelated|no create_diagram/i, "a result for an undeclared call id must fail correlation");
});

await check("failed_result_fails", () => {
  const events = [
    ...toolCallEvents("call_1"),
    ...toolResultEvent("call_1", { ok: false, error: "schema: nope", diagnostics: [] }),
    ...assistantTextEvents("I couldn't produce a valid diagram - schema: nope."),
    DONE,
  ];
  const verdict = verifyDiagramRun({ events, artifactResponse: null });
  assert.equal(verdict.ok, false);
  has(verdict.errors, /no successful create_diagram/i, "a failed result must be reported as a failed run");
  assert.ok(!verdict.errors.some((error) => /\[DONE\]/.test(error)), `a settled failure must still read its [DONE]: ${JSON.stringify(verdict.errors)}`);
});

await check("refused_result_frame_settles_as_one_honest_failure", () => {
  // T9's writer refuses a single frame beyond the pending budget, so a tool
  // result that never fit never reached the client: the loop settles the run
  // with a visible diagnostic and a stop. That path is a legitimate
  // failing-diagram outcome — the gate must read it as exactly that.
  const events = [
    ...toolCallEvents("call_big"),
    ...assistantTextEvents("I stopped this response because one piece of it was too large to deliver. Ask again to continue."),
    DONE,
  ];
  const verdict = verifyDiagramRun({ events, artifactResponse: null });
  assert.equal(verdict.ok, false);
  assert.deepEqual(
    verdict.errors,
    ["no successful create_diagram result — the diagram failed"],
    `the settled path must read as one honest failure, not stream noise: ${JSON.stringify(verdict.errors)}`,
  );
});

await check("missing_done_fails", () => {
  const events = happyRun().filter((event) => event !== DONE);
  const verdict = verifyDiagramRun({ events, artifactResponse: artifactResponse(HTML) });
  assert.equal(verdict.ok, false);
  has(verdict.errors, /\[DONE\]/, "a stream that never ended must be reported");
  const empty = verifyDiagramRun({ events: [], artifactResponse: null });
  assert.equal(empty.ok, false);
  has(empty.errors, /no sse events|empty/i, "an empty stream must be reported");
});

await check("valid_retry_then_success_passes", () => {
  const events = [
    ...toolCallEvents("call_1"),
    ...toolResultEvent("call_1", { ok: false, error: "schema: nope", diagnostics: [] }),
    ...toolCallEvents("call_2"),
    ...toolResultEvent("call_2", receipt(HTML)),
    ...assistantTextEvents("Created the diagram."),
    DONE,
  ];
  const verdict = verifyDiagramRun({ events, artifactResponse: artifactResponse(HTML) });
  assert.deepEqual(verdict, { ok: true, errors: [] }, `a failed attempt before a correlated success must pass: ${JSON.stringify(verdict.errors)}`);
});

await check("parse_errors_with_svg_fail", () => {
  const verdict = verifyRenderedRecipe({
    text: "root = NotARealComponent([])",
    parseErrors: [{ message: "unknown component NotARealComponent" }],
    renderedHtml: "<div><svg>residual markup from a partial render</svg></div>",
    expectedFamily: "FlowDiagram",
    completed: true,
  });
  assert.equal(verdict.ok, false, "svg markup must not rescue a recipe that does not parse");
  has(verdict.errors, /parse error/i, "parse errors must be the reported failure");
});

await check("group_name_without_example_fails", () => {
  const verdict = verifyExampleCoverage({
    examples: [{ errors: [], components: ["Card", "CardHeader"] }],
    requiredComponents: ["SequenceDiagram", "Message"],
    minExamples: 1,
  });
  assert.equal(verdict.ok, false, "a listed group component no example instantiates must fail coverage");
  has(verdict.errors, /SequenceDiagram/, "the missing component must be named");
  has(verdict.errors, /Message/, "every missing component must be named");
});

await check("ambiguous_double_success_fails", () => {
  const events = [
    ...toolCallEvents("call_1"),
    ...toolResultEvent("call_1", receipt(HTML, { diagramId: "diag-1" })),
    ...toolCallEvents("call_2"),
    ...toolResultEvent("call_2", receipt(HTML, { diagramId: "diag-2" })),
    DONE,
  ];
  const verdict = verifyDiagramRun({ events, artifactResponse: artifactResponse(HTML) });
  assert.equal(verdict.ok, false);
  has(verdict.errors, /more than one successful|ambiguous/i, "two successes cannot be told apart");
});

await check("incomplete_receipts_fail", () => {
  const cases = [
    ["missing sha256", { sha256: undefined }, /sha-?256/i],
    ["short sha256", { sha256: "abcd" }, /sha-?256/i],
    ["non-hex sha256", { sha256: "z".repeat(64) }, /sha-?256/i],
    ["missing bytes", { bytes: undefined }, /bytes/i],
    ["fractional bytes", { bytes: 12.5 }, /bytes/i],
    ["zero bytes", { bytes: 0 }, /bytes/i],
    ["empty diagramId", { diagramId: "" }, /diagramId/i],
    ["unknown type", { type: "blueprint" }, /type/i],
    ["missing title", { title: "" }, /title/i],
  ];
  for (const [label, overrides, pattern] of cases) {
    const events = [
      ...toolCallEvents("call_1"),
      ...toolResultEvent("call_1", receipt(HTML, overrides)),
      DONE,
    ];
    const verdict = verifyDiagramRun({ events, artifactResponse: artifactResponse(HTML) });
    assert.equal(verdict.ok, false, `${label} must fail the receipt contract`);
    has(verdict.errors, pattern, `${label} must name its field`);
  }
});

await check("artifact_response_claims_are_asserted", () => {
  const base = { events: happyRun() };
  const cases = [
    ["non-200 status", artifactResponse(HTML, { rest: { status: 404 } }), /404|status/i],
    ["json content type", artifactResponse(HTML, { headers: { "content-type": "application/json" } }), /content-type/i],
    ["missing charset", artifactResponse(HTML, { headers: { "content-type": "text/html" } }), /charset|utf-8/i],
    ["missing nosniff", artifactResponse(HTML, { headers: { "x-content-type-options": "" } }), /nosniff/i],
    ["missing no-store", artifactResponse(HTML, { headers: { "cache-control": "public" } }), /no-store/i],
    ["empty body", artifactResponse(""), /empty/i],
    ["missing response", null, /artifact response/i],
  ];
  for (const [label, artifact, pattern] of cases) {
    const verdict = verifyDiagramRun({ events: base.events, artifactResponse: artifact });
    assert.equal(verdict.ok, false, `${label} must fail`);
    has(verdict.errors, pattern, `${label} must be reported`);
  }
});

await check("successfulDiagramResult_extracts_the_single_correlated_success", () => {
  assert.equal(successfulDiagramResult(happyRun())?.diagramId, "diag-1");
  assert.equal(successfulDiagramResult([]), null, "an empty stream has no success");
  const failed = [...toolCallEvents("call_1"), ...toolResultEvent("call_1", { ok: false, error: "x", diagnostics: [] }), DONE];
  assert.equal(successfulDiagramResult(failed), null, "a failed result is not a success");
  const retried = [
    ...toolCallEvents("call_1"),
    ...toolResultEvent("call_1", { ok: false, error: "x", diagnostics: [] }),
    ...toolCallEvents("call_2"),
    ...toolResultEvent("call_2", receipt(HTML, { diagramId: "diag-9" })),
    DONE,
  ];
  assert.equal(successfulDiagramResult(retried)?.diagramId, "diag-9", "the later correlated retry is the success");
});

await check("text_run_requires_done_nonblank_parse_clean_card", () => {
  const text = 'root = Card([header])\nheader = CardHeader("Q4", "numbers")';
  const good = verifyTextRun({ text, events: [chunk({ role: "assistant", content: text }), chunk({}, "stop"), DONE], parseErrors: [], root: { typeName: "Card", props: { children: [{ typeName: "CardHeader" }] } } });
  assert.deepEqual(good, { ok: true, errors: [] }, `an honest text run passes: ${JSON.stringify(good.errors)}`);

  const noDone = verifyTextRun({ text, events: [chunk({ role: "assistant", content: text })], parseErrors: [], root: { typeName: "Card", props: { children: [] } } });
  assert.equal(noDone.ok, false);
  has(noDone.errors, /\[DONE\]/, "a text run without [DONE] is incomplete");

  const serverError = verifyTextRun({ text: "", events: [chunk({ role: "assistant", content: "" }), { error: { message: "upstream failed" } }, DONE], parseErrors: [], root: null });
  assert.equal(serverError.ok, false);
  has(serverError.errors, /upstream failed/, "a terminal error event must be reported");

  const blank = verifyTextRun({ text: "   ", events: [DONE], parseErrors: [], root: null });
  assert.equal(blank.ok, false);
  has(blank.errors, /blank/i, "a blank reply must fail");

  const broken = verifyTextRun({ text: "root = Nope()", events: [DONE], parseErrors: [{ message: "unknown" }], root: null });
  assert.equal(broken.ok, false);
  has(broken.errors, /parse error/i, "parser errors must fail the text gate");

  const notACard = verifyTextRun({ text, events: [DONE], parseErrors: [], root: { typeName: "TextContent", props: {} } });
  assert.equal(notACard.ok, false);
  has(notACard.errors, /Card/i, "the root component must be a Card");

  const emptyCard = verifyTextRun({ text, events: [DONE], parseErrors: [], root: { typeName: "Card", props: {} } });
  assert.equal(emptyCard.ok, false);
  has(emptyCard.errors, /no content|empty/i, "a Card without children is blank output");
});

await check("render_gate_requires_clean_parse_and_expected_family_markup", () => {
  const flowHtml = '<div class="gx-diagram"><svg aria-labelledby="fd-arrow-r1-title"><defs><marker id="fd-arrow-r1"/></defs></svg></div>';
  const clean = { text: "root = Card([flow])", parseErrors: [], renderedHtml: flowHtml, expectedFamily: "FlowDiagram", completed: true };
  assert.deepEqual(verifyRenderedRecipe(clean), { ok: true, errors: [] }, "a clean flow render passes");

  const noFamily = verifyRenderedRecipe({ ...clean, renderedHtml: "<div>just text, no diagram</div>" });
  assert.equal(noFamily.ok, false);
  has(noFamily.errors, /FlowDiagram|markup/i, "a render without the family markup must fail");

  const wrongFamily = verifyRenderedRecipe({ ...clean, expectedFamily: "SequenceDiagram" });
  assert.equal(wrongFamily.ok, false, "flow markup must not count as sequence markup");

  const explainer = verifyRenderedRecipe({
    text: "root = Card([ex])",
    parseErrors: [],
    renderedHtml: '<div class="gx-steps"><ol aria-label="Ordered concept walkthrough"><li>one</li></ol></div>',
    expectedFamily: "StepExplainer",
    completed: true,
  });
  assert.deepEqual(explainer, { ok: true, errors: [] }, "a family without svg is proved by its own markup");

  const blankText = verifyRenderedRecipe({ ...clean, text: "" });
  assert.equal(blankText.ok, false);
  has(blankText.errors, /blank/i, "nothing streamed is not a render");

  const unknownFamily = verifyRenderedRecipe({ ...clean, expectedFamily: "MindMap" });
  assert.equal(unknownFamily.ok, false);
  has(unknownFamily.errors, /known family|unsupported/i, "an unknown family name must be refused, never vacuously pass");

  const incomplete = verifyRenderedRecipe({ ...clean, completed: false });
  assert.equal(incomplete.ok, false);
  has(incomplete.errors, /\[DONE\]/, "markup from an unfinished stream must not pass");
  const assumed = verifyRenderedRecipe({ ...clean, completed: undefined });
  assert.equal(assumed.ok, false, "completion must be proved, never defaulted");
});

await check("example_coverage_requires_parsed_components_in_clean_examples", () => {
  const examples = [
    { errors: [], components: ["Card", "FlowDiagram", "FlowNode", "FlowEdge"] },
    { errors: [], components: ["Card", "SequenceDiagram", "Participant", "Message"] },
  ];
  const required = ["FlowDiagram", "FlowNode", "FlowEdge", "SequenceDiagram", "Participant", "Message"];
  const pass = verifyExampleCoverage({ examples, requiredComponents: required, minExamples: 2 });
  assert.deepEqual(pass, { ok: true, errors: [] }, `covered examples pass: ${JSON.stringify(pass.errors)}`);

  const unclean = verifyExampleCoverage({ examples: [{ errors: [{ message: "bad" }], components: required }], requiredComponents: required, minExamples: 1 });
  assert.equal(unclean.ok, false, "components from a broken example prove nothing");
  has(unclean.errors, /parse error|invalid/i, "the broken example must be reported");

  const tooFew = verifyExampleCoverage({ examples, requiredComponents: required, minExamples: 8 });
  assert.equal(tooFew.ok, false);
  has(tooFew.errors, /2 example|at least 8|minim/i, "the size floor must hold");
});

await check("parsedComponentNames_walks_the_parse_tree", () => {
  const tree = {
    typeName: "Card",
    props: {
      children: [
        { typeName: "CardHeader", props: { title: "T" } },
        { typeName: "FlowDiagram", props: { nodes: [{ typeName: "FlowNode", props: {} }], label: "fd-arrow-x" } },
      ],
    },
  };
  assert.deepEqual(
    parsedComponentNames(tree).sort(),
    ["Card", "CardHeader", "FlowDiagram", "FlowNode"].sort(),
  );
  assert.deepEqual(parsedComponentNames(null), [], "no tree, no components");
});

process.exit(failures ? 1 : 0);
