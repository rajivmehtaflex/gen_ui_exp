# Repository Guidelines

## Project Structure

- `src/` is the Vite/React client: `src/App.tsx` mounts `AgentInterface`; `src/library/chat-library.ts` composes OpenUI built-ins, eight diagram components, and prompt guidance; `src/artifacts/` renders interactive diagram artifacts.
- `src/library/diagrams/` holds component schemas, React renderers, and pure layout helpers. Keep layout logic separate from rendering where practical.
- `server/` contains the Express streaming chat route, request/tool/resource limits, artifact storage, canned recipes, and project diagram fixtures in `examples/diagrams/`. `server/vendor/diagramify/` contains the vendored CLI, schemas, renderers, and upstream license/provenance manifest.
- `generated/chat-library.spec.json` is derived from the client library and consumed by the server. `scripts/` contains generation and checks; `RUNBOOK.md` covers local operation; `docs/superpowers/{specs,plans}/` holds design notes and plans.

## Architecture Contract

The browser renderer and server prompt must use the same `appChatLibrary`. The browser's `chatAdapter` must match the server's OpenAI-style SSE wire format. After any `src/library/` change, run `npm run gen:spec` and commit the refreshed spec; never hand-edit generated JSON. Keep canned recipes and prompt examples schema-valid. `npm run check:diagram` validates fixtures through the vendored CLI; `npm run check:vendor` verifies its recorded source subset and generated assets. Preserve its license when updating vendor files.

## Build and Development

- Use Node 20+ and `npm ci`; copy `.env.example` to `.env`. Leave `OPENROUTER_API_KEY` empty for canned mode, or set both it and `OPENROUTER_MODEL` for live mode. `npm run dev` starts Express on port 8787 and Vite on port 5173 (proxying `/api`).
- `npm run build` type-checks and creates `dist/`; `node --env-file=.env server/chat.mjs` serves the built client and API on port 8787 when `dist/` exists. `npm run preview` is the Vite client preview.
- `npm run gen:spec` writes the generated library contract; `npm run check:spec` checks that it is current.

## Tests and Validation

This repository uses standalone scripts, not a test framework. `npm run verify` runs the sequential offline checks, keyless chat/artifact smoke paths, a render gate, and the build; it does not call a live provider. `npm run test:browser` runs Playwright artifact, isolation, and diagram geometry/accessibility checks after `npx playwright install chromium`. `npm run check:vendor` validates vendor provenance and reproduces generated assets. Focused checks include `npm run check:recipe`, `npm run check:examples`, `npm run check:diagram`, `npm run test:library`, `npm run test:layout`, and `npm run test:verify-runtime` for verifier cleanup and timeout behavior. Live smoke scripts can call an external model and are opt-in.

## Style, Commits, and Configuration

Use strict TypeScript, ESM imports, two-space indentation, double quotes, and semicolons. Use `PascalCase` for React/OpenUI components, `camelCase` for functions and variables, and `UPPER_SNAKE_CASE` for environment variables. No formatter or linter is configured.

Recent commits use short Conventional Commit-style subjects such as `feat(vendor): ...`, `fix(diagrams): ...`, `test(live): ...`, and `docs: ...`. PRs should explain behavior, list checks, link issues, and include screenshots for visual changes. Keep provider keys server-side; never commit `.env`. The demo has no authentication or persistent chat storage.

## Codebase Exploration & Analysis

This repository is indexed with CodeGraph (`.codegraph/`). Always use the CodeGraph MCP server (`codegraph_explore`) or the shell CLI (`codegraph explore "<query>"`) as the primary method to study, explore, and analyze the codebase architecture and symbols before falling back to manual file inspections or grep.
