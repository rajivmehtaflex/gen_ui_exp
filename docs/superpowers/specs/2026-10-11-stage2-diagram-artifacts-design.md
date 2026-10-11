# Stage 2 — Interactive Diagram Artifacts (diagramify via app tool)

*Design spec · 2026-10-11 · gen_ui_exp · Status: approved design, awaiting implementation plan*

## Context

Phase #1 built a self-hosted GenUI hello-world (AgentInterface + openuiChatLibrary + OpenRouter). Stage 1 added 8 inline diagram components (Flow/Sequence/Explainer families) that render quick SVG sketches in the chat. Stage 2 completes the hybrid the user chose: when an ask deserves a **rich, explorable diagram** (themes, relationship tracing, pan/zoom, PNG/SVG/WebM export), the app now produces **diagramify-quality standalone HTML** through an application tool, delivered in AgentInterface's artifact workspace — the "display case" of the course's Stop 9.

Source of the idea and of the generation pipeline: the user's **diagramify** skill (MIT; typed-JSON spec → validated, self-contained interactive HTML; 6 types; CLI with `validate`/`deliver` and `--json` receipts). The upstream project is not published on npm under its real name (verified 404), so the pipeline is **vendored** into the repo.

## Decisions (locked in brainstorming)

| Decision | Choice |
|---|---|
| Spec authoring | The chat model authors the full diagramify JSON spec inside a `create_diagram` tool call; validation failures are fed back as tool errors (bounded correction loop, max 2 retries, then an honest error) |
| Types | All 6: `architecture`, `workflow`, `sequence`, `dataflow`, `lifecycle`, `explainer-steps` |
| Pipeline integration | **CLI subprocess** against the vendored, untouched folder (the CLI is diagramify's documented stable interface); MIT LICENSE + attribution retained |
| Tool result payload | Small reference `{ ok, diagramId, title, type }` — the ~700 KB HTML (which embeds the viewer runtime) is stored server-side and served from an endpoint; it never transits the chat stream |
| Artifact store | In-memory registry (consistent with in-memory threads); persistence is explicitly out of scope |
| Security | Sandboxed iframe (`allow-scripts`, no same-origin) pointing at the server endpoint; `nosniff` + `no-store` headers; generated HTML treated as untrusted per open-ended-html guidance |
| Stage 1 | Untouched — inline SVG components remain; a prompt block teaches the model when to use which |
| Keyless demo | Canned mode emits a pre-validated `create_diagram` tool call so the entire Stage 2 pipeline runs without an API key |

## Architecture & data flow

```
User: "diagram our deploy pipeline as an interactive architecture map"
 └─ model emits tool_call: create_diagram({ title, type, spec })
     └─ SERVER tool loop (live mode):
         1. spec → temp dir file
         2. node server/vendor/diagramify/bin/diagramify.mjs validate <type> <file> --quality showcase --json
              non-zero → tool result { ok:false, diagnostics } → model fixes spec (≤2 retries)
         3. node … deliver <type> <file> <artifact.html> --quality showcase --json
              → SHA-256 receipt; HTML moved into the in-memory registry
         4. tool result → { ok:true, diagramId, title, type }
     └─ tool call deltas + tool result forwarded to the browser (OpenAI-shaped SSE)
         └─ artifact renderer parses them → inline preview chip
              → actual view: sandboxed iframe → GET /api/artifacts/<diagramId>
GET /api/artifacts/<id> → text/html (nosniff, no-store) | 404 JSON
```

## Server design

**Tool declaration** (OpenAI `tools` entry): `create_diagram(title: string, type: enum[6], spec: object)` with a *light* parameter schema (`spec: object` + required keys only). The full authoring contract — per-type guidance, spec rules (fresh ids, ≤12 primary nodes, one main path, `meta.quality_profile: "showcase"`, omit `meta.subtitle`/`meta.legend`/`meta.visual_preset`), and ONE canonical example per the reliability guidance — is appended to the system prompt as a separate **"Diagram tool" block**, so non-diagram requests don't carry a giant JSON schema. Prompt-size delta measured and recorded. The block also teaches tool-vs-inline choice: interactive/explorable ask → tool; quick inline sketch → Stage 1 components.

**Tool loop** (live mode only): `client.chat.completions.create({ …, tools, stream: true })`; accumulate `delta.tool_calls` fragments (id/name/arguments); on `finish_reason === "tool_calls"`: execute the pipeline, append `assistant{tool_calls}` + `tool{tool_call_id, content}` messages, call again, continue streaming. All model deltas — including tool-call deltas — relay to the browser untouched; the executed tool result is emitted as an OpenAI-shaped tool-role chunk. Exact emission shape verified against the installed `openAIAdapter` source during implementation (it parses `delta.tool_calls` and tool-role messages → TOOL_CALL_START/ARGS/END/RESULT).

**Subprocess hygiene**: per-diagram temp dir under `os.tmpdir()`, removed in `finally`; 15 s kill timeout; non-zero exit → tool error carrying the validator's diagnostics JSON (model-correctable feedback).

**Artifact registry**: in-memory `Map<id, { title, type, html, hash, createdAt }>`, `id = crypto.randomUUID()`. Endpoints: `GET /api/artifacts/:id` → `200 text/html; charset=utf-8`, `X-Content-Type-Options: nosniff`, `Cache-Control: no-store`; miss → `404 {"error"}`. No auth (consistent with the app's no-auth posture; ids are capability URLs).

**Canned mode (keyless)**: streams a canned, pre-validated `create_diagram` tool call (sample spec validated through the real pipeline during implementation), executes the same loop, then a short closing assistant message — the full Stage 2 path works offline from the model.

## Client design

`src/artifacts/diagram-artifact.tsx` — `defineArtifactRenderer({ type: "diagram-html", toolName: "create_diagram", parser, preview, actual })`, created outside the React render cycle and passed via `AgentInterface.artifactRenderers`:

- **parser** handles all three paths (streaming partial args → preview-only `{ props }` with `meta: null`; completed result → authoritative `{ diagramId, title, type }` with `meta { id, version: 1, heading: title }`; stored reopen via `response` alone). Malformed input → `null`, never a throw.
- **preview** — a compact chip: `📊 {title} — open interactive diagram` (with a building indicator while streaming), wired to the `open` callback.
- **actual** — `<iframe src={`/api/artifacts/${id}`} sandbox="allow-scripts" title={title}>` filling the workspace panel. No `allow-same-origin`: the viewer is fully self-contained (inline CSS/JS), so a unique origin costs nothing and isolates it per the open-ended-html security rules.

## Prompt & reliability

- New system-prompt block (see Server): tool-vs-inline guidance, 6 types with one-line "when", authoring rules, and **one** canonical example in the prompt (prompt-size discipline) — **validated through the real pipeline before adoption**. The 6 bundled example specs under `server/examples/diagrams/` are validation fixtures for `check-diagram.mjs` (one per type); the canned demo reuses one of them.
- Correction-loop rule stated to the model: fix only the diagnosed subject per retry, ≤2 attempts, then report the failure honestly to the user.
- Baseline: `scripts/live-diagram-smoke.mjs` — N runs of an interactive-diagram prompt; counts tool-call rate, validation passes, receipt/GET agreement (`200 text/html`, byte-identical hash). No tuning from single runs (Stop-10 rule).

## Testing & verification

| Gate | Asserts |
|---|---|
| `scripts/check-diagram.mjs` | the 6 bundled example specs (one per type) pass the vendored CLI's showcase validation — keeps the vendor honest in every battery run |
| `scripts/test-artifact-renderer.mjs` | renderToString: parser accepts final result + streaming partial + stored reopen; rejects malformed; preview/actual render |
| canned e2e (keyless) | prompt with a diagram keyword → tool call → real validate+deliver → tool result → GET /api/artifacts/:id = 200 html |
| `scripts/live-diagram-smoke.mjs` | live baseline (N×runs): tool-call success, validation passes, receipt agreement |
| existing battery | check:spec / check:recipe / check:examples / test:library / test:layout / test-diagram-render / test-error-visibility / build — all stay green |

## File layout

```
server/vendor/diagramify/        vendored runtime (bin, renderers, schemas, assets, brand-marks, delta,
                                 examples as fixtures, LICENSE, README) — untouched tree
server/diagram-tool.mjs          tool declaration + prompt block + subprocess validate/deliver + registry
server/chat.mjs                  modified: tool loop (live), canned diagram demo (keyless)
src/artifacts/diagram-artifact.tsx   defineArtifactRenderer (parser/preview/actual)
src/App.tsx                      modified: artifactRenderers=[diagramArtifactRenderer]
scripts/check-diagram.mjs        6 example specs × showcase validation
scripts/test-artifact-renderer.mjs   renderer contract tests
scripts/live-diagram-smoke.mjs   live tool-loop baseline
server/examples/diagrams/*.json  bundled example specs (also canned-demo source)
RUNBOOK.md                       modified: Stage 2 section (usage, gates, troubleshooting)
```

## Out of scope (§6, confirmed)

Artifact persistence (`ChatStorage.artifact`) · editing/versioning (`update_diagram`) · authentication · diagramify `visual-check` (needs Chrome; runs on the user's machine) · inline-vs-tool auto-tuning beyond the first prompt pass · artifact list UI customization. The viewer's built-in exports (PNG/SVG/WebM) and themes come free inside the vendored HTML.

## Risks / notes

- **Tool-loop wire shape**: the exact tool-result chunk shape the adapter expects is verified against installed source before the loop is built (fallback: hand-rolled ChatLLM, the Phase-1 documented fallback).
- **Prompt growth**: the Diagram-tool block adds bytes to every request; measured, recorded; trim lever = the example, never the schema.
- **Free-tier model + big tool args**: spec authoring inside tool arguments is the likeliest failure point; the correction loop is the designed answer, and its behavior is what the baseline measures.
- **Vendored tree integrity**: `check-diagram.mjs` exercises the vendored CLI in every battery run, so a broken vendor fails loudly.
