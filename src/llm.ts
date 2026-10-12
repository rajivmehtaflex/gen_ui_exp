// Pipe 1 (the waiter): how the chat shell talks to OUR server.
//
// fetchLLM({ url, streamAdapter, messageFormat }) is the whole wiring:
//   url           -> "/api/chat" (Vite dev proxy forwards to localhost:8787)
//   streamAdapter -> translator for the bytes coming BACK. Our server emits raw
//                    OpenAI Chat Completions SSE, so openAIAdapter() is the
//                    matching translator. (Adapter matches the browser's bytes,
//                    not what the server calls upstream.)
//   messageFormat -> translator for messages going OUT (OpenAI wire format).
//
// NB: imported from @openuidev/react-headless — installed react-ui@0.16.3
// re-exports fetchLLM but NOT the adapters; react-headless is their home.
import {
  type StreamProtocolAdapter,
  fetchLLM,
  openAIMessageFormat,
  EventType,
} from "@openuidev/react-headless";

export function chatAdapter(): StreamProtocolAdapter {
  return {
    async *parse(response: Response) {
      const messageId = crypto.randomUUID();
      const toolCallIds: Record<number, string> = {};
      let messageStarted = false;
      const reader = response.body?.getReader();
      if (!reader) return;
      const decoder = new TextDecoder();
      let buffer = "";

      while (true) {
        const { done, value } = await reader.read();
        buffer += done ? decoder.decode() : decoder.decode(value, { stream: true });
        const lines = buffer.split("\n");
        buffer = done ? "" : (lines.pop() ?? "");

        for (const rawLine of lines) {
          const line = rawLine.trim();
          if (!line.startsWith("data:")) continue;
          const data = line.slice(5).trim();
          if (!data || data === "[DONE]") continue;
          try {
            const parsed = JSON.parse(data);
            const choice = parsed.choices?.[0];
            const delta = choice?.delta;
            if (!delta) continue;

            if (delta.role === "tool" && (delta.tool_call_id || delta.toolCallId)) {
              yield {
                type: EventType.TOOL_CALL_RESULT,
                messageId: crypto.randomUUID(),
                toolCallId: (delta.tool_call_id || delta.toolCallId) as string,
                content: typeof delta.content === "string" ? delta.content : JSON.stringify(delta.content ?? null),
                role: "tool",
              };
              continue;
            }

            if (!messageStarted && (delta.content || delta.role)) {
              yield {
                type: EventType.TEXT_MESSAGE_START,
                messageId,
                role: "assistant",
              };
              messageStarted = true;
            }

            if (delta.content) {
              yield {
                type: EventType.TEXT_MESSAGE_CONTENT,
                messageId,
                delta: delta.content,
              };
            }

            if (delta.tool_calls) {
              for (const toolCall of delta.tool_calls) {
                const index = toolCall.index ?? 0;
                if (toolCall.id) {
                  toolCallIds[index] = toolCall.id;
                  yield {
                    type: EventType.TOOL_CALL_START,
                    toolCallId: toolCall.id,
                    toolCallName: toolCall.function?.name || "",
                  };
                }
                if (toolCall.function?.arguments) {
                  const toolCallId = toolCallIds[index];
                  if (toolCallId) {
                    yield {
                      type: EventType.TOOL_CALL_ARGS,
                      toolCallId,
                      delta: toolCall.function.arguments,
                    };
                  }
                }
              }
            }

            if (choice?.finish_reason === "stop") {
              yield {
                type: EventType.TEXT_MESSAGE_END,
                messageId,
              };
            } else if (choice?.finish_reason === "tool_calls") {
              for (const toolCallId of Object.values(toolCallIds)) {
                yield {
                  type: EventType.TOOL_CALL_END,
                  toolCallId,
                };
              }
            }
          } catch (e) {
            console.error("Failed to parse SSE", e);
          }
        }
        if (done) break;
      }
    },
  };
}

export const llm = fetchLLM({
  url: "/api/chat",
  streamAdapter: chatAdapter(),
  messageFormat: openAIMessageFormat,
});
