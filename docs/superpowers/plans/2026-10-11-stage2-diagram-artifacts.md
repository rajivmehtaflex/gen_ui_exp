# Stage 2 — Interactive Diagram Artifacts Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** When a user asks for an interactive diagram, the chat model authors a diagramify JSON spec inside a `create_diagram` tool call; the server validates + delivers it through the vendored diagramify CLI and serves the interactive HTML to a sandboxed iframe in AgentInterface's artifact workspace.

**Architecture:** Server-side tool loop over the existing OpenAI-shaped SSE relay (declare tool → accumulate tool_call fragments → execute validate+deliver subprocess → feed result back / forward to browser). Artifact content stays server-side in an in-memory registry; the chat carries only a small reference; the client renders `GET /api/artifacts/:id` in a sandboxed iframe via `defineArtifactRenderer`.

**Tech Stack:** Express + `openai` SDK streaming (existing), vendored diagramify CLI (MIT, `ajv` runtime dep), `defineArtifactRenderer` from `@openuidev/react-ui@0.16.3`, plain `node:assert` test scripts under `tsx`/`node`.

**Spec:** `docs/superpowers/specs/2026-10-11-stage2-diagram-artifacts-design.md`

## Global Constraints

- API key and provider traffic stay server-side; the browser only ever sees our SSE and `/api/artifacts/:id`.
- Correction loop bounded: **max 2** failed `create_diagram` attempts fed back, then an honest failure to the user.
- Tool result payload is a **reference only** — diagram HTML never enters the chat stream.
- iframe: `sandbox="allow-scripts"` — **no** `allow-same-origin`.
- All 6 types accepted: `architecture | workflow | sequence | dataflow | lifecycle | explainer-steps`.
- Vendored tree under `server/vendor/diagramify/` stays untouched (upstream diffs stay trivial); LICENSE + README retained; `ajv@^8.17.1` added to our `dependencies` (runtime dep of the vendored validator).
- Validation quality bar: `--quality showcase` on every validate/deliver.
- The existing battery (check:spec, check:recipe, check:examples, test:library, test:layout, test-diagram-render, test-error-visibility, `npm run build`) stays green after every task.

## Review Focus

1. **Crafted artifact ids** (`/api/artifacts/../../etc`, url-encoded traversal, random uuids) → must 404 cleanly, never read files. Pinned in Task 2 (traversal + unknown-id tests).
2. **Unparseable/oversized tool arguments** (model emits broken JSON or a 1 MB spec) → tool result `ok:false`, no server crash, loop continues. Pinned in Task 2 (garbage-args test).
3. **Client disconnect mid-deliver** → subprocess killed, no orphan `diagramify` processes. Pinned in Task 5 (abort verification step).
4. **Model answers without calling the tool** → loop exits after round 1, normal chat unaffected. Pinned in Task 5 (existing `test-error-visibility` + live smoke on a non-diagram prompt).
5. **Broken/stale vendored CLI** → every battery run fails loudly at `check:diagram` instead of mysteriously at chat time. Pinned in Task 1 (the gate itself).

---

### Task 1: Vendor diagramify + example fixtures + `check:diagram` gate

**Files:**
- Create: `server/vendor/diagramify/` (copied from the diagramify skill folder)
- Create: `server/examples/diagrams/*.json` (6 type fixtures + `prompt-example.architecture.json`)
- Create: `scripts/check-diagram.mjs`
- Modify: `package.json` (add `ajv: ^8.17.1` to dependencies; script `check:diagram`)

**Interfaces:**
- Produces: a working CLI at `server/vendor/diagramify/bin/diagramify.mjs` (`validate <type> <spec.json> --quality showcase --json`, `deliver <type> <spec.json> <out.html> --quality showcase --json`, exit 0 = pass, `--json` receipt on stdout); fixture specs at `server/examples/diagrams/{architecture,workflow,sequence,dataflow,lifecycle,explainer-steps}.json` + `prompt-example.architecture.json`; npm script `check:diagram`.

- [ ] **Step 1: Write the failing gate** — `scripts/check-diagram.mjs`: for each of the 7 spec files (6 fixtures + prompt example), run `node server/vendor/diagramify/bin/diagramify.mjs validate <type> <file> --quality showcase --json`; fail (exit 1, listing failures) if the vendor folder is missing, any subprocess exits non-zero, or any receipt reports errors/warnings.

- [ ] **Step 2: Run it to verify RED** — `node scripts/check-diagram.mjs` → fails: vendor folder missing.

- [ ] **Step 3: Vendor + install + fixtures** — copy the skill folder to `server/vendor/diagramify/` excluding `test/`, `package-lock.json`, `node_modules`, rendered HTML under `examples/` (keep the `.json` specs); copy the 6 `.json` specs to `server/examples/diagrams/<type>.json` (names matching their type); `npm i ajv@^8.17.1`. Author `prompt-example.architecture.json`: start from the vendored architecture example, shrink to ≤5 nodes / ≤5 edges, iterate `validate` until it exits 0 with 0 errors AND 0 warnings (showcase).

- [ ] **Step 4: Run gate to verify GREEN** — `npm run check:diagram` (add to package.json) → `7/7 specs pass showcase validation`.

- [ ] **Step 5: Commit** — `feat(vendor): diagramify pipeline + example fixtures + check:diagram gate`

### Task 2: `diagram-tool` core — execute, registry, artifact endpoint

**Files:**
- Create: `server/diagram-tool.mjs`
- Create: `scripts/test-diagram-tool.mjs`

**Interfaces:**
- Consumes: Task 1 CLI + fixtures.
- Produces: `executeDiagramTool(rawArgs: string) => Promise<{ok:true, diagramId, title, type} | {ok:false, error, diagnostics}>`; `registerArtifactRoutes(app)` (Express); `artifactRegistry` (Map); `DIAGRAM_TYPES` (const array of 6); `diagramToolDeclaration` placeholder only if trivial — declaration itself lands in Task 3.

- [ ] **Step 1: Write failing tests** — `scripts/test-diagram-tool.mjs` (plain `node:assert`, spins a minimal express app on an ephemeral port):
  - valid fixture spec (read `server/examples/diagrams/architecture.json`, args `{title:"Test diagram", type:"architecture", spec:<fixture>}`) → `ok:true`, `diagramId` present, registry has `{title, type, html, hash}`; `GET /api/artifacts/<id>` → 200, `content-type` contains `text/html`, body contains `<!doctype html` or `<html`, headers include `x-content-type-options: nosniff` and `cache-control: no-store`.
  - `executeDiagramTool("not json")` → `ok:false` with `error`, no throw.
  - `executeDiagramTool('{"title":"x","type":"nope","spec":{}}')` (invalid type) → `ok:false`.
  - `GET /api/artifacts/does-not-exist` → 404 JSON; `GET /api/artifacts/..%2F..%2Fpackage.json` and `/api/artifacts/<id-with-slash>` → 404 (no file read).

- [ ] **Step 2: Run to verify RED** — module missing.

- [ ] **Step 3: Implement `server/diagram-tool.mjs`** — `executeDiagramTool`: parse+shape-check args (title string, type ∈ DIAGRAM_TYPES, spec object) → temp dir (`os.tmpdir()`) → write spec → spawn `node server/vendor/diagramify/bin/diagramify.mjs validate …` (15 s kill timeout) → non-zero: return `ok:false` + parsed diagnostics → `deliver` to `<tmp>/artifact.html` → read HTML + move into `artifactRegistry` under `crypto.randomUUID()` → cleanup temp dir in `finally` → `{ok:true, …}`. `registerArtifactRoutes`: GET `:id` serves registry HTML with `content-type: text/html; charset=utf-8`, `x-content-type-options: nosniff`, `cache-control: no-store`; anything not in the registry → 404 JSON (ids never touch the filesystem).

- [ ] **Step 4: Run to verify GREEN** — all test cases pass.

- [ ] **Step 5: Commit** — `feat(diagram-tool): validate+deliver subprocess, artifact registry, GET endpoint`

### Task 3: Tool declaration, prompt block, tool-call accumulator

**Files:**
- Modify: `server/diagram-tool.mjs`
- Modify: `scripts/test-diagram-tool.mjs`

**Interfaces:**
- Produces: `diagramToolDeclaration` (OpenAI `tools` entry: `create_diagram(title: string, type: enum DIAGRAM_TYPES, spec: object)` — light schema, description pointing to the system-prompt contract); `diagramPromptBlock` (string: tool-vs-inline guidance, 6 types with one-line "when", authoring rules — fresh ids, ≤12 primary nodes, one main path, `meta.quality_profile: "showcase"`, omit `meta.subtitle`/`meta.legend`/`meta.visual_preset`, correction etiquette ≤2 — plus the JSON of `prompt-example.architecture.json` inlined at module load); `accumulateToolCalls(deltas) => [{id, name, arguments}]` (pure: merges OpenAI streamed `delta.tool_calls` fragments by `index`, concatenating `arguments`).

- [ ] **Step 1: Write failing tests** — accumulator: fragments split across 3 chunks (id/name on first, argument halves after) merge into one call with the full arguments string; two parallel calls (index 0/1) stay separate; empty input → `[]`. Declaration: `function.name === "create_diagram"`, enum has exactly the 6 types. Prompt block: contains "create_diagram", all 6 type names, "showcase", and the inlined example's title.

- [ ] **Step 2: RED** — properties missing.

- [ ] **Step 3: Implement** — declaration + block (block text per spec §Prompt) + accumulator as a pure exported function.

- [ ] **Step 4: GREEN** — all pass.

- [ ] **Step 5: Commit** — `feat(diagram-tool): tool declaration, authoring prompt block, tool-call accumulator`

### Task 4: Browser wire shape pinned through the real adapter

**Files:**
- Modify: `server/diagram-tool.mjs` (emit helpers)
- Create: `scripts/test-tool-wire.mjs`

**Interfaces:**
- Produces: `assistantToolCallChunks({id, name, arguments}, model) => string[]` (SSE `data:` lines whose `choices[0].delta.tool_calls` fragments accumulate to the call, ending with a `finish_reason:"tool_calls"` chunk) and `toolResultChunk({toolCallId, content}, model) => string` (SSE `data:` line carrying the tool result in the shape the installed adapter parses). Both also used by canned mode.

- [ ] **Step 1: Read the adapter source first** — `node_modules/@openuidev/react-headless/dist/index.mjs` tool-call parsing (≈ lines 1490–1540 and 1600–1630: how `delta.tool_calls` fragments map to TOOL_CALL_START/ARGS/END and how a tool result is recognized, including the exact `delta` fields it expects, e.g. `role:"tool"`, `tool_call_id`, `content`). Note the exact shape in the test as constants.

- [ ] **Step 2: Write the failing test** — `scripts/test-tool-wire.mjs`: import `openAIAdapter` from `@openuidev/react-headless`; build the SSE line list from the two emitters; feed the lines through the adapter's parser (the same line-iterator entry the browser uses); assert the emitted events include TOOL_CALL_START, TOOL_CALL_ARGS, TOOL_CALL_END and the tool result arrives with our `content` (function-call id matches). RED: emitters don't exist.

- [ ] **Step 3: Implement the emitters** — chunk builders matching the shape read in Step 1 (assistant fragments: `delta.tool_calls[{index:0, id, type:"function", function:{name, arguments}}]`; finish chunk; result chunk per adapter's expectation).

- [ ] **Step 4: GREEN** — adapter emits the full event sequence from our bytes.

- [ ] **Step 5: Commit** — `feat(diagram-tool): adapter-pinned tool-call and tool-result SSE emitters`

### Task 5: Live tool loop in `chat.mjs` + retry bound + abort hygiene

**Files:**
- Modify: `server/chat.mjs`
- Modify: `server/diagram-tool.mjs` (if loop needs a small helper — e.g. executing with abort signal)

**Interfaces:**
- Consumes: Tasks 2–4 exports.
- Produces: live-mode behavior — requests may trigger up to 3 model rounds (initial + 2 tool corrections); client-visible stream = model deltas (relayed untouched) + our tool-call/result chunks; `req.on("close")` abort also kills any running vendored subprocess.

- [ ] **Step 1: Implement the loop** — in live mode: `tools: [diagramToolDeclaration]`; accumulate fragments while relaying deltas verbatim; on `finish_reason:"tool_calls"`: emit finish + result chunks, append messages, re-call (max 3 rounds total). After bound: stream an honest assistant text ("I couldn't produce a valid diagram — <first validator error>") and stop. Non-diagram replies never enter the loop path.

- [ ] **Step 2: Abort hygiene** — thread the request `AbortSignal` into the subprocess spawn; on client close the child is killed.

- [ ] **Step 3: Verify** — `npm run build` clean; `node scripts/test-error-visibility.mjs` → 2/2 (loop changes must not affect the upstream-error path); live with the real key: send *"Diagram our deploy pipeline as an interactive architecture map"* → server log shows validate OK + deliver receipt; `curl -s localhost:8787/api/artifacts/<id-from-result> -o /dev/null -w "%{http_code} %{content_type}"` → `200 text/html`; abort check: `curl -s -m 2 -N -X POST …` with the same prompt → no orphan `server/vendor/diagramify` process afterward (`pgrep -af diagramify` empty).

- [ ] **Step 4: Commit** — `feat(chat): live create_diagram tool loop with bounded correction and abort hygiene`

### Task 6: Keyless canned tool-flow demo

**Files:**
- Modify: `server/canned-recipe.mjs`, `server/chat.mjs` (canned branch)

**Interfaces:**
- Consumes: Task 4 emitters; Task 2 executor. Produces: canned mode routes `/interactive|explorable/` prompts to a canned `create_diagram` flow: assistant tool-call chunks (spec = `server/examples/diagrams/prompt-example.architecture.json` content) → **real** `executeDiagramTool` → result chunk → short closing assistant text → `[DONE]`. Existing keyword routes unchanged.

- [ ] **Step 1: Implement** the canned branch using the Task 4 emitters + Task 2 executor (no model involved).

- [ ] **Step 2: Verify keyless e2e** — `OPENROUTER_API_KEY= PORT=8790 node server/chat.mjs` → `curl -s -N -X POST localhost:8790/api/chat -d '{"messages":[{"role":"user","content":"build an interactive diagram of a deploy pipeline"}]}'` → SSE contains `create_diagram` args and a tool result with `diagramId`; `GET /api/artifacts/<id>` → 200 html. Existing canned routes (flow/sequence/explainer/hello) still work (spot-check one).

- [ ] **Step 3: Commit** — `feat(canned): keyless create_diagram tool-flow demo`

### Task 7: Artifact renderer + App wiring

**Files:**
- Create: `src/artifacts/diagram-artifact.tsx`
- Modify: `src/App.tsx`
- Create: `scripts/test-artifact-renderer.mjs`

**Interfaces:**
- Consumes: tool result shape `{ok, diagramId, title, type}`.
- Produces: `diagramArtifactRenderer` registered in `App.tsx` via `AgentInterface.artifactRenderers`.

- [ ] **Step 1: Write failing tests** — `scripts/test-artifact-renderer.mjs` (renderToString, plain asserts):
  - parser on final result `{ok:true, diagramId:"d1", title:"Deploy", type:"architecture"}` → props carry `diagramId`/`title`, meta `{id:"d1", version:1, heading:"Deploy"}`.
  - parser on partial streaming args (`{"title":"Dep` ) → non-null props only if a title is present, `meta:null`; on unparseable → `null`, no throw.
  - parser on stored reopen (`args === undefined`, `response` = same JSON) → same as final.
  - actual renders an `<iframe>` with `src="/api/artifacts/d1"` and `sandbox` attr that does **not** contain `allow-same-origin`.
  - preview renders the title text.

- [ ] **Step 2: RED** — module missing.

- [ ] **Step 3: Implement** `diagram-artifact.tsx` per the artifacts reference (defineArtifactRenderer outside render; parser tolerant on all three paths; preview chip with `open` callback + building indicator; actual iframe).

- [ ] **Step 4: GREEN + wire** — tests pass; `App.tsx` passes `artifactRenderers={[diagramArtifactRenderer]}`; `npm run build` clean.

- [ ] **Step 5: Commit** — `feat(artifacts): diagram artifact renderer with sandboxed iframe + App wiring`

### Task 8: Live baseline, RUNBOOK, full battery

**Files:**
- Create: `scripts/live-diagram-smoke.mjs`
- Modify: `RUNBOOK.md`

**Interfaces:**
- Consumes: everything above. Produces: `node scripts/live-diagram-smoke.mjs [baseUrl] ["prompt"] [runs]` — per run: POST prompt → assert SSE contains a `create_diagram` tool result → extract `diagramId` → `GET /api/artifacts/<id>` → assert 200 + `text/html` + non-empty; summary `toolCalls K/N · artifactsOK K/N`; exit 1 unless both N/N.

- [ ] **Step 1: Implement the smoke** (reuse the live-smoke SSE reassembly pattern).

- [ ] **Step 2: Baseline** — live server + `node scripts/live-diagram-smoke.mjs http://localhost:8787 "Diagram our deploy pipeline as an interactive architecture map" 3` → record the matrix in RUNBOOK (tuning only on repeating structural failures, one lever at a time).

- [ ] **Step 3: RUNBOOK Stage 2 section** — what it is, the tool prompt to try, the new gates (`check:diagram`, smoke), troubleshooting (validation-failure messages are model-visible; stale artifacts vanish on restart — in-memory by design).

- [ ] **Step 4: Full battery + commit** — check:diagram 7/7; check:spec; check:recipe 4/4; check:examples 8/8; test:library; test:layout; test-diagram-render; test-diagram-tool; test-tool-wire; test-artifact-renderer; test-error-visibility 2/2; build clean. Commit: `feat(stage2): live diagram baseline + runbook` (or per-task commits as executed).

## Self-Review Notes

- Spec coverage: tool loop (T5), declaration+prompt block (T3), vendored pipeline+fixtures (T1), executor+registry+endpoint (T2), correction bound + abort (T5), canned keyless demo (T6), renderer+security (T7), baseline+RUNBOOK (T8) — all spec sections have tasks; §6 exclusions respected (no persistence/editing/auth work anywhere).
- Type consistency: `executeDiagramTool` return shape and `{diagramId, title, type}` used identically in T2/T4/T6/T7; emitter names match T4/T6; renderer `type: "diagram-html"` matches spec.
- Proportion: signatures + assertions, no transcribed bodies.
