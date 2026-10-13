# gen_ui_exp

A self-hosted generative UI app built with React, OpenUI, and OpenRouter. It renders ordinary chat answers as UI, includes eight custom inline diagram components, and can create interactive HTML artifacts with the vendored `diagramify` renderer.

## Quick start

Requirements: Node.js 20 or later and npm.

```sh
npm ci
cp .env.example .env
npm run dev
```

Open <http://localhost:5173>. The `.env.example` starts with an empty API key, so the app runs in canned mode until you set a key. For live model responses, set both `OPENROUTER_API_KEY` and `OPENROUTER_MODEL` in `.env`. The model value in the example file is a sample, not a server fallback. Keys stay on the server.

## What the app renders

- **Canned mode:** streams validated sample cards and inline diagram recipes without calling a model. Interactive diagram prompts still run the local diagram renderer against a fixture.
- **Live mode:** sends requests to the configured OpenRouter-compatible endpoint. The prompt router can keep a diagram inline, force an interactive artifact, or leave the choice to the model.
- **Interactive artifacts:** six diagram types open in a sandboxed viewer with pan, zoom, relationship exploration, theme controls, and SVG/PNG export.

The client uses `appChatLibrary` and `chatAdapter` from this repository. The same library is serialized to `generated/chat-library.spec.json` for the server prompt. See [RUNBOOK.md](RUNBOOK.md) for the architecture, limits, operations, and verification commands.

## Example prompts

- “Show our CI pipeline as an inline flow diagram.”
- “Explain how HTTP caching works step by step.”
- “Create an interactive architecture diagram of our deployment pipeline.”
- “Create an interactive sequence diagram of a checkout request.”

## Production

```sh
npm ci
cp .env.example .env
# Set OPENROUTER_API_KEY and OPENROUTER_MODEL for live mode, or leave the key empty.
npm run build
node --env-file=.env server/chat.mjs
```

After the build, the Express server serves `dist/` and the `/api` routes from port 8787. `npm run dev` runs the same API with Vite on port 5173 for development.

## Verification

- `npm run verify` runs the offline checks, keyless chat and artifact smoke paths, a diagram render gate, and the build. It does not call a paid live model.
- `npm run test:browser` runs the Playwright artifact panel, isolation, and diagram geometry checks. Install its browser once with `npx playwright install chromium`.
- `npm run check:vendor` checks the vendored source manifest and reproduces its generated assets.

Live provider smoke scripts are optional and can make external model requests. Their historical results are described as historical in the runbook.
