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

## Scripts

| Command | What it does |
|---|---|
| `npm run dev` | server (`:8787`) + Vite (`:5173`, proxies `/api`) together |
| `npm run build` | type-check + production build |
| `npm run gen:spec` | re-serialize the library → `generated/chat-library.spec.json`. **Run this whenever you touch the library** — prompt and renderer must stay in sync |
| `npm run check:recipe` | parse the canned recipe against the real schema; must report 0 errors |

## How to verify it's working (and stay honest about it)

1. `curl -s localhost:8787/api/health` → `{"mode":"canned"|"live", ...}` — which mode am I in?
2. Send a message in canned mode → the card streams progressively (no spinner).
3. Browser DevTools → Network → `/api/chat` → see `data: {...}` SSE chunks; the OpenUI
   DevTools widget auto-mounts in dev to inspect the settled stream.
4. `npm run check:recipe` → 0 errors (the same gate any model output should face).

## Troubleshooting

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
