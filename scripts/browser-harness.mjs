import express from "express";
import { createServer } from "vite";
import { registerArtifactRoutes } from "../server/diagram-tool.mjs";

const clientModule = `
import React from "react";
import { createRoot } from "react-dom/client";
import { DiagramArtifactView } from "/src/artifacts/diagram-artifact-view.tsx";
const root = createRoot(document.getElementById("artifact-root"));
window.setArtifactProps = (props) => root.render(React.createElement(DiagramArtifactView, props));
window.artifactHarnessReady = true;
`;

const hostClientModule = `
import React from "react";
import { createRoot } from "react-dom/client";
import App from "/src/App.tsx";
createRoot(document.getElementById("artifact-root")).render(React.createElement(App));
window.artifactHostReady = true;
`;

function chatChunk(delta, finishReason = null) {
  return `data: ${JSON.stringify({
    id: "artifact-host-chat",
    object: "chat.completion.chunk",
    created: Math.floor(Date.now() / 1000),
    model: "artifact-host-test",
    choices: [{ index: 0, delta, finish_reason: finishReason }],
  })}\n\n`;
}

export async function startArtifactBrowserHarness() {
  const api = express();
  let hostChatFixture = null;
  api.use(express.json({ limit: "1mb" }));
  registerArtifactRoutes(api);
  api.post("/api/chat", (_req, res) => {
    if (!hostChatFixture) return res.status(500).json({ error: "host chat fixture is not configured" });
    const toolCallId = "artifact-host-tool-call";
    const { args, result } = hostChatFixture;
    res.setHeader("content-type", "text/event-stream; charset=utf-8");
    res.setHeader("cache-control", "no-cache, no-transform");
    res.setHeader("connection", "keep-alive");
    res.write(chatChunk({
      role: "assistant",
      tool_calls: [{
        index: 0,
        id: toolCallId,
        type: "function",
        function: {
          name: "create_diagram",
          arguments: typeof args === "string" ? args : JSON.stringify(args),
        },
      }],
    }));
    res.write(chatChunk({}, "tool_calls"));
    res.write(chatChunk({ role: "tool", tool_call_id: toolCallId, content: JSON.stringify(result) }));
    res.write(chatChunk({ role: "assistant", content: "I created the requested artifact." }));
    res.write(chatChunk({}, "stop"));
    res.end("data: [DONE]\n\n");
  });
  const vite = await createServer({
    configFile: false,
    server: { middlewareMode: true },
    plugins: [{
      name: "artifact-panel-harness",
      resolveId(id) {
        if (id === "/__artifact_panel_client.js" || id === "/__artifact_host_client.js") return id;
      },
      load(id) {
        if (id === "/__artifact_panel_client.js") return clientModule;
        if (id === "/__artifact_host_client.js") return hostClientModule;
      },
      configureServer(server) {
        server.middlewares.use(api);
        server.middlewares.use("/__artifact_panel", (_req, res) => {
          res.setHeader("content-type", "text/html; charset=utf-8");
          res.end('<!doctype html><html><body><div id="artifact-root"></div><script type="module" src="/__artifact_panel_client.js"></script></body></html>');
        });
        server.middlewares.use("/__artifact_host", (_req, res) => {
          res.setHeader("content-type", "text/html; charset=utf-8");
          res.end('<!doctype html><html><body><div id="artifact-root"></div><script type="module" src="/__artifact_host_client.js"></script></body></html>');
        });
      },
    }],
  });
  const server = express();
  server.use(vite.middlewares);
  const listener = await new Promise((resolve) => {
    const value = server.listen(0, "127.0.0.1", () => resolve(value));
  });
  return {
    baseUrl: `http://127.0.0.1:${listener.address().port}`,
    setHostChatFixture(fixture) { hostChatFixture = fixture; },
    async close() {
      await vite.close();
      await new Promise((resolve) => listener.close(resolve));
    },
  };
}
