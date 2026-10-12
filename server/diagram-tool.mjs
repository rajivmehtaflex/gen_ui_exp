// The diagram-tool core: turn a model-authored diagram spec into a served
// artifact. Three pieces, nothing more — the tool declaration, prompt block,
// and chat wiring land in later tasks.
//
//   executeDiagramTool(rawArgs)  validate -> deliver (vendored CLI subprocess)
//                                -> artifactRegistry under a fresh UUID
//   registerArtifactRoutes(app)  GET /api/artifacts/:id serves registry HTML
//   artifactRegistry             in-memory Map<id, {title, type, html, hash}>
//
// Artifact ids live ONLY in the registry — they never touch the filesystem, so
// a bad or hostile id is always a plain 404.
import { spawn } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

// Repo root (this file is <repo>/server/diagram-tool.mjs). Resolved from this
// module's URL — not process.cwd() — so the subprocess cwd is right no matter
// where the server or tests are started from.
const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const CLI = path.join(REPO_ROOT, "server", "vendor", "diagramify", "bin", "diagramify.mjs");
const QUALITY = "showcase";
// A render spawns the CLI's own check-render-output pass, so this is generous;
// a hung subprocess must still not pin the server forever.
const SUBPROCESS_TIMEOUT_MS = 15_000;

// The CLI's diagram types (diagramify --help) — the same menu the model gets.
export const DIAGRAM_TYPES = Object.freeze([
  "architecture",
  "workflow",
  "sequence",
  "dataflow",
  "lifecycle",
  "explainer-steps",
]);

const promptExampleSpec = readFileSync(
  path.join(REPO_ROOT, "server", "examples", "diagrams", "prompt-example.architecture.json"),
  "utf8",
).trim();

export const diagramToolDeclaration = Object.freeze({
  type: "function",
  function: {
    name: "create_diagram",
    description: "Author an interactive, explorable diagram artifact. Read system prompt for authoring contract.",
    parameters: {
      type: "object",
      properties: {
        title: { type: "string", description: "Short descriptive title of the diagram" },
        type: { type: "string", enum: DIAGRAM_TYPES, description: "One of the 6 supported diagram types" },
        spec: { type: "object", description: "The complete diagramify JSON specification matching the type" },
      },
      required: ["title", "type", "spec"],
    },
  },
});

export const diagramPromptBlock = `
## Interactive Diagram Tool (create_diagram)

### CRITICAL INSTRUCTION ON INTERACTIVE DIAGRAMS
When the user asks for a rich, explorable, or interactive diagram (or asks for an architecture, dataflow, sequence, workflow, lifecycle, or explainer diagram):
1. YOU MUST INVOKE THE \`create_diagram\` TOOL. Do NOT output openui-lang code (never output \`root = Card(...)\`).
2. NEVER output mock cards or placeholder buttons like \`Button("Open Diagram")\`. The interactive diagram artifact is automatically rendered in an interactive viewer panel by the host platform.
3. If a tool call fails validation, inspect the diagnosed errors and invoke \`create_diagram\` again with the corrected spec (maximum 2 retries). Do NOT output plain text explanations when retrying.

### Diagram Types and Schemas

All diagrams share:
- \`schema_version\`: 1
- \`meta\`: \`{ "title": string, "quality_profile": "showcase" }\` (omit subtitle, legend, and visual_preset)
- Component \`type\` enum (where applicable): "frontend" | "backend" | "database" | "cloud" | "security" | "messagebus" | "external"
- Variant enum: "default" | "emphasis" | "security" | "dashed"

#### 1. architecture
System components, boundaries, services, deployments.
- \`diagram_type\`: "architecture"
- \`components\`: array of \`{ "id": string, "type": componentType, "label": string, "sublabel"?: string, "tier": integer (0..4), "col": integer (0..4), "tag"?: string }\`
- \`connections\`: array of \`{ "from": string, "to": string, "label"?: string, "variant"?: variant }\`

#### 2. dataflow
Data transformations, streaming pipelines, ETL stages, event ingestion.
- \`diagram_type\`: "dataflow"
- \`stages\`: array of 2 to 5 stage objects: \`[{ "label": string }, ...]\` (MUST be objects with "label", NEVER strings!).
- \`nodes\`: array of \`{ "id": string, "type": componentType, "label": string, "sublabel"?: string, "stage": integer (0-indexed integer corresponding to stages array, e.g. 0, 1, 2; NEVER string!), "row": integer (1-indexed row position >= 1, e.g. 1, 2; NEVER 0!), "tag"?: string }\`
- \`flows\`: array of \`{ "from": string, "to": string, "label": string, "classification"?: string, "variant"?: variant, "route"?: "auto" | "straight" | "bottom-channel" | "top-channel" }\`
*(CRITICAL: Use "flows", NOT "edges" or "connections". Use "nodes", NOT "components".)*

#### 3. sequence
Request lifecycles, protocol handshakes, distributed messaging.
- \`diagram_type\`: "sequence"
- \`participants\`: array of \`{ "id": string, "type": componentType, "label": string, "sublabel"?: string }\`
- \`messages\`: array of \`{ "id": string, "from": string, "to": string, "y": integer (increasing vertical coordinate >= 150, e.g. 180, 240, 300), "label": string, "variant"?: "default" | "emphasis" | "security" | "return" | "dashed" }\`
- \`activations\`?: array of \`{ "participant": string, "from": number, "to": number, "type"?: componentType }\`

#### 4. workflow
Business processes, human-in-the-loop flows, multi-stage procedures.
- \`diagram_type\`: "workflow"
- \`lanes\`: array of \`{ "id": string, "label": string, "variant"?: "normal" | "exception" }\`
- \`nodes\`: array of \`{ "id": string, "lane": string (lane id), "col": integer (0..5), "type": componentType, "label": string, "sublabel"?: string }\`
- \`edges\`: array of \`{ "from": string, "to": string, "label"?: string, "variant"?: variant }\`
*(CRITICAL: Use "edges".)*

#### 5. lifecycle
Entity states, state transitions, domain object phases.
- \`diagram_type\`: "lifecycle"
- \`lanes\`: array of 1 to 4 objects \`{ "id": string, "label": string }\`
- \`states\`: array of \`{ "id": string, "type": "start" | "active" | "waiting" | "decision" | "success" | "failure" | "neutral" | "external", "label": string, "sublabel"?: string, "lane": string (lane id), "col": integer (0..4), "tag"?: string }\`
- \`transitions\`: array of \`{ "from": string, "to": string, "label"?: string, "variant"?: variant, "route"?: "auto" | "straight" | "drop" | "bottom-channel" | "top-channel" }\`
*(CRITICAL: Use "transitions".)*

#### 6. explainer-steps
Multi-step conceptual walkthroughs, technical mechanics.
- \`diagram_type\`: "explainer-steps"
- \`steps\`: array of \`{ "id": string, "type": "start" | "active" | "waiting" | "decision" | "success" | "failure" | "neutral" | "external", "label": string, "sublabel"?: string, "description"?: string, "code"?: { "language": string, "content": string }, "math"?: string }\`

### Authoring Rules
1. Always generate valid diagramify JSON for the specified \`type\`.
2. Generate fresh unique ids for all components and connections.
3. Keep diagrams focused: <=12 primary nodes and one main flow path.
4. Set meta.quality_profile: "showcase".
5. Omit meta.subtitle, meta.legend, and meta.visual_preset.

### Canonical Example (architecture)
\`\`\`json
${promptExampleSpec}
\`\`\`
`.trim();

export function accumulateToolCalls(deltas) {
  if (!Array.isArray(deltas) || deltas.length === 0) return [];
  const map = new Map();
  for (const chunk of deltas) {
    if (!Array.isArray(chunk)) continue;
    for (const item of chunk) {
      if (item === null || typeof item !== "object") continue;
      const index = item.index ?? 0;
      let existing = map.get(index);
      if (!existing) {
        existing = { id: "", name: "", arguments: "" };
        map.set(index, existing);
      }
      if (item.id) existing.id = item.id;
      if (item.function?.name) existing.name = item.function.name;
      if (item.function?.arguments) existing.arguments += item.function.arguments;
    }
  }
  return Array.from(map.values());
}

export function assistantToolCallChunks({ id, name, arguments: args }, model = "diagram-model") {
  const timestamp = Math.floor(Date.now() / 1000);
  const chunkId = `chatcmpl-${Date.now().toString(36)}`;

  const chunk1 = `data: ${JSON.stringify({
    id: chunkId,
    object: "chat.completion.chunk",
    created: timestamp,
    model,
    choices: [
      {
        index: 0,
        delta: {
          role: "assistant",
          tool_calls: [
            {
              index: 0,
              id,
              type: "function",
              function: { name, arguments: "" },
            },
          ],
        },
        finish_reason: null,
      },
    ],
  })}\n\n`;

  const chunk2 = `data: ${JSON.stringify({
    id: chunkId,
    object: "chat.completion.chunk",
    created: timestamp,
    model,
    choices: [
      {
        index: 0,
        delta: {
          tool_calls: [
            {
              index: 0,
              function: { arguments: args },
            },
          ],
        },
        finish_reason: null,
      },
    ],
  })}\n\n`;

  const chunk3 = `data: ${JSON.stringify({
    id: chunkId,
    object: "chat.completion.chunk",
    created: timestamp,
    model,
    choices: [
      {
        index: 0,
        delta: {},
        finish_reason: "tool_calls",
      },
    ],
  })}\n\n`;

  return [chunk1, chunk2, chunk3];
}

export function toolResultChunk({ toolCallId, content }, model = "diagram-model") {
  const timestamp = Math.floor(Date.now() / 1000);
  const chunkId = `chatcmpl-${Date.now().toString(36)}`;
  return `data: ${JSON.stringify({
    id: chunkId,
    object: "chat.completion.chunk",
    created: timestamp,
    model,
    choices: [
      {
        index: 0,
        delta: {
          role: "tool",
          tool_call_id: toolCallId,
          content: typeof content === "string" ? content : JSON.stringify(content),
        },
        finish_reason: null,
      },
    ],
  })}\n\n`;
}

// id -> { title, type, html, hash }. Unbounded by design: this is a demo with
// no persistence, and later tasks decide the eviction story.
export const artifactRegistry = new Map();

// Executes one tool call. rawArgs is the JSON string the model produced.
// Never throws — every failure mode comes back as {ok:false, ...}.
export async function executeDiagramTool(rawArgs, signal = null) {
  let args;
  try {
    args = JSON.parse(typeof rawArgs === "string" ? rawArgs : String(rawArgs));
  } catch (err) {
    return { ok: false, error: `invalid JSON arguments: ${err.message}`, diagnostics: [] };
  }

  const shapeError = checkArgsShape(args);
  if (shapeError) return { ok: false, error: shapeError, diagnostics: [] };

  let dir;
  try {
    dir = mkdtempSync(path.join(tmpdir(), "diagram-tool-"));
    const specPath = path.join(dir, "spec.json");
    const htmlPath = path.join(dir, "artifact.html");
    writeFileSync(specPath, JSON.stringify(args.spec, null, 2));

    const validated = await runCli(["validate", args.type, specPath, "--quality", QUALITY, "--json"], signal);
    if (!validated.ok) return { ok: false, error: validated.error, diagnostics: validated.diagnostics };

    const delivered = await runCli(["deliver", args.type, specPath, htmlPath, "--quality", QUALITY, "--json"], signal);
    if (!delivered.ok) return { ok: false, error: delivered.error, diagnostics: delivered.diagnostics };

    const html = readFileSync(htmlPath, "utf8");
    const artifact = {
      title: args.title,
      type: args.type,
      html,
      hash: delivered.receipt?.artifact?.sha256 || createHash("sha256").update(html).digest("hex"),
    };
    const diagramId = randomUUID();
    artifactRegistry.set(diagramId, artifact);
    return { ok: true, diagramId, title: artifact.title, type: artifact.type };
  } catch (err) {
    // The contract is "never throws": a filesystem hiccup (temp dir, spec
    // write, artifact read) is still a failed tool call for the model to retry.
    return { ok: false, error: `diagram-tool error: ${err.message}`, diagnostics: [] };
  } finally {
    if (dir) rmSync(dir, { recursive: true, force: true });
  }
}

// Registers the artifact routes on an express app. Anything that is not a live
// registry id — including ids carrying "/", "\" or traversal — is a JSON 404.
export function registerArtifactRoutes(app) {
  const notFound = (_req, res) => res.status(404).json({ error: "artifact not found" });

  app.get("/api/artifacts/:id", (req, res) => {
    const id = req.params.id;
    if (typeof id !== "string" || id.length === 0 || id.includes("/") || id.includes("\\")) {
      return notFound(req, res);
    }
    const artifact = artifactRegistry.get(id);
    if (!artifact) return notFound(req, res);
    res.set({
      "Content-Type": "text/html; charset=utf-8",
      "x-content-type-options": "nosniff",
      "cache-control": "no-store",
    });
    return res.send(artifact.html);
  });

  // ":id" cannot match a path with a literal "/", so traversal-shaped ids
  // ("/api/artifacts/abc/def") land here — same JSON 404, no filesystem probe.
  app.get("/api/artifacts/*", notFound);
}

// --- internals ---------------------------------------------------------------

function checkArgsShape(args) {
  if (args === null || typeof args !== "object" || Array.isArray(args)) {
    return "arguments must be a JSON object";
  }
  if (typeof args.title !== "string" || args.title.trim().length === 0) {
    return 'arguments must include a non-empty "title" string';
  }
  if (!DIAGRAM_TYPES.includes(args.type)) {
    return `unknown diagram type ${JSON.stringify(args.type)} — expected one of: ${DIAGRAM_TYPES.join(", ")}`;
  }
  if (args.spec === null || typeof args.spec !== "object" || Array.isArray(args.spec)) {
    return 'arguments must include a "spec" object';
  }
  return null;
}

// Runs one diagramify command. Resolves {ok:true, receipt} or
// {ok:false, error, diagnostics} — the CLI prints its JSON receipt on stdout
// even when it fails, so real diagnostics survive.
function runCli(cliArgs, signal = null) {
  return new Promise((resolve) => {
    const command = cliArgs[0];
    if (signal?.aborted) {
      resolve({ ok: false, error: `diagramify ${command} aborted`, diagnostics: [] });
      return;
    }

    const child = spawn(process.execPath, [CLI, ...cliArgs], {
      cwd: REPO_ROOT,
      stdio: ["ignore", "pipe", "pipe"],
    });

    let stdout = "";
    let stderr = "";
    let timedOut = false;
    const timer = setTimeout(() => {
      timedOut = true;
      child.kill("SIGKILL");
    }, SUBPROCESS_TIMEOUT_MS);

    const onAbort = () => {
      child.kill("SIGKILL");
    };
    if (signal) {
      signal.addEventListener("abort", onAbort, { once: true });
    }

    child.stdout.on("data", (chunk) => { stdout += chunk; });
    child.stderr.on("data", (chunk) => { stderr += chunk; });

    child.on("error", (err) => {
      clearTimeout(timer);
      if (signal) signal.removeEventListener("abort", onAbort);
      resolve({ ok: false, error: `failed to run diagramify ${command}: ${err.message}`, diagnostics: [] });
    });

    child.on("close", (code) => {
      clearTimeout(timer);
      if (signal) signal.removeEventListener("abort", onAbort);
      if (signal?.aborted) {
        resolve({ ok: false, error: `diagramify ${command} aborted`, diagnostics: [] });
        return;
      }
      if (timedOut) {
        resolve({
          ok: false,
          error: `diagramify ${command} timed out after ${SUBPROCESS_TIMEOUT_MS}ms`,
          diagnostics: [],
        });
        return;
      }

      const receipt = parseJson(stdout);
      const diagnostics = Array.isArray(receipt?.diagnostics) ? receipt.diagnostics : [];
      if (code !== 0) {
        resolve({
          ok: false,
          error: receipt?.error || stderr.trim() || `diagramify ${command} exited with code ${code}`,
          diagnostics,
        });
        return;
      }
      if (receipt?.ok !== true) {
        resolve({
          ok: false,
          error: receipt?.error || `diagramify ${command} did not report a successful receipt`,
          diagnostics,
        });
        return;
      }
      resolve({ ok: true, receipt });
    });
  });
}

function parseJson(text) {
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}
