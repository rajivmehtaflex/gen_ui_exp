# gen_ui_exp — Runbook

Phase #1 hello-world, self-hosted Generative UI: **built-in chat shell (`AgentInterface`) + built-in components (`openuiChatLibrary`) + your own OpenRouter key**. No Gateway, no custom components, no theming, no auth, no persistence — later phases.

## The whole app in one breath

The server generates a **briefing pack** once (`generateSystemPrompt` over the serialized
library — "the menu"), and exposes one route, `POST /api/chat`. The browser runs the
**chat shell + parser + renderer**. The model (OpenRouter, or a canned recipe when no key
is set) streams back **OpenUI Lang** — `root = Card(...)` first, children after. The
browser parses each line as it lands and renders live UI. Every part of that sentence
maps to a real file:

| Course concept | File |
|---|---|
| The menu, serialized | `generated/chat-library.spec.json` (run `npm run gen:spec`) |
| Briefing pack writer | `server/chat.mjs` (`generateSystemPrompt` at startup) |
| The chef | OpenRouter via `openai` SDK (`baseURL` override) — or `server/canned-recipe.mjs` when no key |
| The recipe | `server/canned-recipe.mjs` (validated by `scripts/validate-recipe.mjs`) |
| The waiter (pipe 1: llm) | `src/llm.ts` (`fetchLLM` + `openAIAdapter` + `openAIMessageFormat`) |
| The dining room | `src/App.tsx` (`AgentInterface` + `openuiChatLibrary`) |
| Pipe 2 (storage) | deliberately omitted → threads are in-memory for now |

## Run it on your machine

Prereqs: **Node 20+** (developed on Node 24), npm.

```bash
npm install
cp .env.example .env        # then paste YOUR key into OPENROUTER_API_KEY (never share it in chat)
npm run dev
```

Open **http://localhost:5173**.

- **No key in `.env`?** Canned mode: send any message → the validated hello-world card
  streams in line by line and renders. Zero cost, works offline from the model.
- **Key set?** Live mode: type anything ("show my Q4 sales as a dashboard") → OpenRouter
  writes a fresh recipe from the same menu, streams, renders live. Watch it build itself.

OpenRouter keys: https://openrouter.ai/keys — server-side only, never bundled. The model
id lives in `.env` (`OPENROUTER_MODEL`; default is a free-tier model — any id from
https://openrouter.ai/models works).

## The diagram vocabulary (Stage 1 custom components)

`src/library/` extends `openuiChatLibrary` with 8 components — the ONE library
both the briefing pack and the renderer use:

| Family | Signature (positional order) |
|---|---|
| `FlowDiagram` | `(nodes: FlowNode[], edges: FlowEdge[], direction?: "TB"\|"LR")` |
| `FlowNode` | `(id: string, label: string, kind?: "process"\|"start"\|"end"\|"decision"\|"input"\|"store")` |
| `FlowEdge` | `(from: string, to: string, label?: string)` — ids must match FlowNodes |
| `SequenceDiagram` | `(participants: Participant[], messages: Message[])` |
| `Participant` | `(id: string, label: string)` |
| `Message` | `(from: string, to: string, label: string, kind?: "sync"\|"async"\|"return")` |
| `StepExplainer` | `(steps: ExplainerStep[])` — concept walkthroughs, not task lists |
| `ExplainerStep` | `(title: string, body?: string, code?: string, note?: string)` |

Try: *"Show a CI/CD pipeline as a flow diagram"* · *"Diagram the checkout request
lifecycle as a sequence diagram"* · *"Explain how HTTP caching works step by step"*.
No key? Canned mode routes diagram-ish prompts to validated showcase recipes.

**Live baseline (2026-10-11, `nvidia/nemotron-3-super-120b-a12b:free` via OpenRouter,
3 prompts × 3 runs, `live-smoke <url> "<prompt>" 3`):** flow **3/3** · sequence **3/3**
· explainer **3/3** clean parses (0 structural errors). Phase #1's built-in-only
baseline was 2/3 on one prompt — the canonical examples + rules measurably helped.
Re-measure after any library/prompt change; never judge from a single run.

## Interactive Diagram Artifacts (Stage 2)

When an ask calls for a rich, explorable diagram (pan/zoom, relationship tracing, export), the system generates standalone interactive HTML via the vendored `diagramify` runtime and serves it into `AgentInterface`'s artifact panel in a sandboxed iframe.

### The 6 supported types
- `architecture`: system components, boundaries, services, deployments
- `workflow`: business processes, human-in-the-loop flows, multi-stage procedures
- `sequence`: request lifecycles, protocol handshakes, distributed messaging
- `dataflow`: data transformations, pipelines, ETL stages, ingestion
- `lifecycle`: entity states, state transitions, domain object phases
- `explainer-steps`: multi-step conceptual walkthroughs, technical mechanics

### Try it
- Live prompt: *"Diagram our deploy pipeline as an interactive architecture map"*
- Canned prompt: *"build an interactive diagram of a deploy pipeline"* (or any prompt matching `/interactive|explorable/`) — routes to the real validate+deliver tool pipeline keylessly.

### Verification gates & Smoke testing
1. `npm run check:diagram` — runs showcase validation across all 7 fixtures under `server/examples/diagrams/`.
2. `node scripts/live-diagram-smoke.mjs [baseUrl] ["prompt"] [runs]` — end-to-end smoke test sending the prompt, asserting tool call creation, delivery, and artifact retrieval (`GET /api/artifacts/:id` -> 200 `text/html`).

**Live baseline (2026-10-12, `nvidia/nemotron-3-super-120b-a12b:free` via OpenRouter, 3 runs):**
`toolCalls 3/3 · artifactsOK 3/3` (100% clean passes, artifact HTML size ~716 kB).

### Stage 2 Troubleshooting
- **Model validation failures**: if the model produces an invalid spec, the server relays the exact diagnostics JSON back to the model for up to 2 self-correction retries before honestly reporting the error.
- **Missing / 404 artifacts on reload**: the artifact registry is an in-memory `Map` by design (matching in-memory chat threads). Stale artifacts disappear on server restart.
- **Client disconnect / abort**: if a user navigates away or disconnects mid-deliver, the server terminates child `diagramify` subprocesses immediately to prevent orphaned processes.

## Scripts

| Command | What it does |
|---|---|
| `npm run dev` | server (`:8787`) + Vite (`:5173`, proxies `/api`) together |
| `npm run build` | type-check + production build |
| `npm run gen:spec` | re-serialize the library (via tsx) → `generated/chat-library.spec.json`. **Run this whenever you touch `src/library/`** — prompt and renderer must stay in sync |
| `npm run check:spec` | exit 1 if the committed spec is stale vs the library (spec-sync gate) |
| `npm run check:recipe` | parse ALL canned recipes against the real schema; 0 errors required |
| `npm run check:diagram` | validate all 7 fixture specs against showcase quality using vendored diagramify |
| `npm run check:examples` | parse every prompt example against the real schema; 0 errors required |
| `npm run test:library` | library contract: 84 built-ins + 8 diagram components, exact signatures, parser gates |
| `npm run test:layout` | diagram layout math: finite/in-bounds/deterministic, dangling refs dropped |

**The regeneration loop:** edit `src/library/` → `npm run gen:spec` → the dev
server restarts on the changed spec (`--watch`) → Vite hot-reloads the client.


## How to verify it's working (and stay honest about it)

1. `curl -s localhost:8787/api/health` → `{"mode":"canned"|"live", ...}` — which mode am I in?
2. Send a message in canned mode → the card streams progressively (no spinner).
3. Browser DevTools → Network → `/api/chat` → see `data: {...}` SSE chunks; the OpenUI
   DevTools widget auto-mounts in dev to inspect the settled stream.
4. `npm run check:recipe` → 0 errors (the same gate any model output should face).

## Troubleshooting

- **"Upstream error: …" in chat**: the server reached OpenRouter and was refused —
  check the server console and, in order: your key (typo?), the model id (still
  available on OpenRouter?), rate limits (`:free` models are throttled). Fix `.env`,
  restart `npm run dev`.
- **Blank reply / "Unknown component"**: the #1 GenUI bug — prompt spec and renderer
  library out of sync. Re-run `npm run gen:spec` and restart.
- **Adapter mismatch symptoms** (garbled or empty assistant messages): the stream adapter
  must match the bytes the *browser* receives. Our server speaks OpenAI Chat Completions
  SSE ⇒ `openAIAdapter()`. Change the server's wire format ⇒ change the adapter.
- **Version drift**: exports here were verified against `@openuidev/react-ui@0.16.3`,
  `react-headless@0.16.3`, `lang-core@0.3.2`. On upgrade, re-check: `componentLibrary`
  prop, adapter exports (imported from `@openuidev/react-headless`), `generateSystemPrompt`
  spec shape. **Installed packages win over any doc.**

## Next phases (deliberately out of scope)

Custom components (`defineComponent`) · your own chat UI (react-headless Level 2) ·
theming (`createTheme`) · authentication (page auth ≠ API-route auth) · persistence
(`restStorage`) · a correction loop for live model errors (you own it on the
self-hosted path — the Gateway "proofreader" is the thing you didn't buy).
