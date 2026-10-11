# gen_ui_exp — Phase #1: Hello-World Self-Hosted GenUI App

## Context

The user completed a conceptual OpenUI course (mental model + delivery considerations) and is now starting the **hands-on phase**. Decisions already made:

- **Path**: self-hosted / open-source (own provider key, no Thesys Gateway)
- **Provider**: **OpenRouter** — OpenAI-compatible, base URL `https://openrouter.ai/api/v1`, `Authorization: Bearer <key>`, supports the `openai` npm SDK via `baseURL` override (verified against OpenRouter docs)
- **Folder**: `gen_ui_exp`
- **Phase #1 scope**: **built-in chat interface (`AgentInterface`) + built-in components only** (`openuiChatLibrary`). No custom components, no own chat UI, no theming, no auth, no persistence — those are later phases.
- **Style**: "simple hello-world first" — minimal, every file hand-written and explainable, mapped back to the course's concepts (briefing pack, recipe, parser, renderer, two pipes).

Built in the sandbox at `/workspace/gen_ui_exp` (Node 24, npm, network OK), with a runbook so the user can replicate on their machine (Node 20+) with their own API key.

## Stack

| Piece | Choice | Why |
|---|---|---|
| Frontend | Vite + React + TypeScript | `AgentInterface` is a React component; Vite = least ceremony |
| Backend | Tiny Express server (plain ESM `.mjs`) | One route (`POST /api/chat`), zero framework magic |
| Provider SDK | `openai` npm package with `baseURL: "https://openrouter.ai/api/v1"` | OpenRouter's documented drop-in pattern |
| Library spec | `openuiChatLibrary` serialized by a 3-line Node script (`.toSpec()` + `.toJSONSchema()`) — byte-equivalent to the CLI's `generate --spec` | No CLI dependency; every step visible |

**Reference implementation (explored, first-party):** the OpenUI docs site itself runs this exact app — `docs/app/api/chat/route.ts` (OpenRouter via `openai` SDK, `generateSystemPrompt`, SSE relay ending `data: [DONE]`) and `docs/app/chat/_components/agent-surfaces/oss-agent-surface.tsx` (`AgentInterface` + `openuiChatLibrary` + `openAIAdapter()`). We mirror its route/client contracts in a minimal Vite+Express shape. (The official `openui-self-hosted` template is Next.js + LangChain/LangGraph — deliberately heavier; we only borrow its `styles/index.css` import and SSE header shape.)

**Confirmed exports (from repo `index.ts` files):** `AgentInterface`, `fetchLLM`, `openAIAdapter`, `openAIMessageFormat`, `openuiChatLibrary` ← `@openuidev/react-ui` root; `createParser` ← `@openuidev/react-lang`; `generateSystemPrompt` ← `@openuidev/lang-core`; `openuiChatPromptOptions` ← `@openuidev/react-ui/genui-lib/prompt-options`. Pin OpenUI deps to the first-party template's versions: `@openuidev/react-ui ^0.16.3`, `@openuidev/react-lang ^0.3.0`, `@openuidev/lang-core ^0.3.0`.

Why not the official CLI template: hello-world should expose every moving part; template comparison is a later exercise.

## File layout (~12 files)

```
gen_ui_exp/
├── package.json              # scripts: dev (concurrently), build, dev:server, dev:web
├── .env                      # OPENROUTER_API_KEY= (EMPTY — user pastes privately),
│                             # OPENROUTER_MODEL=, OPENROUTER_BASE_URL=https://openrouter.ai/api/v1, PORT=8787
├── .env.example              # committed-safe template
├── .gitignore                # node_modules, dist, .env
├── index.html
├── vite.config.ts            # react plugin + proxy /api → http://localhost:8787
├── tsconfig.json
├── server/
│   └── chat.mjs              # POST /api/chat: briefing pack → OpenRouter stream | canned recipe
├── generated/
│   └── chat-library.spec.json  # serialized openuiChatLibrary (generated artifact)
├── scripts/
│   └── gen-spec.mjs            # 3 lines: { ...openuiChatLibrary.toSpec(), schema: openuiChatLibrary.toJSONSchema() } → JSON file
└── src/
    ├── main.tsx
    ├── App.tsx               # <AgentInterface llm componentLibrary={openuiChatLibrary}>
    ├── llm.ts                # fetchLLM({ url, streamAdapter, messageFormat })
    └── index.css             # @import "@openuidev/react-ui/styles/index.css";  (once)
```

## Key wiring (first-party contracts, to honor exactly)

**Server `server/chat.mjs`:**
1. Load env (Node's built-in `node --env-file=.env` — no dotenv dep); build the briefing pack once at startup, mirroring the docs demo: `generateSystemPrompt({ library: librarySpec, promptOptions: openuiChatPromptOptions })` where `librarySpec` is the JSON loaded from `generated/chat-library.spec.json`.
2. `POST /api/chat`: read `{ messages }` from the body (what `openAIMessageFormat.toApi` sends); assemble `[{ role: "system", content: systemPrompt }, ...messages]`.
3. **No API key configured → canned mode**: stream a canned hello-world OpenUI Lang recipe (see below) shaped as **OpenAI Chat Completions SSE chunks** (`choices[].delta.content`), headers `Content-Type: text/event-stream`, `Cache-Control: no-cache, no-transform`, ending `data: [DONE]` — byte-compatible with live mode, so the client can't tell the difference. UI works on day zero, no key needed.
4. **Key present → live mode**: `new OpenAI({ baseURL: "https://openrouter.ai/api/v1", apiKey: process.env.OPENROUTER_API_KEY })`, `client.chat.completions.stream({ model, messages, stream: true })`, re-emit deltas as SSE through a `ReadableStream` ending `data: [DONE]` (same shape as the docs route).
5. Key never leaves the server; no placeholder key values anywhere.

**Client `src/llm.ts` + `App.tsx`:**
- `fetchLLM({ url: "/api/chat", streamAdapter: openAIAdapter(), messageFormat: openAIMessageFormat })` — raw Chat Completions SSE ⇒ `openAIAdapter()` (adapter must match browser bytes).
- `<AgentInterface llm={llm} componentLibrary={openuiChatLibrary} />`; import `styles/index.css` once in `index.css`.
- No `storage` prop (in-memory threads — fine for hello-world).

**Canned recipe (built-in components only, root `Card`):** a small "Hello from GenUI" dashboard — `CardHeader`, `TextContent`, a `ListBlock`/`SectionBlock`, and `FollowUpBlock` suggestions. Validate it with `createParser(openuiChatLibrary.toJSONSchema(), "Card").parse(...)` (import `createParser` from `@openuidev/react-lang`) → require empty `result.meta.errors`.

## Steps

0. **Persist the plan**: copy this plan file to `/workspace/gen_ui_exp/PLAN.md` (user requested a reusable in-project copy — do this before anything else).
1. Create `/workspace/gen_ui_exp` with the files above.
2. `npm install` — deps: `react`, `react-dom`, `@openuidev/react-ui@^0.16.3`, `@openuidev/react-lang@^0.3.0`, `@openuidev/lang-core@^0.3.0`, `express`, `openai`; dev: `vite`, `@vitejs/plugin-react`, `typescript`, `@types/react`, `@types/react-dom`, `concurrently`.
3. Write `.env` / `.env.example` / `.gitignore`. Pick `OPENROUTER_MODEL` default from OpenRouter's public models list (free/cheap tier) at implementation time; user can change it in `.env`.
4. `node scripts/gen-spec.mjs` → `generated/chat-library.spec.json`; sanity-check it contains components + schema.
5. Implement `server/chat.mjs` (both modes) + canned recipe + parser validation script.
6. Implement frontend (`main.tsx`, `App.tsx`, `llm.ts`, `index.css`).
7. **Verify in sandbox** (see below), fix, re-run.
8. Write `RUNBOOK.md`: user-machine steps (Node 20+, `npm install`, paste key into `.env` themselves, `npm run dev`, open `http://localhost:5173`, what to expect: welcome → type "hello" → recipe streams in and renders as UI; DevTools auto-mounts in dev).

## Verification (sandbox — no browser here)

1. `npm run build` → tsc + vite build clean.
2. Start server alone; `curl -N -X POST localhost:8787/api/chat -d '{"messages":[...]}'` → visible SSE deltas (canned mode, no key).
3. Canned recipe parses clean: zero `result.meta.errors` (script under `scripts/` or inline check).
4. `npm run dev` + `curl localhost:5173` → HTML served; `/api` proxy reaches the server.
5. On the user's machine (runbook): with key → real streamed recipe renders progressively in `AgentInterface`.

## Out of scope (future phases)

Custom components · own chat UI (Level 1/2) · theming · authentication · persistence · `openui deploy` · official-template comparison.

## Risks / notes

- **Version-sensitive exports**: exact names were confirmed against the repo source at the pinned versions (see Stack section); still spot-check installed `.d.ts` after `npm install` — installed wins on any conflict.
- Client wiring uses `fetchLLM({ url, streamAdapter: openAIAdapter(), messageFormat: openAIMessageFormat })` (options shape confirmed: `{ url, streamAdapter, messageFormat?, headers?, fetch?, body? }`) — simpler than the docs demo's hand-rolled `ChatLLM`; the demo remains the fallback pattern if `fetchLLM` misbehaves.
- `model` env var: OpenRouter ids look like `vendor/model-name`; pick a currently-available free/cheap one via the unauthenticated `GET https://openrouter.ai/api/v1/models` at implementation time.
- OpenRouter attribution headers (`HTTP-Referer`/`X-OpenRouter-Title`) are optional — skipped for hello-world.
- npm registry access confirmed OK (network already exercised in this sandbox); no browser in sandbox, so visual confirmation happens on the user's machine via the runbook.
