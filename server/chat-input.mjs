const MAX_MESSAGES = 100;
const USER_PART_TYPES = new Set(["text", "image_url"]);

function invalid(error) {
  return { ok: false, status: 400, error };
}

function isRecord(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function validateUserContent(content, index) {
  if (typeof content === "string") return { ok: true, content };
  if (!Array.isArray(content)) return invalid(`messages[${index}].content must be text or an array of supported parts`);

  const parts = [];
  for (let partIndex = 0; partIndex < content.length; partIndex++) {
    const part = content[partIndex];
    if (!isRecord(part) || !USER_PART_TYPES.has(part.type)) {
      return invalid(`messages[${index}].content[${partIndex}] has an unsupported part type`);
    }
    if (part.type === "text") {
      if (typeof part.text !== "string") return invalid(`messages[${index}].content[${partIndex}].text must be a string`);
      parts.push({ type: "text", text: part.text });
      continue;
    }

    if (!isRecord(part.image_url) || typeof part.image_url.url !== "string" || !part.image_url.url.trim()) {
      return invalid(`messages[${index}].content[${partIndex}].image_url.url must be a non-empty string`);
    }
    if (part.image_url.detail !== undefined && !["auto", "low", "high"].includes(part.image_url.detail)) {
      return invalid(`messages[${index}].content[${partIndex}].image_url.detail is unsupported`);
    }
    parts.push({
      type: "image_url",
      image_url: {
        url: part.image_url.url,
        ...(part.image_url.detail !== undefined ? { detail: part.image_url.detail } : {}),
      },
    });
  }
  return { ok: true, content: parts };
}

function validateToolCalls(toolCalls, messageIndex, pendingCalls, seenCallIds) {
  if (!Array.isArray(toolCalls) || toolCalls.length === 0) {
    return invalid(`messages[${messageIndex}].tool_calls must be a non-empty array`);
  }
  const normalized = [];
  for (let callIndex = 0; callIndex < toolCalls.length; callIndex++) {
    const call = toolCalls[callIndex];
    const prefix = `messages[${messageIndex}].tool_calls[${callIndex}]`;
    if (!isRecord(call) || typeof call.id !== "string" || !call.id.trim()) {
      return invalid(`${prefix}.id must be a non-empty string`);
    }
    if (seenCallIds.has(call.id) || pendingCalls.has(call.id)) {
      return invalid(`${prefix}.id must be unique in this history`);
    }
    if (call.type !== "function" || !isRecord(call.function)) {
      return invalid(`${prefix} must be a function call`);
    }
    if (typeof call.function.name !== "string" || !call.function.name.trim()) {
      return invalid(`${prefix}.function.name must be a non-empty string`);
    }
    if (typeof call.function.arguments !== "string") {
      return invalid(`${prefix}.function.arguments must be a JSON string`);
    }
    let parsedArguments;
    try {
      parsedArguments = JSON.parse(call.function.arguments);
    } catch {
      return invalid(`${prefix}.function.arguments must contain valid JSON`);
    }
    if (!isRecord(parsedArguments)) {
      return invalid(`${prefix}.function.arguments must encode an object`);
    }
    pendingCalls.add(call.id);
    seenCallIds.add(call.id);
    normalized.push({
      id: call.id,
      type: "function",
      function: { name: call.function.name, arguments: call.function.arguments },
    });
  }
  return { ok: true, toolCalls: normalized };
}

/** Validate and normalize the user/assistant/tool history accepted by this API. */
export function validateChatBody(body) {
  if (!isRecord(body) || !Array.isArray(body.messages) || body.messages.length === 0) {
    return invalid("body must contain a non-empty messages array");
  }
  if (body.messages.length > MAX_MESSAGES) {
    return invalid(`messages may contain at most ${MAX_MESSAGES} entries`);
  }

  const pendingCalls = new Set();
  const seenCallIds = new Set();
  const messages = [];

  for (let index = 0; index < body.messages.length; index++) {
    const message = body.messages[index];
    if (!isRecord(message)) return invalid(`messages[${index}] must be an object`);
    if (!["user", "assistant", "tool"].includes(message.role)) {
      return invalid(`messages[${index}].role is unsupported`);
    }
    if (pendingCalls.size > 0 && message.role !== "tool") {
      return invalid(`messages[${index}] must answer the outstanding tool calls first`);
    }

    if (message.role === "user") {
      const validated = validateUserContent(message.content, index);
      if (!validated.ok) return validated;
      messages.push({ role: "user", content: validated.content });
      continue;
    }

    if (message.role === "assistant") {
      if (message.content !== null && typeof message.content !== "string") {
        return invalid(`messages[${index}].content must be a string or null`);
      }
      const hasToolCalls = message.tool_calls !== undefined;
      if (hasToolCalls) {
        const validated = validateToolCalls(message.tool_calls, index, pendingCalls, seenCallIds);
        if (!validated.ok) return validated;
      } else if (message.content === null) {
        return invalid(`messages[${index}] must contain text or tool calls`);
      }
      messages.push({
        role: "assistant",
        content: message.content,
        ...(hasToolCalls ? { tool_calls: message.tool_calls.map((call) => ({
          id: call.id,
          type: "function",
          function: { name: call.function.name, arguments: call.function.arguments },
        })) } : {}),
      });
      continue;
    }

    if (typeof message.content !== "string") {
      return invalid(`messages[${index}].content must be a string`);
    }
    if (typeof message.tool_call_id !== "string" || !message.tool_call_id.trim()) {
      return invalid(`messages[${index}].tool_call_id must be a non-empty string`);
    }
    if (!pendingCalls.has(message.tool_call_id)) {
      return invalid(`messages[${index}].tool_call_id does not match an outstanding tool call`);
    }
    pendingCalls.delete(message.tool_call_id);
    messages.push({ role: "tool", tool_call_id: message.tool_call_id, content: message.content });
  }

  if (pendingCalls.size > 0) return invalid("history is missing results for one or more tool calls");
  return { ok: true, messages };
}
