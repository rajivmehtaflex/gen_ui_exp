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
import { fetchLLM, openAIAdapter, openAIMessageFormat } from "@openuidev/react-headless";

export const llm = fetchLLM({
  url: "/api/chat",
  streamAdapter: openAIAdapter(),
  messageFormat: openAIMessageFormat,
});
