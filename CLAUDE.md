# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

```bash
npm run dev              # Express (:8787) + Vite (:5173, proxies /api) together
npm run build            # tsc type-check + production bundle
npm run gen:spec         # regenerate generated/chat-library.spec.json from src/library/
npm run check:spec       # exit 1 if the committed spec is stale vs the library

# Validation gates (standalone scripts, no test framework)
npm run check:recipe     # parse all canned recipes against the real schema — 0 errors required
npm run check:examples   # parse every prompt example against the real schema — 0 errors required
npm run check:diagram    # validate the 7 fixtures in server/examples/diagrams/ via vendored diagramify
npm run test:library     # component contracts: built-ins + 8 diagram components, signatures, parser gates
npm run test:layout      # diagram layout math: finite/in-bounds/deterministic, dangling refs dropped
```

Other standalone scripts (run as documented in each file header):

```bash
npx tsx scripts/test-diagram-render.mjs   # renderer geometry
npx tsx scripts/test-artifact-renderer.mjs # artifact renderer contract
node scripts/test-diagram-tool.mjs        # executeDiagramTool + artifact registry/routes
node scripts/test-tool-wire.mjs           # browser wire shape through the real adapter
node scripts/test-error-visibility.mjs    # server error handling
node scripts/live-smoke.mjs [url] [prompt] [runs]        # end-to-end chat smoke (needs running server)
node scripts/live-diagram-smoke.mjs [url] [prompt] [runs] # end-to-end create_diagram smoke
npx tsx scripts/check-render.tsx [prompt] # render streamed recipe through the real Renderer (UI looks wrong?)
```

Node 20+ required. Copy `.env.example` to `.env` and set `OPENROUTER_API_KEY` for live mode (optional — see Modes). The repository is indexed with CodeGraph (`.codegraph/`); use `codegraph_explore` / `codegraph explore` as the primary way to study code.

## Architecture

### The one contract: same library on both ends

`src/library/chat-library.ts` composes the OpenUI built-ins with 8 custom diagram components into `appChatLibrary`. The browser renders with it (`src/App.tsx` → `AgentInterface`), and the server's system prompt is generated from its serialized form (`generated/chat-library.spec.json` via `generateSystemPrompt`). This is why **any change to `src/library/` requires running `npm run gen:spec` and committing the refreshed spec** — prompt and renderer drifting apart is the #1 bug (symptom: blank replies / "Unknown component"). Never hand-edit the generated JSON.

### Chat flow

The browser never talks to OpenRouter directly. `src/llm.ts` fetches `/api/chat` (Vite proxies to Express in dev); `server/chat.mjs` builds the system prompt once at startup (spec + `diagramPromptBlock` from `server/diagram-tool.mjs`), then streams the model's response as OpenAI Chat Completions SSE. The browser parses each line as it lands and renders live UI — so the stream adapter (`openAIAdapter`) must match the wire format the server emits; changing one means changing the other.

### Modes: live vs canned

`OPENROUTER_API_KEY` set → live mode (streams from OpenRouter, model id in `OPENROUTER_MODEL`). Empty → canned mode (`server/canned-recipe.mjs`) streams validated recipes with zero model cost; canned recipes and prompt examples are schema-valid fixtures guarded by `check:recipe`/`check:examples`. `/api/health` reports the current mode.

### Stage 2: interactive diagram artifacts

When a prompt calls for an explorable diagram, the model calls the `create_diagram` tool (`title`, `type`, `spec`) — one of 6 types: architecture, workflow, sequence, dataflow, lifecycle, explainer-steps. `server/diagram-tool.mjs` accumulates streamed tool-call deltas, validates the spec by spawning the vendored CLI (`server/vendor/diagramify/bin/diagramify.mjs`, quality "showcase", 15s subprocess timeout), stores the rendered HTML in an in-memory artifact registry, and serves it at `GET /api/artifacts/:id`. Invalid specs get exact diagnostics relayed back for up to 2 self-correction retries, then an honest error. The client (`src/artifacts/diagram-artifact.tsx`, wired as `artifactRenderers` in `App.tsx`) shows a chat chip and renders the artifact in a sandboxed iframe via the artifact panel.

On failures during streaming the server emits visible assistant text (not just an `{"error":...}` JSON body, which renders as a blank reply in chat) — preserve this when touching error paths. Client disconnects abort the upstream request and kill child subprocesses.

### No persistence

Chat threads and artifacts are in-memory by design (demo). Stale artifacts disappear on server restart — don't "fix" this.

### Vendored diagramify

`server/vendor/diagramify/` is vendored third-party code with its own license — preserve the license when updating it. `npm run check:diagram` validates fixtures through it.

## Style & conventions

- Strict TypeScript, ESM imports, two-space indent, double quotes, semicolons. No formatter or linter configured — match surrounding code.
- `PascalCase` React/OpenUI components, `camelCase` functions/variables, `UPPER_SNAKE_CASE` env vars.
- Commits: short Conventional Commit subjects (`feat(vendor):`, `fix(diagrams):`, `docs:` …).
- Provider keys stay server-side (`.env` is git-ignored); never commit `.env`.
- Design notes and plans live in `docs/superpowers/{specs,plans}/`; operational details and troubleshooting in `RUNBOOK.md`.
