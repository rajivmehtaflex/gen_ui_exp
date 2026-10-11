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
import { pickCannedRecipe } from "./canned-recipe.mjs";

// ---------------------------------------------------------------------------
// The briefing pack — built ONCE at startup. This is the AI's complete job
// description: the menu (every component it may use, serialized from the very
// same library the browser renders with) plus house style (examples + rules).
// ---------------------------------------------------------------------------
const spec = JSON.parse(
  readFileSync(new URL("../generated/chat-library.spec.json", import.meta.url), "utf8"),
);
const systemPrompt = generateSystemPrompt({
  library: spec.library,
  promptOptions: spec.promptOptions,
});

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

app.post("/api/chat", async (req, res) => {
  const { messages } = req.body ?? {};
  if (!Array.isArray(messages) || messages.length === 0) {
    return res.status(400).json({ error: "body must be { messages: [...] }" });
  }

  res.set({
    "Content-Type": "text/event-stream",
    "Cache-Control": "no-cache, no-transform",
    Connection: "keep-alive",
  });
  res.flushHeaders();

  const id = `chatcmpl-${Date.now().toString(36)}`;
  const abort = new AbortController();
  let closed = false;
  // NB: on modern Node, req "close" fires once the request body is consumed —
  // it is NOT a client disconnect. res "close" is; skip it when we ended normally.
  res.on("close", () => {
    if (!res.writableEnded) { closed = true; abort.abort(); }
  });
  const write = (s) => { if (!closed) res.write(s); };

  try {
    if (!liveMode) {
      // ---- canned mode: dictate the recipe line by line, like a real stream.
      // root arrives first so the frame renders before its children exist.
      const prompt = String(messages[messages.length - 1]?.content ?? "");
      const lines = pickCannedRecipe(prompt).split("\n");
      write(chunk(id, { role: "assistant", content: "" }));
      for (const line of lines) {
        if (closed) return res.end();
        write(chunk(id, { content: line + "\n" }));
        await new Promise((r) => setTimeout(r, 120));
      }
      write(chunk(id, {}, "stop"));
      write("data: [DONE]\n\n");
      return res.end();
    }

    // ---- live mode: brief the chef, relay OpenRouter's stream untouched.
    const client = new OpenAI({
      baseURL: process.env.OPENROUTER_BASE_URL || "https://openrouter.ai/api/v1",
      apiKey,
    });
    const stream = await client.chat.completions.create(
      {
        model: MODEL,
        messages: [{ role: "system", content: systemPrompt }, ...messages],
        stream: true,
      },
      { signal: abort.signal },
    );
    for await (const part of stream) {
      if (closed) break;
      write(`data: ${JSON.stringify(part)}\n\n`);
    }
    write("data: [DONE]\n\n");
    return res.end();
  } catch (err) {
    // Mid-stream errors still end with [DONE] so the client adapter closes cleanly.
    console.error("chat error:", err.message);
    // The adapter silently skips chunks without choices[].delta.content — an
    // error sent only as {"error":...} would be a BLANK reply in chat. Emit
    // visible assistant text (unless the client itself hung up).
    if (!closed && err.name !== "AbortError") {
      write(chunk(id, { content: `Upstream error: ${err.message}. Check the server console, your key, model id, or rate limits.` }));
    }
    write(`data: ${JSON.stringify({ error: { message: err.message } })}\n\n`);
    write("data: [DONE]\n\n");
    return res.end();
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

app.listen(PORT, () => {
  console.log(`gen_ui_exp server on http://localhost:${PORT}  (mode: ${liveMode ? "live" : "canned"}, model: ${MODEL})`);
});
