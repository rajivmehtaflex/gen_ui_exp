# Codebase Gap Remediation Acceptance

This record maps findings G01–G24 from the [implementation plan](../plans/2026-10-12-codebase-gap-remediation.md) to the commits and checks observed on `feat/codebase-gap-remediation`.

## Final branch checks

Observed on 2026-10-13 in the remediation worktree, at Node.js 24.21.0 and npm 11.19.0:

- `npm run verify` exited 0: **25/25 steps passed in 130.3 seconds**. This included the 20 offline check scripts, keyless text smoke, keyless interactive diagram smoke with artifact retrieval and SHA-256 receipt, a FlowDiagram render gate, and the production build.
- `npm run test:browser` exited 0: all **6 artifact-panel cases**, **5 isolation cases**, and the diagram-render geometry, accessibility, label, explainer, and mobile-scrolling checks passed.
- The build emitted Vite's chunk-size advisory for the 2.67 MB minified application chunk; it did not fail the build.
- Live-provider smoke was not run. The historical runbook results are labeled as historical and are not presented as current acceptance evidence. No live model result is claimed.

## Finding coverage

| Finding | Fix commit(s) | Observed evidence |
|---|---|---|
| G01 | `be9328a`, `e7cf888`, `e68d940`, `4caaee1`, `2250b50`, `792d0e0` | `npm run test:prompt` covers all six diagram families and isolated collection minima; `npm run check:examples` passes all 8 examples. |
| G02 | `ad6d857`, `bbd2268` | `npm run test:loop` verifies one result per call, mixed batches, and rejects unsupported functions before execution. |
| G03 | `ad6d857`, `bbd2268` | `npm run test:loop` covers the reserved tools-disabled final completion and visible fallbacks for empty, truncated, and failed completions. |
| G04 | `413fc34` | `npm run test:wire` passes malformed-frame, terminal-event, cancellation, and transport-failure lifecycle cases. |
| G05 | `ad6d857`, `bbd2268` | `npm run test:loop` verifies canned renderer failures are surfaced honestly. |
| G06 | `659b28e` | `npm run test:artifact` covers typed ready/failed parsing, availability checks, and failure states; browser panel cases pass. |
| G07 | `f34bb41` | Browser panel suite verifies SVG/PNG downloads from the host panel. |
| G08 | `9e2fd92` | Browser isolation suite verifies inert hostile title/number text and working table-of-contents navigation. |
| G09 | `9e2fd92` | Browser isolation suite verifies opaque origin, blocked parent access/navigation, and direct artifact response policy. |
| G10 | `d78b31e` | `npm run test:input` verifies validation before SSE/upstream work and exact request-size boundaries. |
| G11 | `be9328a`, `e7cf888`, `e68d940`, `4caaee1`, `ad6d857`, `bbd2268` | `npm run test:routing` passes 40 shared/canned routing cases; `npm run test:loop` verifies mode-to-tool-choice behavior. |
| G12 | `492a9fa`, `899c68c` | `npm run test:process` covers abort, timeout, descendants, and waiting for process-group exit. Native Windows process-tree behavior was not exercised. |
| G13 | `492a9fa`, `899c68c` | `npm run test:process` injects cleanup failure and confirms the diagram result is preserved. |
| G14 | `3c56cb1`, `5ab08aa`, `30b2406`, `3dd29a0` | `npm run test:store` covers count/byte/TTL retention; `npm run test:resource` covers admission, deadlines, budgets, pending SSE bounds, and cleanup; full verify passes. |
| G15 | `4f46978` | `npm run test:layout` and browser render checks cover bounded geometry, long self-loop labels, and mobile scrolling. |
| G16 | `4f46978` | `npm run test:library`, `npm run test:layout`, and browser render checks cover schema bounds, normalization, dangling/self-edge handling, and partial diagnostics. |
| G17 | `4f46978` | Browser render checks cover accessible SVG descriptions, full labels, warnings, and ordered explainer steps. |
| G18 | `19049c8` | `npm run test:smoke-gates` passes receipt correlation and failure-path checks; final keyless interactive smoke retrieved HTML and verified its digest/byte receipt. |
| G19 | `2eef338` | `npm run test:harness` verifies provider environment isolation, occupied-port rejection, child output/exit handling, and port release; `npm run test:error` passes. |
| G20 | `2eef338` | `npm run verify` passes the sequential offline gate; the commit adds CI jobs for Node 20/24 and Chromium. Local final run was Node 24. |
| G21 | `3466ff7` | `npm run check:vendor` passes provenance, hashes, reproduction, and 5/5 regression cases; `npm run check:diagram` passes 7/7 fixtures. The pinned upstream archive and all 66 manifest paths/hashes were independently compared. |
| G22 | `f661213` | README, RUNBOOK, and AGENTS now match current app wiring, env requirements, hybrid routing, production startup, security/retention/resource limits, and available checks; `git diff --check` passed. |
| G23 | `2eef338` | Package metadata declares Node `>=20`, the direct OpenUI dependency, and explicit TS-aware npm scripts; `npm run verify` passes. Task 12 also recorded a Node 20 full-gate run. |
| G24 | `19049c8` | `npm run test:smoke-gates` passes 19/19 contract cases; `npm run verify` passes keyless text/artifact smoke, render gate, and the 8-example/7-fixture checks. |

## Remaining limits

The live-provider baseline remains pending until an intentional live run is requested and completed; prior results remain historical. Native Windows process-tree execution was not run in this environment. These are limits on live/platform evidence, not open G01–G24 implementation findings.

## Final branch review follow-up

A fresh read-only review of `576e3d6..0abd506` found no Critical issues and five Important gaps. They were fixed in `2285c73`:

| Review finding | Resolution and evidence |
|---|---|
| Malformed or interrupted tool-call deltas and repeated provider IDs could leave invalid browser history or collapse tool results. | The tool loop now buffers and normalizes each batch before sending it to the browser, repairs missing/duplicate IDs, rejects invalid arguments without execution, and returns one result per normalized ID. `npm run test:wire` covers recovery on the next user turn, output-budget interruption, and duplicate IDs; `npm run test:loop` remains green. |
| Smoke and render checks could accept truncated/filter-failed completions, and diagram smoke could pass after artifact retrieval without a final assistant reply. | Text and diagram gates now require a nonblank assistant message ending in `finish_reason=stop`; diagram completion must follow the successful artifact result. The render gate reads raw SSE events and requires `[DONE]`, a normal assistant stop, and no error event. `npm run test:smoke-gates` covers the negative cases; the final keyless smoke/render phase passes. |
| Wide glyphs in long sequence self-loop labels could extend beyond the SVG viewBox. | Visible self-loop text is bounded to 24 code points with an ellipsis and a conservative width estimate; the full text remains in the title/description. Chromium `getBBox()` checks cover 120 wide Latin glyphs and 60 repeated CJK pairs. |
| The aggregate verifier could bypass server cleanup with `process.exit()` and timeout only its immediate child. | Verifier steps now use the process-tree runner; test-server use is wrapped in `try/finally`, and failure sets `process.exitCode`. `npm run test:verify-runtime` checks cleanup after a failed server-backed action and timeout reporting; `npm run test:process` covers descendant termination. |

After `2285c73`, `npm run verify` exited 0: **26/26 steps in 141.0 seconds**. This included the keyless text and interactive diagram smokes, artifact retrieval/digest check, render gate, and production build. `npm run test:browser` passed 6 artifact-panel cases, 5 isolation cases, and the Chromium diagram geometry/accessibility checks. `npm run gen:spec && npm run check:spec` left the generated contract current, and `git diff --check` passed. The Vite chunk-size advisory remains informational.

### Deferred Minor findings

- `heldFinalStop` still ignores an SSE writer refusal for the final provider frame. This requires an unusually large final content frame (over the pending-frame cap); the residual behavior is that the final text can be dropped in that edge case. The targeted run-loop fix was considered small but left for a separate change.
- The vendor regression test's inventory walks into `node_modules`, unlike the production checker. Installing the documented vendor-local generator dependencies can therefore make that regression test fail on its own dependency files. This is a test-inventory issue, not a vendor provenance result; inventory filtering is deferred.

### Declined-to-judge areas

- Live-provider/model reliability remains unverified because this acceptance run used the keyless canned provider. Run live smoke intentionally when model-backed behavior is the target; no live result is claimed here.
- Native Windows process-tree execution remains unverified. The current evidence is Linux process-group coverage plus a simulated Windows `taskkill` failure; Windows behavior needs a Windows runner.
- Authentication, durable persistence, billing, and production infrastructure remain outside this demo-remediation scope. Revisit before treating the demo as a production service.
- Bundle-size optimization remains outside scope because no performance budget was part of the acceptance criteria. The production build reports a 2.67 MB minified application chunk.
- A comprehensive security audit of untouched upstream viewer code was not performed. The review covered the vendored files and targeted template patch needed for this work; provenance checks do not constitute a full viewer audit.
