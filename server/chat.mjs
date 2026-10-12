// The whole backend: one route (POST /api/chat), two modes, one wire format.
//
//   no OPENROUTER_API_KEY  ->  canned mode: stream the validated hello-world recipe
//   key present            ->  live mode:  relay OpenRouter's stream chunk-for-chunk
//
// Both modes emit identical OpenAI Chat Completions SSE ("data: {...}" deltas,
// ending with "data: [DONE]") because the browser-side adapter must match the
// bytes the browser actually receives — never what the server calls upstream.
//
// Run with: node --env-file=.env server/chat.mjs
import { existsSync, readFileSync } from "node:fs";
import express from "express";
import OpenAI from "openai";
import { generateSystemPrompt } from "@openuidev/lang-core";
import { isCannedInteractivePrompt, pickCannedRecipe } from "./canned-recipe.mjs";
import { diagramModeForPrompt } from "./diagram-policy.mjs";
import { validateChatBody } from "./chat-input.mjs";
import {
  createRequestDeadline,
  DEFAULT_MAX_PENDING_SSE_BYTES,
  REQUEST_DEADLINE_MS,
  requestDeadlineMessage,
} from "./resource-limits.mjs";
import { createSseWriter } from "./sse-writer.mjs";
import { cannedDiagramReply, runToolLoop } from "./tool-loop.mjs";
import {
  registerArtifactRoutes,
  diagramPromptBlock,
  executeDiagramTool,
  assistantToolCallChunks,
  toolResultChunk,
} from "./diagram-tool.mjs";

// ---------------------------------------------------------------------------
// The briefing pack — built ONCE at startup. This is the AI's complete job
// description: the menu (every component it may use, serialized from the very
// same library the browser renders with) plus house style (examples + rules).
// ---------------------------------------------------------------------------
const spec = JSON.parse(
  readFileSync(new URL("../generated/chat-library.spec.json", import.meta.url), "utf8"),
);
const baseSystemPrompt = generateSystemPrompt({
  library: spec.library,
  promptOptions: spec.promptOptions,
});
const systemPrompt = `${baseSystemPrompt}\n\n${diagramPromptBlock}`;

const promptExampleFixture = JSON.parse(
  readFileSync(new URL("./examples/diagrams/prompt-example.architecture.json", import.meta.url), "utf8"),
);

const PORT = Number(process.env.PORT ?? 8787);
const MODEL = process.env.OPENROUTER_MODEL || "";
const apiKey = process.env.OPENROUTER_API_KEY?.trim() || "";
const liveMode = apiKey.length > 0;

// Fail fast on half-configured live mode — a key without a model would 400 on
// every request and (before the visible-error fix) show users a blank reply.
if (liveMode && !MODEL) {
  console.error(
    "OPENROUTER_API_KEY is set but OPENROUTER_MODEL is empty — set a model id in .env (see .env.example).",
  );
  process.exit(1);
}

const app = express();
app.use(express.json({ limit: "1mb" }));
registerArtifactRoutes(app);

app.get("/api/health", (_req, res) => {
  res.json({ mode: liveMode ? "live" : "canned", model: MODEL });
});

// Shape one OpenAI Chat Completions streaming chunk.
function chunk(id, delta, finishReason = null) {
  return `data: ${JSON.stringify({
    id,
    object: "chat.completion.chunk",
    created: Math.floor(Date.now() / 1000),
    model: liveMode ? MODEL : "canned-recipe",
    choices: [{ index: 0, delta, finish_reason: finishReason }],
  })}\n\n`;
}

function lastUserText(messages) {
  for (let index = messages.length - 1; index >= 0; index--) {
    const message = messages[index];
    if (message.role !== "user") continue;
    if (typeof message.content === "string") return message.content;
    return message.content
      .filter((part) => part.type === "text")
      .map((part) => part.text)
      .join("\n");
  }
  return "";
}

app.post("/api/chat", async (req, res) => {
  const validation = validateChatBody(req.body);
  if (!validation.ok) return res.status(validation.status).json({ error: validation.error });
  const { messages } = validation;
  const lastUserMsg = lastUserText(messages);

  res.set({
    "Content-Type": "text/event-stream",
    "Cache-Control": "no-cache, no-transform",
    Connection: "keep-alive",
  });
  res.flushHeaders();

  const id = `chatcmpl-${Date.now().toString(36)}`;
  // NB: on modern Node, req "close" fires once the request body is consumed —
  // it is NOT a client disconnect. res "close" is; skip it when we ended normally.
  const disconnected = new AbortController();
  let clientGone = false;
  res.on("close", () => {
    if (!res.writableEnded) { clientGone = true; disconnected.abort(); }
  });
  // One signal ends every piece of work this request owns: the provider
  // stream, the diagram CLI, and the writer's waits. A disconnect fires it at
  // once; otherwise it fires at the whole-request deadline.
  const deadline = createRequestDeadline(disconnected.signal, REQUEST_DEADLINE_MS);
  const sse = createSseWriter(res, { signal: deadline.signal, maxPendingBytes: DEFAULT_MAX_PENDING_SSE_BYTES });
  const write = (s) => sse.write(s);

  try {
    if (!liveMode) {
      const prompt = lastUserMsg;
      if (isCannedInteractivePrompt(prompt)) {
        const toolCallId = `call_${Date.now().toString(36)}`;
        const toolArgs = {
          title: "Deploy Pipeline Architecture",
          type: "architecture",
          spec: promptExampleFixture,
        };
        const chunks = assistantToolCallChunks({
          id: toolCallId,
          name: "create_diagram",
          arguments: JSON.stringify(toolArgs),
        }, "canned-recipe");

        for (const c of chunks) {
          if (clientGone) return res.end();
          await write(c);
          await new Promise((r) => setTimeout(r, 50));
        }

        const result = await executeDiagramTool(JSON.stringify(toolArgs), deadline.signal);
        if (clientGone) return res.end();

        await write(toolResultChunk({
          toolCallId,
          content: JSON.stringify(result),
        }, "canned-recipe"));

        await new Promise((r) => setTimeout(r, 50));
        await write(chunk(id, {
          role: "assistant",
          content: cannedDiagramReply(result),
        }));
        await write(chunk(id, {}, "stop"));
        await write("data: [DONE]\n\n");
        return res.end();
      }

      // ---- canned mode: dictate the recipe line by line, like a real stream.
      // root arrives first so the frame renders before its children exist.
      const lines = pickCannedRecipe(prompt).split("\n");
      await write(chunk(id, { role: "assistant", content: "" }));
      for (const line of lines) {
        if (clientGone) return res.end();
        await write(chunk(id, { content: line + "\n" }));
        await new Promise((r) => setTimeout(r, 120));
      }
      await write(chunk(id, {}, "stop"));
      await write("data: [DONE]\n\n");
      return res.end();
    }

    // ---- live mode: brief the chef, run bounded tool loop.
    const client = new OpenAI({
      baseURL: process.env.OPENROUTER_BASE_URL || "https://openrouter.ai/api/v1",
      apiKey,
    });

    const conversationMessages = [
      { role: "system", content: systemPrompt },
      ...messages,
    ];

    const diagramMode = diagramModeForPrompt(lastUserMsg);

    const { completed } = await runToolLoop({
      messages: conversationMessages,
      createCompletion: (request, options) => client.chat.completions.create(request, options),
      executeTool: executeDiagramTool,
      emit: write,
      signal: deadline.signal,
      model: MODEL,
      initialMode: diagramMode,
    });

    // An expired deadline must be visible: the loop stopped early, so say why
    // and settle through the terminal error event (never a blank reply). A
    // client that hung up gets nothing — and no error after a successful stop,
    // which the adapter would misread as a failed run.
    if (!completed && deadline.signal.aborted && !clientGone) {
      const message = requestDeadlineMessage(REQUEST_DEADLINE_MS);
      await write(chunk(id, { content: message }));
      await write(`data: ${JSON.stringify({ error: { message } })}\n\n`);
    }
    await write("data: [DONE]\n\n");
    return res.end();
  } catch (err) {
    // Mid-stream errors still end with [DONE] so the client adapter closes cleanly.
    console.error("chat error:", err.message);
    // The adapter silently skips chunks without choices[].delta.content — an
    // error sent only as {"error":...} would be a BLANK reply in chat. Emit
    // visible assistant text (unless the client itself hung up).
    if (!clientGone && err.name !== "AbortError") {
      await write(chunk(id, { content: `Upstream error: ${err.message}. Check the server console, your key, model id, or rate limits.` }));
    }
    await write(`data: ${JSON.stringify({ error: { message: err.message } })}\n\n`);
    await write("data: [DONE]\n\n");
    return res.end();
  } finally {
    deadline.dispose();
    sse.close();
  }
});

// ---------------------------------------------------------------------------
// Optional production serving: after `npm run build`, this one port serves the
// whole app (UI + API, same origin — no proxy needed). Dev via Vite ignores it.
// ---------------------------------------------------------------------------
const distDir = new URL("../dist", import.meta.url).pathname;
if (existsSync(distDir)) {
  app.use(express.static(distDir));
  app.use((req, res) => {
    if (req.method === "GET" && !req.path.startsWith("/api")) {
      return res.sendFile(new URL("../dist/index.html", import.meta.url).pathname);
    }
    return res.status(404).json({ error: "not found" });
  });
}

app.use((error, _req, res, next) => {
  if (res.headersSent) return next(error);
  if (error?.type === "entity.too.large") {
    return res.status(413).json({ error: "Request body exceeds the 1 MiB limit." });
  }
  if (error?.type === "entity.parse.failed") {
    return res.status(400).json({ error: "Request body must be valid JSON." });
  }
  return next(error);
});

app.listen(PORT, () => {
  console.log(`gen_ui_exp server on http://localhost:${PORT}  (mode: ${liveMode ? "live" : "canned"}, model: ${MODEL})`);
});
