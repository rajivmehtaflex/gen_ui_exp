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
