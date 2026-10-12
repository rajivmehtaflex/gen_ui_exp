import {
  accumulateToolCalls,
  assistantToolCallChunks,
  diagramToolDeclaration,
  toolResultChunk,
} from "./diagram-tool.mjs";

const MAX_DIAGRAM_EXECUTIONS = 3;

function assistantChunk(model, content, finishReason = null) {
  return `data: ${JSON.stringify({
    id: `chatcmpl-${Date.now().toString(36)}`,
    object: "chat.completion.chunk",
    created: Math.floor(Date.now() / 1000),
    model,
    choices: [{ index: 0, delta: { role: "assistant", content }, finish_reason: finishReason }],
  })}\n\n`;
}

async function visibleStop(emit, model, message) {
  await emit(assistantChunk(model, message));
  await emit(assistantChunk(model, "", "stop"));
}

function failureMessage(result) {
  return result?.diagnostics?.[0]?.message || result?.error || "diagram specification failed validation";
}

export function cannedDiagramReply(result) {
  return result.ok
    ? "I've created an interactive architecture map of the deploy pipeline. You can open and explore it in the artifact panel."
    : `I couldn't produce a valid diagram — ${failureMessage(result)}.`;
}

function initialToolChoice(mode) {
  if (mode === "inline") return "none";
  if (mode === "interactive") return { type: "function", function: { name: "create_diagram" } };
  return "auto";
}

function errorResult(error) {
  return { ok: false, error, diagnostics: [] };
}

// All state belongs to this invocation. createCompletion and executeTool are
// injected so the same orchestration can be exercised without a provider.
export async function runToolLoop({ messages, createCompletion, executeTool, emit, signal, model, initialMode }) {
  const conversation = [...messages];
  let executions = 0;
  let toolChoice = initialToolChoice(initialMode);
  let finalAfterSuccess = false;
  let batchNumber = 0;

  while (!signal?.aborted) {
    const finalRequest = finalAfterSuccess;
    let stream;
    try {
      stream = await createCompletion({
        model,
        messages: conversation,
        tools: [diagramToolDeclaration],
        tool_choice: toolChoice,
        parallel_tool_calls: false,
        stream: true,
      }, { signal });
    } catch (error) {
      if (signal?.aborted || error?.name === "AbortError") return;
      if (finalRequest) {
        await visibleStop(emit, model, "The diagram was created, but I couldn't finish the response. Open it in the artifact panel.");
        return;
      }
      throw error;
    }

    const toolDeltas = [];
    let finishReason = null;
    let assistantText = "";
    let invalidFinalFinish = false;
    let heldFinalStop = null;
    try {
      for await (const part of stream) {
        if (signal?.aborted) return;
        const choice = part.choices?.[0];
        if (choice?.delta?.content) assistantText += choice.delta.content;
        if (choice?.delta?.tool_calls) toolDeltas.push(choice.delta.tool_calls);
        if (choice?.finish_reason) finishReason = choice.finish_reason;
        if (finalRequest && choice?.finish_reason && !["stop", "tool_calls"].includes(choice.finish_reason)) {
          invalidFinalFinish = true;
        }
        // The adapter ignores subsequent text after stop or failure. Release a
        // final stop only after the provider stream itself ends successfully.
        const frame = `data: ${JSON.stringify(part)}\n\n`;
        if (finalRequest && choice?.finish_reason === "stop") {
          heldFinalStop = frame;
        } else if (!(finalRequest && invalidFinalFinish)) {
          await emit(frame);
        }
      }
    } catch (error) {
      if (signal?.aborted || error?.name === "AbortError") return;
      if (finalRequest) {
        await visibleStop(emit, model, "The diagram was created, but I couldn't finish the response. Open it in the artifact panel.");
        return;
      }
      throw error;
    }
    if (signal?.aborted) return;
    if (finalRequest && invalidFinalFinish) {
      await visibleStop(emit, model, "The diagram was created, but I couldn't finish the response. Open it in the artifact panel.");
      return;
    }
    if (finishReason !== "tool_calls") {
      if (finalRequest && (finishReason !== "stop" || !assistantText.trim())) {
        await visibleStop(emit, model, "The diagram was created, but I couldn't finish the response. Open it in the artifact panel.");
      } else if (finalRequest && heldFinalStop) {
        await emit(heldFinalStop);
      }
      return;
    }

    batchNumber++;
    const calls = accumulateToolCalls(toolDeltas);
    if (calls.length === 0) {
      await visibleStop(emit, model, "I couldn't produce a valid diagram — the provider returned an empty tool call.");
      return;
    }

    const normalized = calls.map((call, index) => ({
      index: call.index,
      id: typeof call.id === "string" && call.id.trim() ? call.id : `invalid_call_${batchNumber}_${index}`,
      name: call.name,
      arguments: call.arguments,
      missingId: !(typeof call.id === "string" && call.id.trim()),
    }));
    // The browser adapter only starts a tool call after seeing an id. Mirror a
    // malformed call with a stable synthetic id so its error result is visible.
    for (const call of normalized) {
      if (call.missingId) {
        for (const frame of assistantToolCallChunks(call, model)) await emit(frame);
      }
    }
    conversation.push({
      role: "assistant",
      content: assistantText || null,
      tool_calls: normalized.map((call) => ({
        id: call.id,
        type: "function",
        function: { name: call.name || "", arguments: call.arguments || "" },
      })),
    });

    let succeeded = false;
    let lastFailure = null;
    let batchExecutions = 0;
    for (const call of normalized) {
      if (signal?.aborted) return;
      let result;
      if (call.missingId) {
        result = errorResult("invalid tool call: missing id");
      } else if (call.name !== "create_diagram") {
        result = errorResult(`unsupported function: ${call.name || "(missing name)"}`);
      } else if (typeof call.arguments !== "string" || !call.arguments.trim()) {
        result = errorResult("invalid JSON arguments: empty arguments");
      } else {
        try {
          const parsed = JSON.parse(call.arguments);
          if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) {
            result = errorResult("invalid JSON arguments: expected an object");
          }
        } catch (error) {
          result = errorResult(`invalid JSON arguments: ${error.message}`);
        }
      }
      if (!result && finalRequest) {
        result = errorResult("diagram already created; no more tool calls accepted");
      }
      if (!result && executions >= MAX_DIAGRAM_EXECUTIONS) {
        result = errorResult("diagram execution budget exhausted");
      }
      if (!result) {
        executions++;
        batchExecutions++;
        try {
          result = await executeTool(call.arguments, signal);
        } catch (error) {
          if (signal?.aborted || error?.name === "AbortError") return;
          result = errorResult(`diagram execution failed: ${error.message}`);
        }
      }
      if (signal?.aborted) return;
      await emit(toolResultChunk({ toolCallId: call.id, content: JSON.stringify(result) }, model));
      conversation.push({ role: "tool", tool_call_id: call.id, content: JSON.stringify(result) });
      if (result.ok) succeeded = true;
      else lastFailure = result;
    }
    if (signal?.aborted) return;
    if (finalRequest) {
      await visibleStop(emit, model, "The diagram was created, but I couldn't finish the response. Open it in the artifact panel.");
      return;
    }
    if (succeeded) {
      finalAfterSuccess = true;
      toolChoice = "none";
      continue;
    }
    if (executions >= MAX_DIAGRAM_EXECUTIONS || batchExecutions === 0) {
      await visibleStop(emit, model, `I couldn't produce a valid diagram — ${failureMessage(lastFailure)}.`);
      return;
    }
    toolChoice = { type: "function", function: { name: "create_diagram" } };
  }
}
