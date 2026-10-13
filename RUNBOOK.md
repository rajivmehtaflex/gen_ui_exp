# gen_ui_exp runbook

This repository runs a React generative UI client and an Express chat API. The browser uses the repository's custom `appChatLibrary`, an OpenUI component library with the built-in chat components and eight diagram components. Interactive diagrams use a separate `create_diagram` tool and the vendored `diagramify` CLI.

## Architecture

| Responsibility | Implementation |
|---|---|
| Browser shell | `src/App.tsx` mounts `AgentInterface`, `appChatLibrary`, `llm`, and `diagramArtifactRenderer`. |
| Inline UI library | `src/library/chat-library.ts` composes built-ins, eight diagram components, and prompt examples/rules. |
| Generated server contract | `scripts/gen-spec.ts` serializes the library and prompt options to `generated/chat-library.spec.json`; `server/chat.mjs` uses it to build the system prompt. |
| Browser stream handling | `src/llm.ts` uses `fetchLLM`, `openAIMessageFormat`, and this app's `chatAdapter` to translate OpenAI-style SSE into OpenUI events. The adapter closes message/tool events on terminal frames and reports malformed or interrupted streams. |
| Chat and routing | `server/chat.mjs` validates request history, selects canned or live mode, and streams responses. `server/diagram-policy.mjs` shares inline, interactive, or automatic diagram intent routing across modes. |
| Interactive diagram tool | `server/tool-loop.mjs` runs bounded provider/tool rounds. `server/diagram-tool.mjs` validates and delivers specs through `server/vendor/diagramify/bin/diagramify.mjs`, stores the HTML, and serves artifact routes. |
| Artifact viewer | `src/artifacts/diagram-artifact-view.tsx` checks availability and renders a sandboxed iframe. The viewer supports pan/zoom, theme, relationship tracing, and SVG/PNG download. |

`FlowDiagram`, `FlowNode`, `FlowEdge`, `SequenceDiagram`, `Participant`, `Message`, `StepExplainer`, and `ExplainerStep` are the eight custom components. Their contracts and examples live under `src/library/diagrams/` and `src/library/chat-library.ts`.

After changing `src/library/`, run `npm run gen:spec` and commit the refreshed generated contract. Do not hand-edit `generated/chat-library.spec.json`.

## Install and run

Requirements: Node.js 20 or later and npm.

```sh
npm ci
cp .env.example .env
npm run dev
```

Open <http://localhost:5173>. Vite serves the client and proxies `/api` to Express on port 8787. The `.env` file is git-ignored; keep provider credentials there, never in client code.

### Modes and configuration

- **Canned mode:** leave `OPENROUTER_API_KEY` empty. The server streams a validated sample card or inline diagram recipe. Prompts routed as interactive run the real validate/deliver tool using a checked-in fixture, so this path works without a provider key.
- **Live mode:** set both `OPENROUTER_API_KEY` and `OPENROUTER_MODEL`. A key without a nonempty model makes the server exit at startup with a clear message. `OPENROUTER_BASE_URL` can point to an OpenRouter-compatible endpoint; the default is `https://openrouter.ai/api/v1`.
- `PORT` selects the Express port and defaults to `8787`. The example `.env` includes a sample model id; the server does not apply that model as a fallback when the variable is empty.

`diagramModeForPrompt` chooses among:

- **inline:** keep the answer in the chat's inline UI stream and disable diagram tool calls for the initial live completion.
- **interactive:** request the `create_diagram` tool. The result appears in the artifact panel.
- **auto:** let the live model choose; canned mode uses a matching sample recipe for ordinary requests.

These are routing hints, not a guarantee that every arbitrary prompt produces a diagram. The canned fixtures are deterministic samples, not model-generated answers.

### Production startup

The server serves the built client whenever `dist/` exists. Build first, then start the API/UI server:

```sh
npm ci
cp .env.example .env
# Set both OPENROUTER_API_KEY and OPENROUTER_MODEL for live mode.
npm run build
node --env-file=.env server/chat.mjs
```

Open <http://localhost:8787>. The Express process serves `dist/`, `/api/chat`, health, and artifact routes on the same origin. `npm run dev` is for development; it starts Express with Node's watch mode and starts Vite separately. `npm run preview` is Vite's client preview, not the full-stack production command.

## API and resource limits

`POST /api/chat` accepts user/assistant/tool conversation history. The server validates it before opening an SSE response. It accepts at most 100 messages and a 1 MiB JSON request body; invalid histories return JSON 400 and oversized bodies return JSON 413.

Live chat uses a bounded tool loop: at most three diagram executions per request, followed by a final completion. Diagram rendering has a two-job process-wide limit and no queue; a saturated request gets a structured busy failure. Each request has a 120-second overall deadline. Accumulated model text and tool arguments share a 2 MiB budget, and pending SSE data is capped at 256 KiB. Oversized frames stop visibly instead of being silently dropped. Client disconnects and deadlines abort provider work and diagram subprocess trees.

The browser stream adapter exposes server and upstream failures in the chat. A failed diagram result carries an error and available renderer diagnostics; the artifact panel shows a failure state rather than a blank preview.

## Interactive diagram artifacts

The supported `diagramify` types are `architecture`, `workflow`, `sequence`, `dataflow`, `lifecycle`, and `explainer-steps`. The tool validates each spec at showcase quality, renders standalone HTML, hashes the delivered UTF-8 bytes, and returns an id plus digest/byte receipt.

Artifacts are stored in memory with these limits:

- 100 entries maximum;
- 64 MiB total HTML;
- 2 MiB per artifact;
- one-hour TTL measured from creation, not last access.

When a count or byte limit is exceeded, the oldest entries are evicted. Expired, evicted, and post-restart artifacts return 404. The panel checks availability and offers a retry for transient fetch failures.

`GET /api/artifacts/:id` serves HTML with `nosniff`, `no-store`, and a restrictive CSP sandbox. The iframe uses `sandbox="allow-scripts allow-downloads"`, which gives it an opaque origin and permits the viewer's SVG/PNG downloads while blocking parent access. The vendor TOC patch uses DOM text APIs for titles and section numbers. See `server/vendor/diagramify/VENDOR.md` and run `npm run check:vendor` to verify its source inventory and reproducible generated assets.

## Verification

### Offline gates

```sh
npm ci
npm run verify
```

`npm run verify` runs the 20 standalone checks (spec, recipe, examples, seven diagram fixtures, library, layout, tool, wire, artifact renderer, input, loop, process, store, resource, prompt, routing, smoke contracts, vendor, harness, and error visibility). It then starts a harness-owned keyless server for text smoke, interactive artifact smoke, and a flow render gate, and finishes with the build. It stops on the first error, clears provider variables for child processes, and never invokes a paid live smoke.

Useful focused commands include `npm run check:vendor`, `npm run check:diagram`, `npm run test:tool`, `npm run test:wire`, and `npm run test:resource`.

### Browser checks

Install the pinned Playwright Chromium once, then run the browser suite:

```sh
npx playwright install chromium
npm run test:browser
```

The suite covers artifact-panel lifecycle/download behavior, direct artifact sandbox and hostile-TOC behavior, and inline diagram geometry/accessibility/mobile scrolling. Browser checks are intentionally separate from `npm run verify`; CI runs them in a job that installs Chromium first.

### Optional live smoke

The scripts `node scripts/live-smoke.mjs [baseUrl] [prompt] [runs]` and `node scripts/live-diagram-smoke.mjs [baseUrl] [prompt] [runs]` call the configured live provider when pointed at a live server. They are not part of the offline gate and may make billable external requests. Use them only when live credentials and a live run are intended; record actual run counts and artifact digests.

### Historical live results

These are prior run records, not results from the current acceptance run:

- **Historical (2026-10-11):** three prompts with three runs each on `nvidia/nemotron-3-super-120b-a12b:free`; flow, sequence, and explainer each recorded 3/3 clean parses.
- **Historical (2026-10-12):** three interactive artifact runs on the same model recorded 3/3 tool calls and 3/3 retrieved artifacts.

Do not use these historical numbers as evidence that a current provider/model configuration works.

## Troubleshooting

- **Server exits at startup:** if a key is set, also set a model id in `OPENROUTER_MODEL`.
- **Visible “Upstream error” in chat:** check the server log, key, model availability, endpoint, and provider rate limits.
- **JSON error before the stream:** inspect the response status/body; the API returns 400 for unsupported history and 413 for bodies over 1 MiB.
- **Diagram validation error:** the tool returns renderer diagnostics to the model for correction within the three-execution budget, then shows the failure in chat/artifact UI.
- **Renderer busy:** two diagram jobs are already active; there is no queue. Retry after one completes.
- **Artifact unavailable:** it may have expired, been evicted under the count/byte cap, or disappeared when the in-memory store was cleared by a server restart.
- **Stale component prompt:** after editing `src/library/`, run `npm run gen:spec`; then `npm run check:spec` confirms the generated contract matches.

## Not included

The app has no user authentication, persistent chat history, or persistent artifact storage. Browser threads and server artifacts are in memory. Provider access is configured on the server; hosting and secret management remain deployment responsibilities.
