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

export async function startArtifactBrowserHarness() {
  const api = express();
  registerArtifactRoutes(api);
  const vite = await createServer({
    configFile: false,
    server: { middlewareMode: true },
    plugins: [{
      name: "artifact-panel-harness",
      resolveId(id) { if (id === "/__artifact_panel_client.js") return id; },
      load(id) { if (id === "/__artifact_panel_client.js") return clientModule; },
      configureServer(server) {
        server.middlewares.use(api);
        server.middlewares.use("/__artifact_panel", (_req, res) => {
          res.setHeader("content-type", "text/html; charset=utf-8");
          res.end('<!doctype html><html><body><div id="artifact-root"></div><script type="module" src="/__artifact_panel_client.js"></script></body></html>');
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
    async close() {
      await vite.close();
      await new Promise((resolve) => listener.close(resolve));
    },
  };
}
