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
import { createHash, randomUUID } from "node:crypto";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { DIAGRAM_TYPES } from "./diagram-policy.mjs";
import { runProcessTree } from "./process-runner.mjs";
export { DIAGRAM_TYPES } from "./diagram-policy.mjs";

// Repo root (this file is <repo>/server/diagram-tool.mjs). Resolved from this
// module's URL — not process.cwd() — so the subprocess cwd is right no matter
// where the server or tests are started from.
const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const CLI = path.join(REPO_ROOT, "server", "vendor", "diagramify", "bin", "diagramify.mjs");
const QUALITY = "showcase";
// A render spawns the CLI's own check-render-output pass, so this is generous;
// a hung subprocess must still not pin the server forever.
const SUBPROCESS_TIMEOUT_MS = 15_000;

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

### Hybrid routing
An explicit inline diagram request takes precedence over interactive wording. Inline labels and inline code examples are content details; they do not change an explicitly interactive diagram request. Render inline diagrams with the browser library's FlowDiagram, SequenceDiagram, or StepExplainer components as appropriate. For an explicit interactive, explorable, artifact, or diagramify diagram request, invoke \`create_diagram\`; the host displays the resulting artifact. For an ordinary sketch or diagram request, choose the representation that best serves the user. Ordinary non-diagram chat needs no diagram tool.
If a tool call fails validation, inspect the diagnostics and retry the corrected spec at most twice.

### Diagram Types and Schemas

All diagrams share:
- \`schema_version\`: 1
- \`meta\`: \`{ "title": string, "quality_profile": "showcase" }\` (omit subtitle, legend, and visual_preset)
- Component \`type\` enum (where applicable): "frontend" | "backend" | "database" | "cloud" | "security" | "messagebus" | "external"
- Variant enum: "default" | "emphasis" | "security" | "dashed"

#### 1. architecture
System components, boundaries, services, deployments.
- \`diagram_type\`: "architecture"
- \`components\`: at least one \`{ "id": string, "type": componentType, "label": string, "sublabel"?: string, "tag"?: string, "pos"?: [x, y], "size"?: [width, height], "row"?: integer >= 0, "col"?: integer >= 0 }\`. For manual placement, give each component \`pos\` (and optionally \`size\`). For automatic placement, set \`layout.mode\` to \`"grid"\` and place components with \`row\` and \`col\` (both zero-based). Do not use manual and grid placement on the same component.
- \`connections\`: array of \`{ "from": string, "to": string, "label"?: string, "variant"?: variant }\`

#### 2. dataflow
Data transformations, streaming pipelines, ETL stages, event ingestion.
- \`diagram_type\`: "dataflow"
- \`stages\`: array of 2 to 5 stage objects: \`[{ "label": string }, ...]\` (MUST be objects with "label", NEVER strings!).
- \`nodes\`: at least two \`{ "id": string, "type": componentType, "label": string, "sublabel"?: string, "stage": integer (zero-based index into stages), "row": integer >= 0, "tag"?: string }\`
- \`flows\`: array of \`{ "from": string, "to": string, "label": string, "classification"?: string, "variant"?: variant, "route"?: "auto" | "straight" | "bottom-channel" | "top-channel" }\`
*(CRITICAL: Use "flows", NOT "edges" or "connections". Use "nodes", NOT "components".)*

#### 3. sequence
Request lifecycles, protocol handshakes, distributed messaging.
- \`diagram_type\`: "sequence"
- \`participants\`: at least two \`{ "id": string, "type": componentType, "label": string, "sublabel"?: string }\`
- \`messages\`: at least one \`{ "id"?: string, "from": string, "to": string, "y": number (increasing vertical coordinate >= 160), "label": string, "variant"?: "default" | "emphasis" | "security" | "return" | "dashed" }\`
- \`activations\`?: array of \`{ "participant": string, "from": number, "to": number, "type"?: componentType }\`

#### 4. workflow
Business processes, human-in-the-loop flows, multi-stage procedures.
- \`diagram_type\`: "workflow"
- \`lanes\`: at least one \`{ "id": string, "label": string, "variant"?: "normal" | "exception" }\`
- \`nodes\`: at least one \`{ "id": string, "lane": string (lane id), "col": integer (0..5), "type": componentType, "label": string, "sublabel"?: string }\`
- \`edges\`: array of \`{ "from": string, "to": string, "label"?: string, "variant"?: variant }\`
*(CRITICAL: Use "edges".)*

#### 5. lifecycle
Entity states, state transitions, domain object phases.
- \`diagram_type\`: "lifecycle"
- \`lanes\`: array of 1 to 4 objects \`{ "id": string, "label": string }\`; include lane id \`"main"\` for the phase rail, optionally \`"terminal"\` for outcomes.
- \`states\`: at least two \`{ "id": string, "type": "start" | "active" | "waiting" | "decision" | "success" | "failure" | "neutral" | "external", "label": string, "sublabel"?: string, "lane": string (lane id), "col": integer (0..4), "tag"?: string }\`
- \`transitions\`: array of \`{ "from": string, "to": string, "label"?: string, "variant"?: variant, "route"?: "auto" | "straight" | "drop" | "bottom-channel" | "top-channel" }\`
*(CRITICAL: Use "transitions".)*

#### 6. explainer-steps
Multi-step conceptual walkthroughs, technical mechanics.
- \`diagram_type\`: "explainer-steps"
- \`steps\`: at least two \`{ "id": string, "type": "start" | "active" | "waiting" | "decision" | "success" | "failure" | "neutral" | "external", "label": string (1..60 chars), "sublabel"?: string (max 80), "description"?: string (max 320), "code"?: { "language"?: string (max 24), "content": string (max 600) }, "math"?: string (max 200) }\`

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
        existing = { index, id: "", name: "", arguments: "" };
        map.set(index, existing);
      }
      if (item.id) existing.id = item.id;
      if (item.function?.name) existing.name = item.function.name;
      if (item.function?.arguments) existing.arguments += item.function.arguments;
    }
  }
  return Array.from(map.values());
}

export function assistantToolCallChunks({ id, name, arguments: args, index = 0 }, model = "diagram-model") {
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
              index,
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
              index,
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
export async function executeDiagramTool(rawArgs, signal = null, { cleanupTempDir = rmSync } = {}) {
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

    const validated = await runCli(["validate", args.type, specPath, "--quality", QUALITY, "--json"], signal, dir);
    if (!validated.ok) return { ok: false, error: validated.error, diagnostics: validated.diagnostics };

    const delivered = await runCli(["deliver", args.type, specPath, htmlPath, "--quality", QUALITY, "--json"], signal, dir);
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
    if (dir) {
      try { cleanupTempDir(dir, { recursive: true, force: true }); }
      catch (error) { console.error(`diagram-tool cleanup failed for ${dir}: ${error.message}`); }
    }
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
async function runCli(cliArgs, signal = null, tempRoot) {
  const command = cliArgs[0];
  const run = await runProcessTree({
    file: process.execPath,
    args: [CLI, ...cliArgs],
    cwd: REPO_ROOT,
    signal,
    timeoutMs: SUBPROCESS_TIMEOUT_MS,
    maxOutputBytes: 1024 * 1024,
    // The vendored validator stages files in os.tmpdir(). Keep those files
    // under this job so an abort cannot leave its staging directory behind.
    env: { ...process.env, TMPDIR: tempRoot, TMP: tempRoot, TEMP: tempRoot },
  });
  if (!run.ok && /abort|timed out|output exceeded/i.test(run.error || "")) {
    return { ok: false, error: `diagramify ${command} ${run.error}`, diagnostics: [] };
  }
  const receipt = parseJson(run.stdout);
  const diagnostics = Array.isArray(receipt?.diagnostics) ? receipt.diagnostics : [];
  if (!run.ok) {
    return { ok: false, error: receipt?.error || run.stderr.trim() || run.error, diagnostics };
  }
  if (receipt?.ok !== true) {
    return { ok: false,
      error: receipt?.error || `diagramify ${command} did not report a successful receipt`, diagnostics };
  }
  return { ok: true, receipt };
}

function parseJson(text) {
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}
