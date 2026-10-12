# Codebase Gap Remediation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking. Execution authorized by the user on 2026-10-12; task identifiers T1–T14 correspond to Task 1–14.

**Goal:** Repair all 24 evidence-backed gaps in the repository review while preserving the documented GenUI demo and hybrid diagram behavior.

**Architecture:** Keep the shared generated OpenUI library, Express API, OpenAI-shaped SSE, and vendored CLI. Isolate routing, orchestration, input validation, process lifetime, artifact retention and streaming budgets into small app-owned modules. Repair the concrete vendor DOM sink with a documented patch.

**Tech Stack:** Node 20+, ESM JavaScript, React 18, strict TypeScript, Vite, OpenUI, OpenAI SDK, Zod, Dagre, standalone Node/tsx check scripts; browser checks for iframe behavior.

**Spec:** `docs/superpowers/specs/2026-10-12-codebase-gap-analysis.md` (review, gap table, alternatives and proposed requirements).

## Global Constraints

- Keep Node 20+, strict TypeScript for client code, ESM, two-space indentation, double quotes and semicolons in app-owned code. Retain the vendored MIT LICENSE; record any intentional vendor patch.
- Keep browser and server library contract identical. Regenerate with `npm run gen:spec` after every `src/library/` change; never edit generated JSON by hand.
- Authentication, persistent threads, artifact editing/versioning, billing, and production deployment infrastructure are excluded by the existing Stage 2 design.
- Serve all six artifact types and all three inline families. Explicit inline requests must use inline components; explicit interactive/explorable/artifact/diagramify diagram requests must use tools. Preserve ordinary non-diagram chat.
- Execute at most three diagram attempts per request: initial plus two repair retries for a single diagram. Batches share this execution budget; excess calls receive a budget error result. After success, allow one separate tools-disabled final model response.
- Request body stays at 1 MiB. Accept at most 100 history messages with roles user/assistant/tool.
- Proposed resource defaults: artifact retention 100 entries, 64 MiB total UTF-8 HTML, 60-minute TTL; per artifact 2 MiB; at most 2 active diagram jobs; no render queue (saturation returns a structured busy error).
- Cap CLI stdout and stderr at 1 MiB each. Keep 15-second CLI command deadline; use a 120-second whole chat deadline, 2 MiB accumulated model text/tool argument bytes, and a 256 KiB pending SSE write budget.
- Inline limits: 12 flow nodes, 24 flow edges, 6 sequence participants, 12 messages, 12 explainer steps.
- Sandbox permits scripts and downloads only. Add a response sandbox policy for direct navigation; do not grant same-origin or top-navigation.
- Verification must be offline by default and hermetic. Live smoke requires deliberate endpoint/key configuration and proves digest agreement, tool correlation and completion.
- This is a saved proposal. Default values are explicitly documented assumptions; review them before executing. Existing user edits to AGENTS.md, PDF and image assets must not be staged with fixes.

## Review Focus

- Two simultaneous model tool calls: every id must receive exactly one result, including unsupported functions (T3).
- A third-attempt success followed by text: the artifact and final response must both settle (T2/T3).
- Disconnect while a CLI renderer grandchild runs: the entire tree must exit and temporary files must be cleaned (T7).
- Titles containing HTML-looking text: TOC and preview must show text and execute no injected event handlers, including direct artifact navigation (T4/T5).
- Slow readers and Unicode HTML at retention limits: byte accounting and backpressure must stay within configured caps (T8/T9).

---

## Delivery sequence and file responsibilities

| Stage | Tasks | Main responsibility and dependency |
|---|---|---|
| Transport and generation correctness | T1–T3 | Schema/routing, adapter lifecycle, tool orchestration; T3 uses T1, is consumed through T2 |
| Artifact states and isolation | T4–T5 | Client artifact view, viewer DOM sink and response policy; browser checks use corrected T2/T3 |
| Input and process/resource bounds | T6–T9 | Request validation, process trees, artifact retention, admission and streaming budgets; T9 uses T3/T7/T8 |
| Inline diagram quality | T10 | Bounds, self-loop geometry, descriptions and regenerated library |
| Reliable proof and tooling | T11–T13 | Digest-aware smoke, actual gate semantics, hermetic runner/CI, vendor provenance |
| Operations and handoff | T14 | Accurate runbook and full acceptance evidence |

New production modules: `server/diagram-policy.mjs` (routing), `server/tool-loop.mjs` (orchestration), `server/chat-input.mjs` (history validation), `server/process-runner.mjs` (bounded process tree), `server/artifact-store.mjs` (retention), `server/resource-limits.mjs` (admission/deadline), `server/sse-writer.mjs` (backpressure), `src/artifacts/diagram-artifact-view.tsx` (artifact availability/state), and `src/library/diagrams/limits.ts` (render normalization). Existing components/layout helpers retain their rendering/layout roles.

Every task is independently reviewable. The standalone regression scripts below are planned new or extended checks, not commands claimed to pass today. For each task, run its regression before the implementation and confirm the expected failing assertion, then implement and run again. Use local installed tools; no npx package download is needed.

### Task 1: Repair authoring and hybrid routing (G01, G11)

**Files:** Create `server/diagram-policy.mjs`, `scripts/test-diagram-policy.mjs`, `scripts/test-diagram-prompt.mjs`; modify `server/diagram-tool.mjs`, `server/chat.mjs`, `server/canned-recipe.mjs`.

**Interfaces:** Produce `diagramModeForPrompt(prompt: string): "inline" | "interactive" | "auto"`. Explicit inline takes precedence over interactive keywords. Produce shared `DIAGRAM_TYPES`; keep declaration and authoring guidance aligned with vendor schemas. Consume generated library prompt and all six vendor schemas.

- [x] Add `architecture_guidance_uses_real_placement`: assert no advertised `tier` property; validate one prose-derived architecture with `pos`, and one with `layout.mode="grid"`, `row` and `col`. Add minimal six-type authoring fixtures and assert receipt `ok===true`; include required collection minima and label/code bounds.
- [x] Add `routing_preserves_inline`: assert explicit inline architecture/sequence asks return inline, explicit interactive/explorable diagram asks return interactive, ordinary sketches return auto and ordinary non-diagram asks do not force a tool. Cover a prompt that mentions both inline and interactive.
- [x] Run `node scripts/test-diagram-policy.mjs` and `node scripts/test-diagram-prompt.mjs`; confirm the current guidance/routing assertions fail.
- [x] Replace invalid architecture prose with actual placement guidance and use shared routing in canned/live paths. Keep only one canonical example in the prompt; test fixtures need not all be in the prompt.
- [x] Re-run both scripts and `npm run check:diagram`; require all focused assertions and all seven existing showcase fixtures to pass. Commit only this task's files with `fix(prompt): align diagram contracts and hybrid routing`.
- [x] Close audit follow-up: assert workflow/dataflow node minimums fail when underfilled, and route natural `artifact of a <diagram>` wording to interactive while preserving explicit inline priority; rerun T1 gates and review the follow-up diff.

### Task 2: Make the browser stream lifecycle complete (G04)

**Files:** Modify `src/llm.ts`, `scripts/test-tool-wire.mjs`.

**Interfaces:** Preserve `chatAdapter(): StreamProtocolAdapter` and existing event types. Produce exactly-once text and tool termination, frame parsing across arbitrary bytes/CRLF, and deterministic reader cancellation/release. Consume the existing OpenAI-shaped chunks and tool-result extension.

- [x] Add adapter cases named `two_round_tool_ids_reset`, `tool_then_text_balanced`, `done_without_stop`, `length_and_filter_visible`, `server_error_visible`, `eof_without_done_visible`, `split_utf8_crlf`, and `consumer_break_releases_reader`. Assert starts/ends count match for each id, previous-round ids are never ended twice, terminal data is not followed by content, and errors/truncation are visible. Use a mock ReadableStream to assert cancel/release when iteration stops.
- [x] Run `./node_modules/.bin/tsx scripts/test-tool-wire.mjs`; confirm lifecycle assertions fail.
- [x] Replace line-only parsing with SSE frame assembly; isolate JSON parsing from event processing failures. Reset tool index state per model round and handle stop/length/filter/DONE/EOF/error explicitly. Close text before changing rounds and create a new text id when the next assistant segment begins; use `try/finally` to release the reader.
- [x] Re-run the wire script and `npm run build`; require balanced events and exit 0. Confirm fetchLLM's installed handling of transport failures is compatible and do not double-emit errors it owns.
- [x] Commit with `fix(stream): settle assistant and tool events on every exit`.

### Task 3: Answer tool batches and reserve final response (G02, G03, G05)

**Files:** Create `server/tool-loop.mjs`, `scripts/test-chat-loop.mjs`; modify `server/chat.mjs`.

**Interfaces:** Produce `runToolLoop({ messages, createCompletion, executeTool, emit, signal, model, initialMode }): Promise<void>`. `createCompletion(request, {signal})` returns an async iterable of OpenAI chunks; `executeTool(rawArgs, signal)` returns the existing diagram result union; `emit(sse: string)` may return a promise. Maintain all state per request; injected functions permit an offline provider stub. Consume T1 routing and existing chunk helpers.

- [ ] Add `batch_results_match_all_ids`, `unknown_function_not_executed`, `third_attempt_success_gets_final_text`, `three_failures_stop`, `canned_failure_is_honest`, and `truncated_tool_arguments_not_executed`. Assert every assistant call has one result, unknown function never reaches diagram execution, exactly three failed attempts maximum, and a successful third attempt gets one final completion with `tool_choice="none"`.
- [ ] Run `node scripts/test-chat-loop.mjs`; confirm the current selection/budget/canned assertions fail.
- [ ] Extract orchestration, dispatch every call sequentially, validate ids/names before execution, return errors for unsupported calls, and append all results before calling the provider again. Set `parallel_tool_calls:false` where accepted but still handle returned batches. Share a three-execution budget across the request; return a budget error for every excess call without executing it. Separate diagram attempts from the final response budget and provide a deterministic visible fallback if the final provider response fails. Canned path branches on `result.ok`.
- [ ] Re-run loop and wire checks; require all cases to pass with no network requests. Include abort between result and final response, malformed/empty tool_calls, and mixed-success batches. The final response must settle through T2.
- [ ] Commit with `fix(chat): complete tool batches and bounded diagram retries`.

### Task 4: Represent artifact outcome and availability (G06, G07)

**Files:** Create `src/artifacts/diagram-artifact-view.tsx`, `scripts/test-artifact-panel.mjs`, `scripts/browser-harness.mjs`; modify `src/artifacts/diagram-artifact.tsx`, `scripts/test-artifact-renderer.mjs`, `package.json`, `package-lock.json`. Add a pinned Playwright development dependency and Chromium setup here so T4/T5 browser checks are runnable before T12 integrates CI.

**Interfaces:** Expand `DiagramArtifactProps` to a discriminated building/ready/failed union; ready includes `diagramId`, `title`, `type`, and later optional receipt fields. Produce `DiagramArtifactView(props: DiagramArtifactProps)` with cancellable availability fetch before mounting the iframe; a 404 becomes missing and a transport error has a retry action. Preserve stable artifact meta only for typed ready results.

- [ ] Add parser assertions for `ok:false` with complete args, string `ok`, object diagramId/title, unknown type and malformed partial args. Require failed results to render failure text and no Open chip/Building state. Assert the sandbox contains scripts/downloads and excludes same-origin/top-navigation.
- [ ] Run `./node_modules/.bin/tsx scripts/test-artifact-renderer.mjs`; confirm failures are caught.
- [ ] Implement guarded parser and explicit UI states; encode artifact ids in URLs. Keep partial building previews, show failure details, and distinguish expired/missing artifacts after availability checks. Sandbox becomes `allow-scripts allow-downloads`.
- [ ] Re-run renderer checks and build. In the browser panel check named `artifact_missing_on_reopen`, return a JSON 404 and require a readable missing state; check `download_from_host_panel` with an actual generated artifact and observe SVG/PNG downloads. Verify building→ready, building→failed and retry after fetch failure. Use the local Playwright browser harness introduced by this task; T12 later integrates it into CI.
- [ ] Commit with `fix(artifacts): surface failures expiry and supported exports`.

### Task 5: Fix the vendor TOC sink and direct-navigation isolation (G08, G09)

**Files:** Modify vendor `server/vendor/diagramify/assets/template.html`, `server/diagram-tool.mjs`; create `server/vendor/diagramify/PATCHES.md`, `scripts/test-artifact-isolation.mjs`.

**Interfaces:** Preserve generated HTML/viewer behavior. Artifact responses add a CSP with `sandbox allow-scripts allow-downloads`; restrict resources to self-contained inline styles/scripts and data/blob images, deny connections/objects/base rewriting/forms, and verify the policy against real exports. No DOM text is inserted through HTML interpolation.

- [ ] Create browser fixture `toc_title_stays_text` using a valid explainer section title containing `<img src=x onerror=...>` and quotes. Assert the title appears literally, no injected img node exists, and no marker handler runs; cover section number too. Add `direct_navigation_has_opaque_origin` and blocked parent access/navigation checks.
- [ ] Run `node scripts/test-artifact-isolation.mjs` after browser harness setup; confirm the TOC sink/policy assertions fail against current output.
- [ ] Build anchor/spans using createElement, textContent and safe hash assignment. Add the response policy including a resource directive initially specified as `default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; img-src data: blob:; connect-src 'none'; object-src 'none'; base-uri 'none'; form-action 'none'; sandbox allow-scripts allow-downloads`. Adjust only if a necessary viewer capability is demonstrated by a failing browser check; retain sandbox restrictions.
- [ ] Require hostile-title, panel export, direct-navigation, pan/zoom, theme, guided story and explainer widget checks to pass. Document precisely the vendor patch and confirm LICENSE remains present. This is an isolated vendor modification; do not broadly reformat the template.
- [ ] Commit with `fix(artifacts): keep viewer text inert and sandbox direct access`.

### Task 6: Validate messages before opening the stream (G10)

**Files:** Create `server/chat-input.mjs`, `scripts/test-chat-input.mjs`; modify `server/chat.mjs`.

**Interfaces:** Produce `validateChatBody(body: unknown): {ok:true,messages: ChatMessage[]} | {ok:false,status:400|413,error:string}`; `ChatMessage` is the supported user/assistant/tool OpenAI history subset. Assistant tool-call declarations and matching tool replies must be preserved and checked. Trusted system prompt is added only after validation.

- [ ] Add `bad_histories_return_json`: missing/empty messages, null element, unknown/system/developer role, content object/unsupported part, malformed assistant function args, orphan or duplicated tool result, and 101 messages must fail before an SSE content type is sent. Valid user text, text-part array, completed assistant-tool exchange and null assistant content with valid calls must pass. At 1 MiB body boundary require the documented 413 behavior.
- [ ] Run `node scripts/test-chat-input.mjs`; confirm invalid messages currently pass or default HTML errors fail JSON assertions.
- [ ] Implement pure history validation with role-appropriate content and correlation checks; install JSON middleware error handling. Normalize only supported text parts and return actionable non-sensitive errors. Do not reject legitimate client-generated history without inspecting the installed message formatter.
- [ ] Re-run input and loop checks; require HTTP status, JSON body and no upstream invocation for invalid input.
- [ ] Commit with `fix(api): validate bounded chat history before streaming`.

### Task 7: Contain subprocess trees and cleanup (G12, G13)

**Files:** Create `server/process-runner.mjs`, `scripts/test-process-runner.mjs`, `scripts/fixtures/process-tree.mjs`; modify `server/diagram-tool.mjs`.

**Interfaces:** Produce `runProcessTree({file,args,cwd,signal,timeoutMs,maxOutputBytes}): Promise<{ok:boolean,stdout:string,stderr:string,error?:string}>`. On POSIX use a separate process group and group termination; provide an explicit Windows tree termination implementation if claiming Windows support. `executeDiagramTool` must always resolve its result union even when cleanup fails.

- [ ] Fixture spawns a long-lived grandchild and records its PID. Add `abort_kills_descendants`, `timeout_kills_descendants`, `already_aborted_no_spawn`, `spawn_error_settles_once`, and `cleanup_failure_preserves_result`; assert child and grandchild terminate and listeners/timers are removed. Inject cleanup instead of changing real filesystem permissions globally.
- [ ] Run `node scripts/test-process-runner.mjs`; confirm the present outer-child-only kill and cleanup behavior fails the regressions.
- [ ] Route validate/deliver through the runner. Bound stdout and stderr each to 1 MiB, terminate the tree on limit/abort/15-second command deadline, drain/wait before deleting app temp files, and catch/log cleanup errors. Track vendor-created temp directory leakage in aborted validation; contain it in a job temp root or add a narrowly documented vendor cleanup patch if needed.
- [ ] Re-run process and existing diagram-tool checks; require correct diagnostics, no surviving PIDs and clean successful execution. Include timeout during checker, not only renderer.
- [ ] Commit with `fix(tools): terminate render process trees and preserve cleanup results`.

### Task 8: Bound the in-memory artifact store (part of G14)

**Files:** Create `server/artifact-store.mjs`, `scripts/test-artifact-store.mjs`; modify `server/diagram-tool.mjs`, `scripts/test-diagram-tool.mjs`.

**Interfaces:** Produce `createArtifactStore({maxEntries,maxBytes,ttlMs,maxArtifactBytes,now}): ArtifactStore`; methods `put(id, artifact): {ok:boolean,error?:string}`, `get(id): Artifact|undefined`, `delete(id): boolean`, `clear(): void`, `stats(): {entries:number,bytes:number}`. Artifact has `title,type,html,hash,bytes,createdAt`. Consume T7 results; later T11 exposes the digest/bytes in tool responses.

- [ ] Add `entry_byte_ttl_limits` with injected clock and tiny budgets. Assert oldest entries evict deterministically, a single oversize item is rejected before insertion, expiry returns missing, UTF-8 byte counts reflect Unicode rather than JS string length, and replacement/deletion update totals.
- [ ] Run `node scripts/test-artifact-store.mjs`; confirm the current unbounded Map cannot satisfy the policy.
- [ ] Implement bounded oldest-first retention using the spec defaults and use it behind registry/routes. Count actual UTF-8 HTML bytes. TTL is creation-time based, and expiry is enforced on lookup and insertion; document that access does not extend retention.
- [ ] Re-run store and existing artifact route/tool checks; require 404 for expired/evicted ids, successful live entries, unchanged nosniff/no-store plus T5 policy.
- [ ] Commit with `fix(artifacts): bound retained html by count bytes and age`.

### Task 9: Bound admission and streaming work (remaining G14)

**Files:** Create `server/resource-limits.mjs`, `server/sse-writer.mjs`, `scripts/test-resource-limits.mjs`; modify `server/chat.mjs`, `server/tool-loop.mjs`, `server/diagram-tool.mjs`.

**Interfaces:** Produce `createDiagramLimiter(maxActive: number)` with `tryAcquire(): (() => void)|null`; release callback is idempotent. Produce `createSseWriter(res,{signal,maxPendingBytes}): {write(s:string):Promise<void>,close():void}`. Produce `createRequestDeadline(parentSignal,timeoutMs): {signal,dispose():void}`. T3 awaits emit promises; T7 receives combined abort signal.

- [ ] Add `two_jobs_only` asserting third admission returns a structured busy result without spawn, and slots release on every failure. Add `slow_reader_bounds_memory`, `disconnect_during_drain`, `deadline_aborts_upstream_and_cli`, and `tool_argument_budget`; use fake response/clock, and require terminal diagnostics instead of truncated success.
- [ ] Run `node scripts/test-resource-limits.mjs`; confirm missing admission/deadline/backpressure behavior fails.
- [ ] Apply 2 active jobs, no queue, 120-second whole request deadline, 2 MiB aggregate text/tool argument bytes and 256 KiB pending SSE budget. Respect write(false)/drain; settle on close/error/abort with no hanging promise. Keep admission spanning validate/deliver and release in finally. Budget errors must be visible and use T2 termination.
- [ ] Run resource, process, tool-loop and wire scripts; require all offline cases to settle with zero outstanding handles owned by the harness.
- [ ] Commit with `fix(server): bound diagram jobs and streaming resources`.

### Task 10: Normalize inline bounds, geometry and readable content (G15–G17)

**Files:** Create `src/library/diagrams/limits.ts`; modify `schemas.ts`, `flow.tsx`, `flow-layout.ts`, `sequence.tsx`, `sequence-layout.ts`, `explainer.tsx`, `chat-library.ts`, `scripts/test-diagram-layout.mjs`, `scripts/test-diagram-render.mjs`, `scripts/test-library.mjs`; regenerate `generated/chat-library.spec.json`.

**Interfaces:** Produce `normalizeFlow(nodes,edges): {nodes,edges,omittedNodes:number,omittedEdges:number,selfEdges:number}`, `normalizeSequence(participants,messages): {participants,messages,omittedParticipants:number,omittedMessages:number}`, and `normalizeSteps(steps): {steps,omittedSteps:number}` with existing data types. Deduplicate first, then cap, then filter relationships against retained IDs. Extend `SeqArrow` with `from,to,fullLabel` and accurate loop extents; keep pure layout outputs deterministic.

- [ ] Add `last_lane_self_loop_fits` using one participant and a 120-character message; assert path and text extents are inside viewBox or visibly truncated with full-label alternative. Add boundary/over-boundary counts 12/13 nodes, 24/25 edges, 6/7 participants, 12/13 messages/steps. Assert flow self-edge is dropped/reported and partial arrays are safe.
- [ ] Add rendered assertions for accessible full node/participant/message labels and endpoint descriptions, plus semantic ordered explainer steps. Require duplicate/dangling/omitted warnings to remain visible. Run existing layout/render/library checks and confirm new assertions fail.
- [ ] Implement limits without hiding parser failures as success; verify Zod/reference behavior with partial OpenUI streaming before applying array constraints. Use normalization for render safety and schema limits for complete authoring. Include all self-loop label/path bounds in layout. Add text descriptions and native full-label titles; preserve positional signature order and direction behavior.
- [ ] Run `npm run gen:spec`, `npm run check:spec`, `npm run check:recipe`, `npm run check:examples`, `npm run test:library`, `npm run test:layout`, `./node_modules/.bin/tsx scripts/test-diagram-render.mjs`, and build. Require exit 0 and a regenerated contract diff attributable to this task. Browser-check mobile horizontal scrolling and screen-reader graph descriptions.
- [ ] Commit with `fix(diagrams): bound layouts and preserve readable graph details` including generated spec.

### Task 11: Make smoke and schema/render gates prove their claims (G18, G24)

**Files:** Modify `server/diagram-tool.mjs`, `scripts/live-diagram-smoke.mjs`, `scripts/live-smoke.mjs`, `scripts/check-render.tsx`, `scripts/validate-examples.mjs`, `scripts/test-diagram-tool.mjs`; create `scripts/test-smoke-gates.mjs`.

**Interfaces:** Extend successful tool result to `{ok:true,diagramId,title,type,sha256,bytes}` with SHA-256 of the actual UTF-8 HTML. Extract `verifyDiagramRun({events,artifactResponse}): {ok:boolean,errors:string[]}` in `scripts/diagram-smoke-contract.mjs` (create this file); correlate successful final tool results by id across retries. Consume T8 artifact metadata and T2/T3 completion shapes.

- [ ] Add `wrong_digest_fails`, `wrong_bytes_fails`, `unrelated_tool_fails`, `failed_result_fails`, `missing_done_fails`, `valid_retry_then_success_passes`, `parse_errors_with_svg_fail`, and `group_name_without_example_fails`. Use local fixtures, no provider. Require assertions for HTML content type, nosniff/no-store, correlation, result ok, full digest and byte count.
- [ ] Run `node scripts/test-smoke-gates.mjs`; confirm current permissive conditions fail the checks.
- [ ] Compute digest from actual delivered bytes; compare it with vendor receipt where available and reject disagreement. Expose small receipt fields, update smoke to compare fetched bytes/digest, and bound smoke fetches at 120 seconds. Gate check-render on parse cleanliness and expected family markup; gate prompt example coverage on parsed components in examples. Ensure live text smoke requires completed nonblank Card output, not just absence of parser errors.
- [ ] Run smoke-gate, tool, recipe and example scripts. Against a keyless local server, require inline and interactive smoke commands to exit 0. Live runs remain opt-in; report mode/model and actual run counts, and do not reuse historical baseline as proof.
- [ ] Commit with `test(smoke): verify tool receipts completion and real render contracts`.

### Task 12: Make checks hermetic and enforceable (G19, G20, G23)

**Files:** Modify `scripts/test-error-visibility.mjs`, `scripts/test-tool-wire.mjs`, `scripts/test-artifact-renderer.mjs`, `package.json`, `package-lock.json`, `scripts/browser-harness.mjs`; create `scripts/verify.mjs`, `scripts/test-harness.mjs`, `.github/workflows/verify.yml`. Reuse the browser harness and regression files introduced in T4/T5.

**Interfaces:** Produce `startTestServer({mode,env}): Promise<{baseUrl,child,stop():Promise<void>}>` that clears provider env, allocates an isolated port and proves readiness belongs to its child. Root npm scripts explicitly use tsx for TS/TSX imports. Browser harness uses an explicitly pinned browser automation development dependency; choose Playwright and install its Chromium in the browser CI job.

- [ ] Add `parent_env_does_not_change_mode` with synthetic parent config and `occupied_port_not_accepted` against a decoy healthy server. Assert child exits and captured output is drained. Confirm a clean Node 20 invocation of the documented wire/artifact check uses tsx rather than native TS handling.
- [ ] Run harness and error tests before repair; confirm configuration/readiness assertions fail.
- [ ] Declare `@openuidev/react-headless` directly at a version compatible with the currently installed OpenUI packages, update lockfile through npm, add `engines.node >=20`, and add npm entries for every offline check. `verify.mjs` runs spec/recipe/examples/diagram/library/layout/render/tool/wire/artifact/input/loop/process/store/resource/prompt/routing/smoke/harness checks and build sequentially, stops on nonzero, and never invokes paid live smoke. Add a separate `test:browser` entry for T4/T5 browser checks.
- [ ] Add CI with clean `npm ci`, Node 20/24 offline gates and a Chromium browser job. Run focused harness/error checks, then `npm run verify` and `npm run test:browser`; require zero failed checks. Track any browser installation need explicitly; do not claim a skipped browser check passed.
- [ ] Commit with `test(ci): enforce hermetic checks and supported node tooling`.

### Task 13: Record vendor provenance and reproducible derived assets (G21)

**Files:** Create `server/vendor/diagramify/VENDOR.md`, `server/vendor/diagramify/vendor-manifest.json`, `scripts/check-vendor.mjs`; import the authentic upstream `scripts/generate-validators.mjs` and `scripts/generate-brand-marks.mjs` with their needed source inputs into the subset; amend vendor package scripts only as documented. Extend root verify command.

**Interfaces:** Manifest records source repository, exact revision or verifiable source artifact digest, package version, copied files and SHA-256 values; distinguish intentionally patched files from pristine copies. Generated validators must remain compatible with the shipped schemas and output format; generated brands must have real catalog inputs. Consume T5 patch record.

- [ ] Add `vendor_manifest_covers_subset`, `schema_change_detects_stale_validator`, `brand_inputs_reproduce_catalog`, and `missing_generator_is_actionable`. Require LICENSE and patch inventory; compare generated output byte-for-byte in a temporary directory before replacement.
- [ ] Run `node scripts/check-vendor.mjs`; confirm missing provenance/regeneration inputs fail with specific messages.
- [ ] Obtain source identity from authoritative original package metadata/repository history; never invent a revision. If exact upstream identity cannot be recovered, record that fact plus current-tree checksums, locate the authoritative source before replacing vendor code, and leave provenance acceptance open. Import the real generator dependencies/inputs with compatible pinned versions, or explicitly document a reproducible approved subset generator rather than pretend absent upstream test suites are available.
- [ ] Re-run vendor, seven-fixture CLI and artifact/browser checks; require reproducible derived files and no unrecorded vendor modifications. Add `check:vendor` to the offline aggregate.
- [ ] Commit with `chore(vendor): document source subset and reproducible assets`.

### Task 14: Reconcile operation docs and finish acceptance (G22)

**Files:** Modify `README.md`, `RUNBOOK.md`, `AGENTS.md` only if necessary without overwriting current user edits; create `docs/superpowers/reviews/2026-10-12-remediation-acceptance.md` during implementation.

**Interfaces:** Documentation names the actual custom adapter/app library, required env initialization and model setting, supported Node version, new verification entrypoints, hybrid routing, retention and failure states. Acceptance record maps all G01–G24 to commits and observed checks.

- [ ] Check docs against package scripts and current implementation. Record contradictory adapter/library/default-model/out-of-scope statements and missing `.env` setup before rewriting.
- [ ] Update quickstart to `npm ci`, `cp .env.example .env`, `npm run dev`; explain empty-key canned mode and key+model live mode. Document production server startup after build, actual artifact exports/isolation, expiry, saturation and diagnostics. Remove stale phase assertions; label historical baselines as historical.
- [ ] Execute the full offline gate and browser suite once on the finished branch; require exit 0 and record counts/versions. Use keyless e2e for inline and artifact paths. If live access is available and authorized, run the existing 3-run smoke per type; record each actual result and hashes. If not, mark live baseline pending rather than fabricate success.
- [ ] Audit the gap table against every acceptance result, including failure-path checks and vendor provenance. Leave any unproved task unchecked and describe the exact blocker. Run `git diff --check` and inspect staged paths for unrelated user changes.
- [ ] Commit docs with `docs: align runbook and record gap remediation evidence`; provide acceptance and plan paths for final review. Branch integration is a separate action.

## Finding coverage and execution handoff

| Findings | Owning tasks |
|---|---|
| G01, G11 | T1 |
| G04 | T2 |
| G02, G03, G05 | T3 |
| G06, G07 | T4 |
| G08, G09 | T5 |
| G10 | T6 |
| G12, G13 | T7 |
| G14 | T8 and T9 |
| G15, G16, G17 | T10 |
| G18, G24 | T11 |
| G19, G20, G23 | T12 |
| G21 | T13 |
| G22 | T14 |

Self-review completed for this planning artifact: each of 24 findings has a task; interface names and dependencies align; all five Review Focus conditions have owning checks; resource defaults match the repair design; browser/live/provenance uncertainty is explicit. Task checkboxes are intentionally open because no fixes have been implemented.

Recommended execution is native sequential implementation because tool-loop, adapter and resource tasks share interfaces. Review this saved proposal and its defaults before choosing an execution method. The review-and-plan request is fulfilled by these documents; implementing the plan is subsequent work.
