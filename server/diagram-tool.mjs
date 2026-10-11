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

// id -> { title, type, html, hash }. Unbounded by design: this is a demo with
// no persistence, and later tasks decide the eviction story.
export const artifactRegistry = new Map();

// Executes one tool call. rawArgs is the JSON string the model produced.
// Never throws — every failure mode comes back as {ok:false, ...}.
export async function executeDiagramTool(rawArgs) {
  let args;
  try {
    args = JSON.parse(typeof rawArgs === "string" ? rawArgs : String(rawArgs));
  } catch (err) {
    return { ok: false, error: `invalid JSON arguments: ${err.message}`, diagnostics: [] };
  }

  const shapeError = checkArgsShape(args);
  if (shapeError) return { ok: false, error: shapeError, diagnostics: [] };

  const dir = mkdtempSync(path.join(tmpdir(), "diagram-tool-"));
  try {
    const specPath = path.join(dir, "spec.json");
    const htmlPath = path.join(dir, "artifact.html");
    writeFileSync(specPath, JSON.stringify(args.spec, null, 2));

    const validated = await runCli(["validate", args.type, specPath, "--quality", QUALITY, "--json"]);
    if (!validated.ok) return { ok: false, error: validated.error, diagnostics: validated.diagnostics };

    const delivered = await runCli(["deliver", args.type, specPath, htmlPath, "--quality", QUALITY, "--json"]);
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
  } finally {
    rmSync(dir, { recursive: true, force: true });
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
function runCli(cliArgs) {
  return new Promise((resolve) => {
    const command = cliArgs[0];
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

    child.stdout.on("data", (chunk) => { stdout += chunk; });
    child.stderr.on("data", (chunk) => { stderr += chunk; });

    child.on("error", (err) => {
      clearTimeout(timer);
      resolve({ ok: false, error: `failed to run diagramify ${command}: ${err.message}`, diagnostics: [] });
    });

    child.on("close", (code) => {
      clearTimeout(timer);
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
