// Pure contracts behind the smoke and schema/render gates: what a diagram run,
// a text run, a rendered recipe, and the prompt example set must PROVE before
// any gate may call them a pass. No I/O of its own — the smoke scripts fetch
// and stream, then hand the raw evidence here, so every rule in this file is
// unit-testable against local fixtures (scripts/test-smoke-gates.mjs).
//
//   verifyDiagramRun          a chat SSE stream plus the artifact GET response
//                             must agree with the successful tool receipt:
//                             correlation by tool call id, result ok, complete
//                             receipt fields (sha256, bytes), and the fetched
//                             bytes re-hashing to the receipt digest
//   successfulDiagramResult   the one correlated ok:true receipt a stream carries
//   verifyTextRun             a text smoke run needs [DONE], nonblank output,
//                             a clean parse, and a nonempty Card as the root
//   verifyRenderedRecipe      a rendered recipe needs a clean parse AND the
//                             expected diagram family's own markup — svg alone
//                             proves nothing
//   verifyExampleCoverage     every diagram component the library advertises
//                             must be INSTANTIATED by some clean prompt example,
//                             not merely mentioned near one
//   parsedComponentNames      the components a parsed recipe actually builds
import { createHash } from "node:crypto";
import { DIAGRAM_TYPES } from "../server/diagram-policy.mjs";

// The SSE terminal sentinel, as the smoke scripts represent it in `events`:
// every element is either a parsed chat.completion.chunk object or this string.
export const DONE = "[DONE]";

// The prompt example floor: built-ins plus coverage of every diagram family.
export const MIN_EXAMPLES = 8;

const SHA256_PATTERN = /^[0-9a-f]{64}$/;

// What each client diagram family renders as its own markup (the components in
// src/library/diagrams/). A probe must be family-specific: "an svg appeared"
// is not evidence that the requested diagram did.
export const FAMILY_MARKUP = Object.freeze({
  FlowDiagram: Object.freeze({ svg: true, probe: /fd-arrow-/ }),
  SequenceDiagram: Object.freeze({ svg: true, probe: /sq-(?:title|filled|open)-/ }),
  StepExplainer: Object.freeze({ svg: false, probe: /gx-steps/ }),
});

const headerNames = (headers) => (typeof headers?.get === "function"
  ? (name) => headers.get(name)
  : (name) => {
    const row = Object.entries(headers ?? {}).find(([key]) => key.toLowerCase() === name);
    return row?.[1];
  });

// One pass over the stream, shared by both consumers: did it end, did the
// server report an error, which create_diagram calls were declared (by id),
// and what did each tool result say?
function readStream(events) {
  const sawDone = Array.isArray(events) && events.some((event) => event === DONE);
  const errorEvents = [];
  const createDiagramCallIds = new Set();
  const results = [];

  for (const event of Array.isArray(events) ? events : []) {
    if (event === DONE || event === null || typeof event !== "object") continue;
    if (event.error !== undefined && event.error !== null) {
      errorEvents.push(typeof event.error?.message === "string" ? event.error.message : JSON.stringify(event.error));
      continue;
    }
    const delta = event.choices?.[0]?.delta;
    if (!delta || typeof delta !== "object") continue;
    for (const call of Array.isArray(delta.tool_calls) ? delta.tool_calls : []) {
      if (typeof call?.id !== "string" || call.id.length === 0) continue;
      if (call.function?.name === "create_diagram") createDiagramCallIds.add(call.id);
    }
    if (delta.role === "tool") {
      const toolCallId = typeof delta.tool_call_id === "string" ? delta.tool_call_id : "";
      let result = null;
      try {
        result = JSON.parse(delta.content);
      } catch {
        results.push({ toolCallId, result: null, unparseable: true });
        continue;
      }
      results.push({ toolCallId, result, unparseable: false });
    }
  }
  return { sawDone, errorEvents, createDiagramCallIds, results };
}

// The single correlated ok:true receipt a run carries, or null when the run
// has none, more than one, or nothing at all. The smoke uses this to learn
// which artifact id to fetch; verifyDiagramRun re-derives it to judge the run.
export function successfulDiagramResult(events) {
  const { results, createDiagramCallIds } = readStream(events);
  const successes = results.filter((entry) =>
    entry.result?.ok === true && createDiagramCallIds.has(entry.toolCallId));
  return successes.length === 1 ? successes[0].result : null;
}

// Judges one interactive-diagram run: the streamed events and the artifact GET
// response must tell the same story as the tool receipt, or the run fails with
// every reason listed.
export function verifyDiagramRun({ events, artifactResponse } = {}) {
  const errors = [];
  if (!Array.isArray(events) || events.length === 0) {
    return { ok: false, errors: ["no SSE events: the stream produced nothing to verify"] };
  }

  const { sawDone, errorEvents, createDiagramCallIds, results } = readStream(events);
  for (const message of errorEvents) errors.push(`server sent a terminal error event: ${message}`);
  if (!sawDone) errors.push('stream ended without a terminal "data: [DONE]" frame');
  for (const entry of results) {
    if (!entry.unparseable) continue;
    errors.push(`tool result for call ${entry.toolCallId || "(no id)"} is not valid JSON`);
  }
  for (const entry of results) {
    if (entry.unparseable) continue;
    if (createDiagramCallIds.has(entry.toolCallId)) continue;
    errors.push(`tool result for call ${entry.toolCallId || "(no id)"} cannot be correlated with any create_diagram tool call`);
  }

  const successes = results.filter((entry) => entry.result?.ok === true);
  if (successes.length > 1) {
    errors.push(`more than one successful create_diagram result (${successes.map((entry) => entry.result.diagramId ?? "?").join(", ")}) — cannot tell which artifact was delivered`);
  }
  if (successes.length === 0 && createDiagramCallIds.size > 0) {
    const lastFailure = [...results].reverse().find((entry) => !entry.unparseable && entry.result?.ok === false);
    const reason = lastFailure?.result?.error ?? lastFailure?.result?.diagnostics?.[0]?.message;
    errors.push(`no successful create_diagram result — the diagram failed${reason ? `: ${reason}` : ""}`);
  }
  if (successes.length === 0 && createDiagramCallIds.size === 0 && errorEvents.length === 0) {
    errors.push("no create_diagram tool call in the stream");
  }

  const receipt = successes[0]?.result;
  const receiptUsable = receipt !== undefined && validateReceipt(receipt, errors);
  if (successes[0] !== undefined) verifyArtifactResponse(artifactResponse, receiptUsable ? receipt : null, errors);

  return { ok: errors.length === 0, errors };
}

// Receipt field contract: the tool's success result must carry everything the
// smoke needs to re-verify the delivery, not just an id.
function validateReceipt(receipt, errors) {
  if (receipt === null || typeof receipt !== "object") {
    errors.push("successful create_diagram result is not an object");
    return false;
  }
  let usable = true;
  if (typeof receipt.diagramId !== "string" || receipt.diagramId.length === 0) {
    errors.push("successful result has no usable diagramId");
    usable = false;
  }
  if (typeof receipt.title !== "string" || receipt.title.trim().length === 0) {
    errors.push("successful result has no title");
    usable = false;
  }
  if (!DIAGRAM_TYPES.includes(receipt.type)) {
    errors.push(`successful result declares diagram type ${JSON.stringify(receipt.type ?? null)} — expected one of: ${DIAGRAM_TYPES.join(", ")}`);
    usable = false;
  }
  if (typeof receipt.sha256 !== "string" || !SHA256_PATTERN.test(receipt.sha256)) {
    errors.push(`successful result carries sha256 ${JSON.stringify(receipt.sha256 ?? null)} — expected a 64-char lowercase hex digest`);
    usable = false;
  }
  if (!Number.isSafeInteger(receipt.bytes) || receipt.bytes <= 0) {
    errors.push(`successful result carries bytes ${JSON.stringify(receipt.bytes ?? null)} — expected a positive byte count`);
    usable = false;
  }
  return usable;
}

function verifyArtifactResponse(artifactResponse, receipt, errors) {
  if (artifactResponse === null || artifactResponse === undefined || typeof artifactResponse !== "object") {
    errors.push("no artifact response to verify — GET /api/artifacts/<id> must be fetched and checked");
    return;
  }
  const header = headerNames(artifactResponse.headers);
  if (artifactResponse.status !== 200) {
    errors.push(`artifact GET returned HTTP ${JSON.stringify(artifactResponse.status ?? null)}, expected 200`);
  }
  const contentType = header("content-type") ?? "";
  if (!contentType.includes("text/html") || !contentType.includes("utf-8")) {
    errors.push(`artifact content-type ${JSON.stringify(contentType)} must be text/html; charset=utf-8`);
  }
  if (header("x-content-type-options") !== "nosniff") {
    errors.push("artifact response must set x-content-type-options: nosniff");
  }
  const cacheControl = header("cache-control") ?? "";
  if (!cacheControl.includes("no-store")) {
    errors.push(`artifact response must set cache-control: no-store, got ${JSON.stringify(cacheControl)}`);
  }
  const body = artifactResponse.body;
  if (typeof body !== "string" || body.length === 0) {
    errors.push("artifact body is empty");
    return;
  }
  if (!receipt) return; // receipt already reported broken; digest comparison would be noise

  const digest = createHash("sha256").update(body, "utf8").digest("hex");
  if (digest !== receipt.sha256) {
    errors.push(`fetched artifact sha256 ${digest} does not match the tool receipt ${receipt.sha256}`);
  }
  const bytes = Buffer.byteLength(body, "utf8");
  if (bytes !== receipt.bytes) {
    errors.push(`fetched artifact is ${bytes} bytes, tool receipt says ${receipt.bytes}`);
  }
}

// Judges one inline text run: the stream must have completed, the reassembled
// recipe must be nonblank, parse clean, and build a Card with content in it.
export function verifyTextRun({ text, events, parseErrors, root } = {}) {
  const errors = [];
  const list = Array.isArray(events) ? events : [];
  if (!list.some((event) => event === DONE)) {
    errors.push('stream ended without a terminal "data: [DONE]" frame — the reply never completed');
  }
  for (const event of list) {
    if (event !== null && typeof event === "object" && event.error !== undefined && event.error !== null) {
      errors.push(`server sent a terminal error event: ${
        typeof event.error?.message === "string" ? event.error.message : JSON.stringify(event.error)}`);
    }
  }
  if (typeof text !== "string" || text.trim().length === 0) {
    errors.push("blank reply: no recipe text was streamed");
  }
  const failureCount = Array.isArray(parseErrors) ? parseErrors.length : 0;
  if (failureCount > 0) {
    errors.push(`recipe has ${failureCount} parse error(s): ${JSON.stringify(parseErrors[0]).slice(0, 200)}`);
  }
  if (root === null || typeof root !== "object") {
    errors.push("recipe built no root component — expected a Card");
  } else if (root.typeName !== "Card") {
    errors.push(`root component is ${JSON.stringify(root.typeName ?? null)}, expected Card`);
  } else {
    const children = root.props?.children;
    const content = Array.isArray(children) ? children : children === undefined || children === null ? [] : [children];
    if (content.length === 0) errors.push("the Card has no content — a nonblank reply needs at least one child");
  }
  return { ok: errors.length === 0, errors };
}

// Judges one rendered recipe: a completed stream, parse cleanliness, then the
// expected family's own markup. Leftover svg from a partial render proves
// nothing — and neither does markup from a stream that never finished, since a
// truncated recipe can still parse cleanly and render its first blocks.
export function verifyRenderedRecipe({ text, parseErrors, renderedHtml, expectedFamily, completed } = {}) {
  const errors = [];
  const family = FAMILY_MARKUP[expectedFamily];
  if (!family) {
    return {
      ok: false,
      errors: [`unknown family ${JSON.stringify(expectedFamily ?? null)} — expected one of: ${Object.keys(FAMILY_MARKUP).join(", ")}`],
    };
  }
  if (completed !== true) {
    errors.push('stream did not complete: no terminal "data: [DONE]" frame arrived');
  }
  if (typeof text !== "string" || text.trim().length === 0) {
    errors.push("blank reply: no recipe text was streamed");
  }
  const failureCount = Array.isArray(parseErrors) ? parseErrors.length : 0;
  if (failureCount > 0) {
    errors.push(`recipe has ${failureCount} parse error(s): ${JSON.stringify(parseErrors[0]).slice(0, 200)}`);
  }
  if (typeof renderedHtml !== "string" || renderedHtml.length === 0) {
    errors.push("nothing rendered: the recipe produced no HTML");
    return { ok: false, errors };
  }
  if (!family.probe.test(renderedHtml)) {
    errors.push(`rendered HTML carries no ${expectedFamily} markup (looked for /${family.probe.source}/)`);
  }
  if (family.svg && !renderedHtml.includes("<svg")) {
    errors.push(`${expectedFamily} renders as svg but no <svg> markup appeared in the render`);
  }
  return { ok: errors.length === 0, errors };
}

// Judges the prompt example set: enough examples, every one parsing clean, and
// every required (group-advertised) component actually instantiated by a clean
// example — coverage is proved by parsed components, not by substring luck.
export function verifyExampleCoverage({ examples, requiredComponents, minExamples = MIN_EXAMPLES } = {}) {
  const errors = [];
  if (!Array.isArray(examples)) {
    return { ok: false, errors: ["examples must be an array of { errors, components }"] };
  }
  if (!Array.isArray(requiredComponents) || requiredComponents.length === 0) {
    errors.push("no required components to cover — pass the components the library's diagram group advertises");
  }
  if (examples.length < minExamples) {
    errors.push(`only ${examples.length} example(s) — need at least ${minExamples} (built-ins plus one per diagram family)`);
  }
  const cleanComponents = new Set();
  examples.forEach((example, index) => {
    const failureCount = Array.isArray(example?.errors) ? example.errors.length : 0;
    if (failureCount > 0) {
      errors.push(`example ${index + 1} has ${failureCount} parse error(s) — a broken example proves nothing: ${JSON.stringify(example.errors[0]).slice(0, 200)}`);
      return;
    }
    for (const name of Array.isArray(example?.components) ? example.components : []) {
      cleanComponents.add(name);
    }
  });
  const missing = (Array.isArray(requiredComponents) ? requiredComponents : [])
    .filter((name) => !cleanComponents.has(name));
  for (const name of missing) {
    errors.push(`${name} is instantiated by no clean parsed example — the library advertises it, the examples never build it`);
  }
  return { ok: errors.length === 0, errors };
}

// The component types a parsed recipe actually builds, walking the element tree
// the parser returns (result.root).
export function parsedComponentNames(tree) {
  const names = new Set();
  const seen = new Set();
  const walk = (node) => {
    if (node === null || typeof node !== "object" || seen.has(node)) return;
    seen.add(node);
    if (typeof node.typeName === "string" && node.typeName.length > 0) names.add(node.typeName);
    for (const value of Object.values(node)) {
      if (Array.isArray(value)) value.forEach(walk);
      else if (value !== null && typeof value === "object") walk(value);
    }
  };
  walk(tree);
  return [...names];
}
