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
  type AGUIEvent,
  fetchLLM,
  openAIMessageFormat,
  EventType,
} from "@openuidev/react-headless";

export function chatAdapter(): StreamProtocolAdapter {
  return {
    async *parse(response: Response) {
      const reader = response.body?.getReader();
      if (!reader) {
        yield { type: EventType.RUN_ERROR, message: "The response has no stream body." };
        return;
      }
      const decoder = new TextDecoder();
      let buffer = "";
      let dataLines: string[] = [];
      let eventName = "";
      let messageId: string | undefined;
      let stopped = false;
      let exhausted = false;
      const toolCallIds = new Map<number, string>();
      const openToolIds = new Set<string>();

      function* closeText(): Generator<AGUIEvent> {
        if (messageId) {
          const id = messageId;
          messageId = undefined;
          yield { type: EventType.TEXT_MESSAGE_END, messageId: id };
        }
      }
      function* closeRound(): Generator<AGUIEvent> {
        yield* closeText();
        for (const toolCallId of openToolIds) {
          openToolIds.delete(toolCallId);
          yield { type: EventType.TOOL_CALL_END, toolCallId };
        }
        toolCallIds.clear();
      }
      function* fail(message: string): Generator<AGUIEvent> {
        yield* closeRound();
        yield { type: EventType.RUN_ERROR, message };
      }

      try {
        while (true) {
          const read = await reader.read();
          exhausted = read.done;
          buffer += read.done ? decoder.decode() : decoder.decode(read.value, { stream: true });

          while (buffer.length) {
            const lineEnd = buffer.search(/[\r\n]/);
            if (lineEnd === -1 || (!read.done && lineEnd === buffer.length - 1 && buffer[lineEnd] === "\r")) break;
            const line = buffer.slice(0, lineEnd);
            const width = buffer[lineEnd] === "\r" && buffer[lineEnd + 1] === "\n" ? 2 : 1;
            buffer = buffer.slice(lineEnd + width);
            if (line !== "") {
              if (line.startsWith(":")) continue;
              const colon = line.indexOf(":");
              const field = colon === -1 ? line : line.slice(0, colon);
              const value = colon === -1 ? "" : line.slice(colon + 1).replace(/^ /, "");
              if (field === "data") dataLines.push(value);
              if (field === "event") eventName = value;
              continue;
            }

            const data = dataLines.join("\n");
            const frameEvent = eventName;
            dataLines = [];
            eventName = "";
            if (!data) continue;
            if (data.trim() === "[DONE]") {
              yield* closeRound();
              return;
            }
            // JSON failures are protocol errors, never swallowed processing errors.
            let parsed;
            try {
              parsed = JSON.parse(data);
            } catch {
              yield* fail("Invalid JSON in the response stream.");
              return;
            }
            if (frameEvent === "error" || parsed?.error) {
              const error = parsed?.error ?? parsed;
              const message = typeof error === "string" ? error : error?.message ?? JSON.stringify(error);
              yield* fail(message || "Server stream error.");
              return;
            }
            if (stopped) continue;
            const choice = parsed?.choices?.[0];
            if (!choice) continue;
            const delta = choice.delta ?? {};

            if (delta.role === "tool" && (delta.tool_call_id || delta.toolCallId)) {
              yield* closeRound();
              yield {
                type: EventType.TOOL_CALL_RESULT,
                messageId: crypto.randomUUID(),
                toolCallId: delta.tool_call_id || delta.toolCallId,
                content: typeof delta.content === "string" ? delta.content : JSON.stringify(delta.content ?? null),
                role: "tool",
              };
            } else {
              if (!messageId && (delta.content || delta.role === "assistant" || delta.tool_calls?.length)) {
                messageId = crypto.randomUUID();
                yield { type: EventType.TEXT_MESSAGE_START, messageId, role: "assistant" };
              }
              if (typeof delta.content === "string" && delta.content) {
                yield { type: EventType.TEXT_MESSAGE_CONTENT, messageId: messageId!, delta: delta.content };
              }
              for (const toolCall of delta.tool_calls ?? []) {
                const index = toolCall.index ?? 0;
                if (toolCall.id && !toolCallIds.has(index)) {
                  toolCallIds.set(index, toolCall.id);
                  openToolIds.add(toolCall.id);
                  yield {
                    type: EventType.TOOL_CALL_START,
                    toolCallId: toolCall.id,
                    toolCallName: toolCall.function?.name || "",
                  };
                }
                const toolCallId = toolCallIds.get(index);
                if (toolCallId && toolCall.function?.arguments) {
                  yield { type: EventType.TOOL_CALL_ARGS, toolCallId, delta: toolCall.function.arguments };
                }
              }
            }
            if (choice.finish_reason === "tool_calls") {
              yield* closeRound();
            } else if (choice.finish_reason === "stop") {
              yield* closeRound();
              stopped = true;
            } else if (choice.finish_reason === "length" || choice.finish_reason === "content_filter") {
              yield* fail(choice.finish_reason === "length"
                ? "The response was truncated at the model output limit."
                : "The response was blocked by the content filter.");
              return;
            }
          }
          if (read.done) {
            yield* fail("The response stream ended unexpectedly before [DONE].");
            return;
          }
        }
      } catch (error) {
        // Keep processing and transport failures visible to the SDK after
        // settling any events already emitted by this adapter.
        yield* closeRound();
        throw error;
      } finally {
        // A terminal frame or consumer return leaves unread bytes to cancel.
        try {
          if (!exhausted) await reader.cancel();
        } catch {
          // Cancellation is cleanup and must not replace the stream outcome.
        } finally {
          reader.releaseLock();
        }
      }
    },
  };
}

export const llm = fetchLLM({
  url: "/api/chat",
  streamAdapter: chatAdapter(),
  messageFormat: openAIMessageFormat,
});
