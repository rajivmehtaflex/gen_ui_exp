import {
  accumulateToolCalls,
  assistantToolCallBatchChunks,
  diagramToolDeclaration,
  toolResultChunk,
} from "./diagram-tool.mjs";
import { createStreamBudget, MAX_MODEL_OUTPUT_BYTES } from "./resource-limits.mjs";

const MAX_DIAGRAM_EXECUTIONS = 3;
const STALLED_REQUEST_MESSAGE = "I stopped this response before it finished because the request ran out of time or the connection closed. Ask again to continue.";
const UNDELIVERABLE_FRAME_MESSAGE = "I stopped this response because one piece of it was too large to deliver. Ask again to continue.";

function formatBytes(limitBytes) {
  if (limitBytes >= 1024 * 1024) return `${Math.round(limitBytes / (1024 * 1024))} MiB`;
  if (limitBytes >= 1024) return `${Math.round(limitBytes / 1024)} KiB`;
  return `${limitBytes} bytes`;
}

function outputBudgetMessage(limitBytes) {
  return `I stopped this response because it exceeded the ${formatBytes(limitBytes)} output budget for one request. Ask me to continue with a smaller diagram.`;
}

// Bytes a provider delta adds to what this request must retain: assistant text
// plus tool-call arguments. Everything else in a delta is relayed, not stored.
function modelDeltaBytes(delta) {
  if (!delta) return 0;
  let bytes = typeof delta.content === "string" ? Buffer.byteLength(delta.content) : 0;
  for (const call of delta.tool_calls ?? []) {
    if (typeof call?.function?.arguments === "string") {
      bytes += Buffer.byteLength(call.function.arguments);
    }
  }
  return bytes;
}

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

function withoutToolCallDeltas(part) {
  if (!Array.isArray(part?.choices)) return part;
  let changed = false;
  const choices = part.choices.map((choice) => {
    if (!choice?.delta || !Object.hasOwn(choice.delta, "tool_calls")) return choice;
    const { tool_calls: _toolCalls, ...delta } = choice.delta;
    changed = true;
    return { ...choice, delta };
  });
  return changed ? { ...part, choices } : part;
}

function safeToolArguments(value) {
  if (typeof value !== "string" || value.length === 0) {
    return { arguments: "{}", invalid: true };
  }
  try {
    const parsed = JSON.parse(value);
    if (parsed !== null && typeof parsed === "object" && !Array.isArray(parsed)) {
      return { arguments: value, invalid: false };
    }
  } catch {
    // Keep malformed provider text out of conversation history; the tool result
    // below carries the validation failure back to the model and browser.
  }
  return { arguments: "{}", invalid: true };
}

function uniqueToolCallId(candidate, batchNumber, index, seenIds, fallbackPrefix) {
  if (typeof candidate === "string" && candidate.trim() && !seenIds.has(candidate)) return candidate;
  let suffix = 0;
  let id = `${fallbackPrefix}_${batchNumber}_${index}`;
  while (seenIds.has(id)) id = `${fallbackPrefix}_${batchNumber}_${index}_${++suffix}`;
  return id;
}

// The round machine. Returns true when the request reached one of its natural
// endings (a settled final response or a visible failure) and false only when
// the signal aborted mid-flight — runToolLoop turns the latter into a visible
// terminal diagnostic.
async function runToolLoopRounds({ messages, createCompletion, executeTool, emit, signal, model, initialMode,
  maxModelOutputBytes = MAX_MODEL_OUTPUT_BYTES }) {
  const conversation = [...messages];
  const seenToolIds = new Set(conversation.flatMap((message) =>
    Array.isArray(message.tool_calls) ? message.tool_calls.map((call) => call.id).filter((id) => typeof id === "string") : []));
  const budget = createStreamBudget(maxModelOutputBytes);
  // The writer refused a frame, so it was never delivered; continuing would
  // stream a gap the client reads as normal output. Settle visibly instead —
  // unless the request is already unwinding, which the abort checks handle.
  const settleAfterRefusal = async () => {
    if (signal?.aborted) return false;
    await visibleStop(emit, model, UNDELIVERABLE_FRAME_MESSAGE);
    return true;
  };
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
      if (signal?.aborted || error?.name === "AbortError") return false;
      if (finalRequest) {
        await visibleStop(emit, model, "The diagram was created, but I couldn't finish the response. Open it in the artifact panel.");
        return true;
      }
      throw error;
    }

    const toolDeltas = [];
    let finishReason = null;
    let assistantText = "";
    let invalidFinalFinish = false;
    let heldFinalStop = null;
    let overBudget = false;
    try {
      for await (const part of stream) {
        if (signal?.aborted) return false;
        const choice = part.choices?.[0];
        // Charge before retaining or relaying: nothing over budget is kept.
        const incoming = modelDeltaBytes(choice?.delta);
        if (incoming > 0 && !budget.tryCharge(incoming)) {
          overBudget = true;
          break;
        }
        if (choice?.delta?.content) assistantText += choice.delta.content;
        if (choice?.delta?.tool_calls) toolDeltas.push(choice.delta.tool_calls);
        if (choice?.finish_reason) finishReason = choice.finish_reason;
        if (finalRequest && choice?.finish_reason && !["stop", "tool_calls"].includes(choice.finish_reason)) {
          invalidFinalFinish = true;
        }
        // The adapter ignores subsequent text after stop or failure. Release a
        // final stop only after the provider stream itself ends successfully.
        const frame = `data: ${JSON.stringify(withoutToolCallDeltas(part))}\n\n`;
        if (finalRequest && choice?.finish_reason === "stop") {
          heldFinalStop = frame;
        } else if (!(finalRequest && invalidFinalFinish)) {
          if ((await emit(frame)) === false) return await settleAfterRefusal();
        }
      }
    } catch (error) {
      if (signal?.aborted || error?.name === "AbortError") return false;
      if (finalRequest) {
        await visibleStop(emit, model, "The diagram was created, but I couldn't finish the response. Open it in the artifact panel.");
        return true;
      }
      throw error;
    }
    if (signal?.aborted) return false;
    if (overBudget) {
      // A truncated stream must never look like success: execute nothing
      // further and explain the budget in visible assistant text.
      await visibleStop(emit, model, outputBudgetMessage(maxModelOutputBytes));
      return true;
    }
    if (finalRequest && invalidFinalFinish) {
      await visibleStop(emit, model, "The diagram was created, but I couldn't finish the response. Open it in the artifact panel.");
      return true;
    }
    if (finishReason !== "tool_calls") {
      if (finalRequest && (finishReason !== "stop" || !assistantText.trim())) {
        await visibleStop(emit, model, "The diagram was created, but I couldn't finish the response. Open it in the artifact panel.");
      } else if (finalRequest && heldFinalStop) {
        await emit(heldFinalStop);
      }
      return true;
    }

    batchNumber++;
    const calls = accumulateToolCalls(toolDeltas);
    if (calls.length === 0) {
      await visibleStop(emit, model, "I couldn't produce a valid diagram — the provider returned an empty tool call.");
      return true;
    }

    const normalized = calls.map((call, index) => {
      const originalIdValid = typeof call.id === "string" && call.id.trim().length > 0;
      const duplicateId = originalIdValid && seenToolIds.has(call.id);
      const fallbackPrefix = originalIdValid ? "duplicate_call" : "invalid_call";
      const id = uniqueToolCallId(call.id, batchNumber, index, seenToolIds, fallbackPrefix);
      seenToolIds.add(id);
      const safeArgs = safeToolArguments(call.arguments);
      return {
        index: call.index,
        id,
        name: typeof call.name === "string" ? call.name : "",
        wireName: typeof call.name === "string" && call.name.trim() ? call.name : "unknown_function",
        arguments: safeArgs.arguments,
        missingId: !originalIdValid,
        duplicateId,
        invalidArguments: safeArgs.invalid,
      };
    });
    // Provider tool deltas are buffered until a complete round exists. Emit a
    // single normalized batch so malformed arguments and duplicate ids cannot
    // poison the browser's serialized conversation history.
    const browserCalls = normalized.map((call) => ({
      index: call.index,
      id: call.id,
      name: call.wireName,
      arguments: call.arguments,
    }));
    for (const frame of assistantToolCallBatchChunks(browserCalls, model)) {
      if ((await emit(frame)) === false) return await settleAfterRefusal();
    }
    conversation.push({
      role: "assistant",
      content: assistantText || null,
      tool_calls: normalized.map((call) => ({
        id: call.id,
        type: "function",
        function: { name: call.wireName, arguments: call.arguments },
      })),
    });

    let succeeded = false;
    let lastFailure = null;
    let batchExecutions = 0;
    for (const call of normalized) {
      if (signal?.aborted) return false;
      let result;
      if (call.missingId) {
        result = errorResult("invalid tool call: missing id");
      } else if (call.duplicateId) {
        result = errorResult("duplicate provider tool call id; duplicate call was not executed");
      } else if (call.invalidArguments) {
        result = errorResult("invalid JSON arguments: expected a JSON object");
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
          if (signal?.aborted || error?.name === "AbortError") return false;
          result = errorResult(`diagram execution failed: ${error.message}`);
        }
      }
      if (signal?.aborted) return false;
      if ((await emit(toolResultChunk({ toolCallId: call.id, content: JSON.stringify(result) }, model))) === false) {
        return await settleAfterRefusal();
      }
      conversation.push({ role: "tool", tool_call_id: call.id, content: JSON.stringify(result) });
      if (result.ok) succeeded = true;
      else lastFailure = result;
    }
    if (signal?.aborted) return false;
    if (finalRequest) {
      await visibleStop(emit, model, "The diagram was created, but I couldn't finish the response. Open it in the artifact panel.");
      return true;
    }
    if (succeeded) {
      finalAfterSuccess = true;
      toolChoice = "none";
      continue;
    }
    if (executions >= MAX_DIAGRAM_EXECUTIONS || batchExecutions === 0) {
      await visibleStop(emit, model, `I couldn't produce a valid diagram — ${failureMessage(lastFailure)}.`);
      return true;
    }
    toolChoice = { type: "function", function: { name: "create_diagram" } };
  }
  return false;
}

// All state belongs to this invocation. createCompletion and executeTool are
// injected so the same orchestration can be exercised without a provider. An
// aborted request (deadline expiry or client disconnect) still settles visibly:
// the stream gets a terminal diagnostic instead of a silent truncation, and the
// caller learns the request did not complete.
export async function runToolLoop(options) {
  const completed = await runToolLoopRounds(options);
  if (!completed && options.signal?.aborted) {
    await visibleStop(options.emit, options.model, STALLED_REQUEST_MESSAGE);
  }
  return { completed };
}
