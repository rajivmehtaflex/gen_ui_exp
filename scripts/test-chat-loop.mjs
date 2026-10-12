import assert from "node:assert/strict";
import { diagramModeForPrompt } from "../server/diagram-policy.mjs";

const module = await import("../server/tool-loop.mjs").catch(() => ({}));
const { runToolLoop, cannedDiagramReply } = module;
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

const chunk = (delta, finishReason = null) => ({
  id: "chatcmpl-offline",
  choices: [{ index: 0, delta, finish_reason: finishReason }],
});
const toolRound = (calls) => [
  chunk({ role: "assistant", tool_calls: calls.map((call, index) => ({
    index,
    ...(call.id === undefined ? {} : { id: call.id }),
    type: "function",
    function: { name: call.name, arguments: call.arguments },
  })) }),
  chunk({}, "tool_calls"),
];
const textRound = (text = "Finished") => [chunk({ role: "assistant", content: text }), chunk({}, "stop")];
const validCall = (id, name = "create_diagram", args = "{}") => ({ id, name, arguments: args });

async function run(rounds, outcomes = [], initialMode = "auto", onEmit = null) {
  assert.equal(typeof runToolLoop, "function", "runToolLoop must be exported");
  const requests = [];
  const frames = [];
  const executed = [];
  const controller = new AbortController();
  await runToolLoop({
    messages: [{ role: "user", content: "draw a diagram" }],
    createCompletion: async (request, { signal }) => {
      assert.equal(signal, controller.signal);
      requests.push(structuredClone(request));
      const next = rounds[requests.length - 1];
      if (next instanceof Error) throw next;
      assert.ok(next, `unexpected completion ${requests.length}`);
      return (async function* () { for (const part of next) yield part; })();
    },
    executeTool: async (args, signal) => {
      assert.equal(signal, controller.signal);
      executed.push(args);
      return outcomes[executed.length - 1] ?? { ok: false, error: "invalid diagram", diagnostics: [] };
    },
    emit: async (sse) => { frames.push(sse); if (onEmit) await onEmit(sse, controller); },
    signal: controller.signal,
    model: "offline-model",
    initialMode,
  });
  const events = frames.filter((frame) => frame.startsWith("data: {")).map((frame) => JSON.parse(frame.slice(6)));
  const results = events.filter((event) => event.choices?.[0]?.delta?.role === "tool")
    .map((event) => ({ id: event.choices[0].delta.tool_call_id, result: JSON.parse(event.choices[0].delta.content) }));
  const visibleText = events.map((event) => event.choices?.[0]?.delta?.content ?? "").join("");
  return { requests, frames, executed, results, visibleText };
}

await check("batch_results_match_all_ids", async () => {
  const state = await run([toolRound([validCall("a"), validCall("b")]), textRound()], [
    { ok: false, error: "bad a", diagnostics: [] },
    { ok: true, diagramId: "b-diagram", title: "B", type: "architecture" },
  ]);
  assert.deepEqual(state.results.map((result) => result.id), ["a", "b"]);
  assert.equal(state.requests[1].messages.filter((message) => message.role === "tool").length, 2);
  assert.equal(state.requests[1].tool_choice, "none");
});

await check("unknown_function_not_executed", async () => {
  const state = await run([toolRound([validCall("other", "delete_everything"), validCall("diagram")]), textRound()], [
    { ok: true, diagramId: "diag", title: "D", type: "architecture" },
  ]);
  assert.equal(state.executed.length, 1);
  assert.deepEqual(state.results.map((result) => result.id), ["other", "diagram"]);
  assert.equal(state.results[0].result.ok, false);
  assert.match(state.results[0].result.error, /unsupported/i);
});

await check("third_attempt_success_gets_final_text", async () => {
  const state = await run([toolRound([validCall("a")]), toolRound([validCall("b")]), toolRound([validCall("c")]), textRound("Here is the diagram")], [
    { ok: false, error: "first", diagnostics: [] },
    { ok: false, error: "second", diagnostics: [] },
    { ok: true, diagramId: "third", title: "Third", type: "architecture" },
  ], "interactive");
  assert.equal(state.executed.length, 3);
  assert.equal(state.requests.length, 4);
  assert.deepEqual(state.requests.slice(0, 4).map((request) => request.tool_choice), [
    { type: "function", function: { name: "create_diagram" } },
    { type: "function", function: { name: "create_diagram" } },
    { type: "function", function: { name: "create_diagram" } },
    "none",
  ]);
  assert.match(state.visibleText, /Here is the diagram/);
});

await check("three_failures_stop", async () => {
  const state = await run([toolRound([validCall("a")]), toolRound([validCall("b")]), toolRound([validCall("c")])]);
  assert.equal(state.executed.length, 3);
  assert.equal(state.requests.length, 3);
  assert.equal(state.results.length, 3);
  assert.match(state.visibleText, /couldn't produce|unable to create/i);
});

await check("canned_failure_is_honest", async () => {
  assert.equal(typeof cannedDiagramReply, "function", "cannedDiagramReply must be exported");
  assert.match(cannedDiagramReply({ ok: false, error: "renderer unavailable", diagnostics: [] }), /renderer unavailable/);
  assert.doesNotMatch(cannedDiagramReply({ ok: false, error: "renderer unavailable", diagnostics: [] }), /I've created/i);
  assert.match(cannedDiagramReply({ ok: true, diagramId: "one", title: "Map", type: "architecture" }), /created/i);
});

await check("truncated_tool_arguments_not_executed", async () => {
  const state = await run([toolRound([validCall("broken", "create_diagram", '{"spec":')])]);
  assert.equal(state.executed.length, 0);
  assert.equal(state.results.length, 1);
  assert.equal(state.results[0].result.ok, false);
  assert.match(state.results[0].result.error, /JSON|arguments/i);
});

await check("abort_between_result_and_final", async () => {
  const state = await run([toolRound([validCall("a")])], [
    { ok: true, diagramId: "diag", title: "D", type: "architecture" },
  ], "auto", (sse, controller) => { if (sse.includes('"role":"tool"')) controller.abort(); });
  assert.equal(state.requests.length, 1);
  assert.equal(state.results.length, 1);
});

await check("malformed_empty_calls_and_mixed_success_batches", async () => {
  const empty = await run([[chunk({ role: "assistant" }), chunk({}, "tool_calls")]]);
  assert.equal(empty.executed.length, 0);
  assert.match(empty.visibleText, /couldn't|unable/i);
  const mixed = await run([toolRound([validCall("missing", "create_diagram", "{}"), validCall("unknown", "nope"), validCall("invalid", "create_diagram", "{")]), toolRound([validCall("success")]), textRound()], [
    { ok: false, error: "bad", diagnostics: [] },
    { ok: true, diagramId: "good", title: "Good", type: "workflow" },
  ]);
  assert.deepEqual(mixed.results.map((result) => result.id), ["missing", "unknown", "invalid", "success"]);
  assert.equal(mixed.executed.length, 2);
  assert.equal(mixed.results[1].result.ok, false);
  assert.equal(mixed.results[2].result.ok, false);
});

await check("mode_to_tool_choice_mapping", async () => {
  for (const [prompt, mode, choice] of [
    ["Draw an inline workflow diagram", "inline", "none"],
    ["Tell me about workflows", "auto", "auto"],
    ["Create an interactive architecture diagram", "interactive", { type: "function", function: { name: "create_diagram" } }],
  ]) {
    assert.equal(diagramModeForPrompt(prompt), mode);
    const state = await run([textRound()], [], mode);
    assert.deepEqual(state.requests[0].tool_choice, choice);
    assert.equal(state.requests[0].parallel_tool_calls, false);
  }
});

await check("execution_budget_shared_across_batch", async () => {
  const state = await run([toolRound([validCall("a"), validCall("b"), validCall("c"), validCall("d")])]);
  assert.equal(state.executed.length, 3);
  assert.deepEqual(state.results.map((result) => result.id), ["a", "b", "c", "d"]);
  assert.match(state.results[3].result.error, /budget/i);
});

await check("invalid_id_and_missing_name_not_executed", async () => {
  const state = await run([toolRound([
    { name: "create_diagram", arguments: "{}" },
    { id: "no-name", name: "", arguments: "{}" },
  ])]);
  assert.equal(state.executed.length, 0);
  assert.equal(state.results.length, 2);
  assert.match(state.results[0].result.error, /id/i);
  assert.match(state.results[1].result.error, /unsupported/i);
  assert.ok(state.frames.some((frame) => frame.includes(`"id":"${state.results[0].id}"`)), "synthesized id must be streamed before its result");
});

await check("final_provider_failure_visible", async () => {
  const state = await run([toolRound([validCall("a")]), new Error("provider closed")], [
    { ok: true, diagramId: "diag", title: "D", type: "architecture" },
  ]);
  assert.equal(state.requests[1].tool_choice, "none");
  assert.match(state.visibleText, /created|diagram/i);
  assert.match(state.visibleText, /couldn't finish|unable to finish|provider/i);
});

await check("empty_final_completion_visible", async () => {
  const state = await run([toolRound([validCall("a")]), [chunk({ role: "assistant" }), chunk({}, "stop")]], [
    { ok: true, diagramId: "diag", title: "D", type: "architecture" },
  ]);
  assert.match(state.visibleText, /couldn't finish|unable to finish/i);
});

process.exitCode = failures ? 1 : 0;
